/* =========================================================
   tools/journal.mjs — 日记文件 → data/records.json 的同步与发布工具

   用法：
     node tools/journal.mjs new [YYYY-MM-DD]   新建日记模板（默认今天）
     node tools/journal.mjs check              校验全部日记并对比当前数据
     node tools/journal.mjs sync               仅合并进 records.json（不提交）
     node tools/journal.mjs commit [YYYY-MM-DD] 合并 + git commit + push

   设计约定：
     · journal/*.md 是「写作源文件」，data/records.json 是「站点数据源」。
       站点只读 records.json，两者由本脚本保持同步。
     · 日期以文件名为准（YYYY-MM-DD.md）；同日期重复出现时更新而非新增。
     · 绝不删除 records.json 中没有对应日记文件的记录。
   ========================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  validateRecord, normalizeRecord, isValidDateString, sortRecords, BASE_VALUE,
} from '../assets/js/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const JOURNAL_DIR = path.join(REPO, 'journal');
const RECORDS_FILE = path.join(REPO, 'data', 'records.json');
const INDEX_FILE = path.join(REPO, 'data', 'index.json');

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/* 供测试导入：解析与合并是纯逻辑，不涉及文件系统写入 */
export { parseJournalFile, resolveRecord, mergeRecords, readJournalFiles, DATE_FILE_RE };

/* ---------------- 输出工具 ---------------- */

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const out = (s = '') => process.stdout.write(`${s}\n`);
const ok = (s) => out(`${C.green}✓${C.reset} ${s}`);
const warn = (s) => out(`${C.yellow}!${C.reset} ${s}`);
const fail = (s) => out(`${C.red}✗${C.reset} ${s}`);
const info = (s) => out(`${C.dim}${s}${C.reset}`);
const head = (s) => out(`\n${C.bold}${s}${C.reset}`);

function die(msg, code = 1) {
  fail(msg);
  process.exit(code);
}

/* ---------------- 基础读写 ---------------- */

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`无法解析 ${path.relative(REPO, file)}：${err.message}`);
  }
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function baseValue() {
  const meta = readJSON(INDEX_FILE, {});
  const v = Number(meta?.base_value);
  return Number.isFinite(v) ? v : BASE_VALUE;
}

/* ---------------- 日记文件解析 ---------------- */

/**
 * 解析一篇日记文件。
 * 格式：可选的 --- 包裹的头部字段，之后是正文。
 * 头部为 key: value，每行一条，tags 用逗号分隔。
 */
function parseJournalFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  const match = fileName.match(DATE_FILE_RE);
  if (!match) return null;

  const date = match[1];
  const errors = [];
  // 文件名格式对不代表日期真实存在（2026-13-45 这类必须拒绝）
  if (!isValidDateString(date)) {
    errors.push(`文件名日期不存在：${date}`);
  }
  let title = '';
  let mood = '';
  let energy = null;
  let tags = [];
  let body = raw;
  const raw_ohlc = {};

  const lines = raw.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') {
      const line = lines[i];
      i += 1;
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const sep = line.indexOf(':');
      if (sep === -1) {
        errors.push(`头部第 ${i} 行不是 key: value 格式：${line.trim()}`);
        continue;
      }
      const key = line.slice(0, sep).trim().toLowerCase();
      const value = line.slice(sep + 1).trim();

      switch (key) {
        case 'title': title = value; break;
        case 'mood': mood = value; break;
        case 'energy': {
          if (value === '') break;
          const n = Number(value);
          if (!Number.isFinite(n)) errors.push(`energy 不是数字：${value}`);
          else energy = n;
          break;
        }
        case 'tags': {
          tags = value
            .split(/[,，、;；]/)
            .map((t) => t.trim())
            .filter(Boolean);
          break;
        }
        case 'date': {
          if (value && value !== date) {
            errors.push(`头部 date (${value}) 与文件名日期 (${date}) 不一致，以文件名为准`);
          }
          break;
        }
        case 'open': case 'high': case 'low': case 'close': {
          if (value === '') break;
          const n = Number(value);
          if (!Number.isFinite(n)) errors.push(`${key} 不是数字：${value}`);
          else raw_ohlc[key] = n;
          break;
        }
        default:
          errors.push(`未知字段：${key}`);
      }
    }
    if (i > lines.length || lines[i]?.trim() !== '---') {
      errors.push('头部缺少结束的 ---');
      i = lines.length;
    }
    body = lines.slice(i + 1).join('\n');
  }

  const record = {
    date,
    title,
    body: body.replace(/^\n+/, '').replace(/\s+$/, ''),
    mood,
    energy,
    tags,
    ohlc: raw_ohlc,
  };

  return { file: filePath, fileName, record, errors, raw_ohlc };
}

/** 读取 journal/ 下全部日记文件，按日期排序 */
function readJournalFiles() {
  if (!fs.existsSync(JOURNAL_DIR)) return [];
  const files = fs.readdirSync(JOURNAL_DIR)
    .filter((f) => DATE_FILE_RE.test(f) && !f.startsWith('TEMPLATE'));
  return files
    .sort()
    .map((f) => parseJournalFile(path.join(JOURNAL_DIR, f)))
    .filter(Boolean);
}

/**
 * 把日记记录补全为合法记录：
 *   close 必填（无法推导）
 *   open 缺省取上一条有效记录的收盘价
 *   high 缺省取 max(open, close)，low 缺省取 min(open, close)
 * 补全后仍然要通过 validateRecord，确保默认值不会掩盖非法输入。
 */
function resolveRecord(entry, prevClose) {
  const r = entry.record;
  const open = Number.isFinite(r.ohlc.open) ? r.ohlc.open : prevClose;
  const close = r.ohlc.close;
  const high = Number.isFinite(r.ohlc.high) ? r.ohlc.high : Math.max(open, close ?? open);
  const low = Number.isFinite(r.ohlc.low) ? r.ohlc.low : Math.min(open, close ?? open);

  const candidate = normalizeRecord({
    date: r.date,
    title: r.title,
    body: r.body,
    mood: r.mood,
    energy: r.energy,
    tags: r.tags,
    ohlc: { open, high, low, close },
  });

  const errors = [...entry.errors, ...validateRecord(candidate)];
  return { candidate, errors };
}

/* ---------------- 合并 ---------------- */

/**
 * 把日记合并进现有记录。
 * 规则：
 *   · 同日期 → 更新（不新增）
 *   · 新日期 → 追加
 *   · records.json 里没有日记文件的记录 → 原样保留，绝不删除
 */
function mergeRecords(existing, journalEntries) {
  const byDate = new Map(existing.map((r) => [r.date, { ...r }]));
  const added = [];
  const updated = [];
  const errors = [];

  let prevClose = null;
  for (const entry of journalEntries) {
    const { candidate, errors: entryErrors } = resolveRecord(entry, prevClose ?? baseValue());
    if (entryErrors.length) {
      errors.push({ fileName: entry.fileName, date: entry.record.date, errors: entryErrors });
      continue;
    }
    if (byDate.has(candidate.date)) updated.push(candidate.date);
    else added.push(candidate.date);
    byDate.set(candidate.date, candidate);
    prevClose = candidate.ohlc.close;
  }

  return {
    records: sortRecords([...byDate.values()]),
    added,
    updated,
    errors,
  };
}

function writeRecords(records) {
  const payload = records.map((r) => ({
    date: r.date,
    title: r.title,
    body: r.body,
    mood: r.mood ?? '',
    energy: r.energy ?? null,
    tags: Array.isArray(r.tags) ? r.tags : [],
    ohlc: {
      open: r.ohlc.open,
      high: r.ohlc.high,
      low: r.ohlc.low,
      close: r.ohlc.close,
    },
  }));
  fs.writeFileSync(RECORDS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

/* ---------------- Git ---------------- */

function git(args, opts = {}) {
  return spawnSync('git', args, {
    cwd: REPO,
    encoding: 'utf-8',
    ...opts,
  });
}

function gitOut(args) {
  const r = git(args);
  return (r.stdout || '').trim();
}

function gitRun(args, label) {
  const r = git(args);
  if (r.status !== 0) {
    fail(`${label} 失败`);
    if (r.stderr) out(r.stderr.trim().split('\n').map((l) => `  ${l}`).join('\n'));
    process.exit(1);
  }
  return r;
}

/**
 * 推送到远端。失败时按序尝试若干代理：
 *   1. 环境变量里的代理（HTTPS_PROXY / https_proxy）
 *   2. 本机 SOCKS5 代理 127.0.0.1:10808
 *   3. 交给 tools/v2ray.mjs：自动切换 V2rayN 节点直到有一个能用
 * 全部使用一次性 git 参数或子进程，不写入 git 全局配置。
 */
function pushWithFallback(branch) {
  const direct = git(['push', 'origin', branch]);
  if (direct.status === 0) return { ok: true, viaProxy: false };

  const stderr = `${direct.stderr || ''}${direct.stdout || ''}`;
  const looksLikeNetwork = /CONNECT tunnel failed|502|TLS|SSL|Unable to access|Connection reset|timed out|Could not connect|Failed to connect|Empty reply/i.test(stderr);
  if (!looksLikeNetwork) {
    fail('push 失败（非网络原因）');
    if (direct.stderr) out(direct.stderr.trim());
    return { ok: false, viaProxy: false };
  }

  // 依次尝试可用的代理，全部用一次性参数，不污染 git 全局配置
  const candidates = [];
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (envProxy && !candidates.includes(envProxy)) candidates.push(envProxy);
  const socks = 'socks5://127.0.0.1:10808';
  if (!candidates.includes(socks)) candidates.push(socks);

  for (const proxy of candidates) {
    info(`直连失败，改用代理 ${proxy} 重试…`);
    // 只设置 http.proxy：git 的 https.proxy 在部分代理下会导致 CONNECT 隧道失败
    const attempt = git(['-c', `http.proxy=${proxy}`, 'push', 'origin', branch]);
    if (attempt.status === 0) return { ok: true, viaProxy: proxy };
    if (attempt.stderr) info(attempt.stderr.trim().split('\n')[0]);
  }

  // 最后交给 v2ray 工具：自动换节点直到有一个能用
  const v2rayScript = path.join(REPO, 'tools', 'v2ray.mjs');
  if (fs.existsSync(v2rayScript)) {
    info('代理仍不通，尝试自动切换 V2rayN 节点…');
    const viaNode = spawnSync(
      process.execPath,
      ['--no-warnings', v2rayScript, 'with-proxy', 'git', 'push', 'origin', branch],
      { cwd: REPO, encoding: 'utf-8' },
    );
    if (viaNode.status === 0) return { ok: true, viaProxy: 'v2rayN 自动换节点' };
    if (viaNode.stdout) info(viaNode.stdout.trim().split('\n').slice(-3).join('\n'));
  }

  fail('push 失败（所有代理与节点重试后仍失败）');
  return { ok: false, viaProxy: null };
}

/* ---------------- 子命令 ---------------- */

function cmdNew(args) {
  const date = args[0] || todayISO();
  if (!isValidDateString(date)) die(`日期无效：${date}（应为 YYYY-MM-DD）`);

  const file = path.join(JOURNAL_DIR, `${date}.md`);
  if (fs.existsSync(file)) die(`${date}.md 已存在，如需重写请直接编辑该文件。`);

  fs.mkdirSync(JOURNAL_DIR, { recursive: true });

  // 上一条有效收盘价，作为开盘价默认值
  const existing = readJSON(RECORDS_FILE, []);
  const prev = sortRecords(existing).filter((r) => r.date < date).pop();
  const openDefault = prev ? prev.ohlc.close : baseValue();

  // OHLC 用空占位而不是预填数字：预填的合法数值容易被原样提交，
  // 那就等于把示例数据伪装成真实记录。空值会在校验阶段明确报错。
  const template = `---
title:
mood:
energy:
tags:
open:
high:
low:
close:
---

在这里写正文。

> 必填：title、close，以及正文本身。
> 可选：mood、energy（0–10）、tags（逗号分隔）。
> open 留空则取上一条记录的收盘价；high 留空则取 max(open, close)；
> low 留空则取 min(open, close)。
> 上一条的收盘价是 ${openDefault.toFixed(2)}，可以直接填进 open。
>
> 日期以文件名为准。修改这个文件后运行：
>   node tools/journal.mjs check
>   node tools/journal.mjs commit
`;

  fs.writeFileSync(file, template, 'utf-8');
  ok(`已创建 journal/${date}.md`);
  info(`默认开盘价 ${openDefault.toFixed(2)}（取自上一条收盘价）`);
  info('写完后运行：node tools/journal.mjs commit');
}

function cmdCheck() {
  head('检查日记文件');
  const entries = readJournalFiles();
  if (!entries.length) {
    warn(`journal/ 下没有日记文件。用 node tools/journal.mjs new ${todayISO()} 创建。`);
  }

  const existing = readJSON(RECORDS_FILE, []);
  const result = mergeRecords(existing, entries);

  if (result.errors.length) {
    head('校验未通过');
    for (const e of result.errors) {
      fail(`${e.fileName}：`);
      for (const msg of e.errors) out(`    · ${msg}`);
    }
  } else {
    ok(`${entries.length} 篇日记全部通过校验`);
  }

  head('与当前数据的差异');
  if (!result.added.length && !result.updated.length) {
    info('没有变化，data/records.json 已是最新。');
  } else {
    if (result.added.length) info(`新增 ${result.added.length} 条：${result.added.join('、')}`);
    if (result.updated.length) info(`更新 ${result.updated.length} 条：${result.updated.join('、')}`);
  }

  const onlyInJson = existing.filter((r) => !entries.some((e) => e.record.date === r.date));
  if (onlyInJson.length) {
    info(`${onlyInJson.length} 条记录仅存在于 data/records.json（将原样保留）：${onlyInJson.map((r) => r.date).join('、')}`);
  }

  return result.errors.length === 0;
}

function cmdSync() {
  const entries = readJournalFiles();
  if (!entries.length) die('journal/ 下没有日记文件，无事可做。');

  const existing = readJSON(RECORDS_FILE, []);
  const result = mergeRecords(existing, entries);
  if (result.errors.length) {
    head('校验未通过，未写入任何文件');
    for (const e of result.errors) {
      fail(`${e.fileName}：${e.errors.join('；')}`);
    }
    process.exit(1);
  }

  writeRecords(result.records);
  ok(`已合并 ${result.added.length} 条新增、${result.updated.length} 条更新`);
  info(`data/records.json 现有 ${result.records.length} 条记录`);
}

function cmdCommit(args) {
  const only = args[0];
  const entries = readJournalFiles();
  if (!entries.length) die('journal/ 下没有日记文件，无事可提交。');

  const selected = only
    ? entries.filter((e) => e.record.date === only)
    : entries;
  if (only && !selected.length) die(`journal/ 下没有 ${only}.md`);

  const existing = readJSON(RECORDS_FILE, []);
  const result = mergeRecords(existing, selected);
  if (result.errors.length) {
    head('校验未通过，已中止，未修改任何文件');
    for (const e of result.errors) {
      fail(`${e.fileName}：`);
      for (const msg of e.errors) out(`    · ${msg}`);
    }
    process.exit(1);
  }

  head('本次变更');
  if (result.added.length) info(`新增：${result.added.join('、')}`);
  if (result.updated.length) info(`更新：${result.updated.join('、')}`);
  if (!result.added.length && !result.updated.length) {
    warn('内容与 data/records.json 完全一致，无需提交。');
    return;
  }

  writeRecords(result.records);
  ok(`data/records.json 已更新（当前 ${result.records.length} 条）`);

  // 只暂存本次相关的路径，避免把无关改动混进提交
  gitRun(['add', '--', 'data/records.json', 'journal'], 'git add');

  const staged = gitOut(['diff', '--cached', '--name-only']);
  if (!staged) {
    warn('暂存区为空，跳过提交。');
    return;
  }
  info(`已暂存：${staged.split('\n').join('、')}`);

  const branch = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const dates = [...result.added, ...result.updated].sort();
  const message = dates.length === 1
    ? `journal: ${dates[0]}`
    : `journal: ${dates.join(', ')}`;

  gitRun(['commit', '-m', message], 'git commit');
  ok(`已提交：${message}`);

  const pushed = pushWithFallback(branch);
  if (!pushed.ok) {
    head('提交已完成，但推送失败');
    info('本地提交是安全的，稍后重试推送即可：');
    info(`  git push origin ${branch}`);
    process.exit(2);
  }
  ok(`已推送到 origin/${branch}${pushed.viaProxy ? `（经由代理 ${pushed.viaProxy}）` : ''}`);
  info('GitHub Pages 会在数分钟后自动重新构建并发布。');
}

/* ---------------- 入口 ---------------- */

const [command, ...args] = process.argv.slice(2);

function runCli() {
  switch (command) {
    case 'new': cmdNew(args); break;
    case 'check': process.exit(cmdCheck() ? 0 : 1); break;
    case 'sync': cmdSync(); break;
    case 'commit': cmdCommit(args); break;
    default:
      out(`${C.bold}YSI 日记工具${C.reset}

  node tools/journal.mjs new [YYYY-MM-DD]    新建日记模板（默认今天）
  node tools/journal.mjs check               校验全部日记并对比当前数据
  node tools/journal.mjs sync                合并进 data/records.json（不提交）
  node tools/journal.mjs commit [YYYY-MM-DD] 合并 + git commit + push

  日期以文件名（journal/YYYY-MM-DD.md）为准。`);
      if (command) process.exit(1);
  }
}

// 作为模块被导入时不执行 CLI（便于单元测试）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
