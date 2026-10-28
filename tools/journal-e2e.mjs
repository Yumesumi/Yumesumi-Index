/* journal 流程端到端验证：node tools/journal-e2e.mjs
   在临时沙箱中完整跑通 new → 编辑 → check → sync → commit → push，
   使用本地 bare 仓库作为远端，不接触真实仓库与 GitHub。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_REPO = path.resolve(HERE, '..');
const NODE = process.execPath;

let pass = 0; let fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass += 1; console.log(`  ok   ${n}`); }
  else { fail += 1; console.log(`  FAIL ${n} ${e}`); }
};

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ysi-e2e-'));
const repo = path.join(sandbox, 'repo');
const remote = path.join(sandbox, 'remote.git');

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf-8', env: { ...process.env } });
}
function git(args, cwd = repo) {
  return run('git', args, cwd);
}

console.log('\n[搭建沙箱]');
fs.mkdirSync(repo, { recursive: true });
// 复制必要文件，模拟真实仓库
for (const f of ['index.html', 'package-less']) {
  const src = path.join(REAL_REPO, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(repo, f));
}
fs.cpSync(path.join(REAL_REPO, 'data'), path.join(repo, 'data'), { recursive: true });
fs.cpSync(path.join(REAL_REPO, 'src'), path.join(repo, 'src'), { recursive: true });
fs.cpSync(path.join(REAL_REPO, 'tools'), path.join(repo, 'tools'), { recursive: true });
fs.cpSync(path.join(REAL_REPO, 'journal'), path.join(repo, 'journal'), { recursive: true });
// 沙箱从干净状态开始：只保留模板，清掉可能存在的日记文件
for (const f of fs.readdirSync(path.join(repo, 'journal'))) {
  if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) fs.unlinkSync(path.join(repo, 'journal', f));
}
// 数据文件也置空：本用例断言的是「从零新增」的行为，
// 不能受真实仓库当前已有记录的影响
fs.writeFileSync(path.join(repo, 'data', 'records.json'), '[]\n', 'utf-8');
// 基准固定为 1000：本用例要验证 open/high/low 的缺省补全规则，
// 需要一个已知的基准值，不能跟着真实仓库的基准设置变
const indexMeta = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'index.json'), 'utf-8'));
indexMeta.base_value = 1000;
fs.writeFileSync(path.join(repo, 'data', 'index.json'), `${JSON.stringify(indexMeta, null, 2)}\n`, 'utf-8');

git(['init', '-b', 'main']);
git(['config', 'user.name', 'Test']);
git(['config', 'user.email', 'test@example.com']);
git(['add', '-A']);
git(['commit', '-m', 'init']);

run('git', ['init', '--bare', remote], sandbox);
git(['remote', 'add', 'origin', remote]);
git(['push', '-u', 'origin', 'main']);
check('沙箱远端建立成功', git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() === 'main');

const journalCmd = (args) => run(NODE, [path.join(repo, 'tools', 'journal.mjs'), ...args], repo);
const recordsFile = path.join(repo, 'data', 'records.json');
const readRecords = () => JSON.parse(fs.readFileSync(recordsFile, 'utf-8'));

console.log('\n[new：创建模板]');
{
  const r = journalCmd(['new', '2026-10-27']);
  check('new 命令成功', r.status === 0, r.stderr);
  const f = path.join(repo, 'journal', '2026-10-27.md');
  check('文件已创建', fs.existsSync(f));
  const content = fs.readFileSync(f, 'utf-8');
  check('含 title 字段', content.includes('title:'));
  check('含 close 字段', content.includes('close:'));
  check('含正文占位', content.includes('在这里写正文'));
  // 重复创建应被拒绝
  const r2 = journalCmd(['new', '2026-10-27']);
  check('重复创建被拒绝', r2.status !== 0);
}

console.log('\n[check：空模板应报错]');
{
  const r = journalCmd(['check']);
  check('check 检测出校验失败', r.status !== 0);
  check('提示 close 缺失', r.stdout.includes('收盘价') || r.stdout.includes('close'), r.stdout.slice(0, 300));
}

console.log('\n[编辑成合法内容]');
{
  const f = path.join(repo, 'journal', '2026-10-27.md');
  fs.writeFileSync(f, `---
title: 不急着给今天下结论
mood: 平静 · 认真
energy: 7
tags: 生活, 自我观察
open: 1000.00
high: 1088.20
low: 972.50
close: 1086.42
---

今天写了一些东西。`, 'utf-8');
}

console.log('\n[check：合法内容应通过]');
{
  const r = journalCmd(['check']);
  check('check 通过', r.status === 0, r.stdout);
  check('报告将新增 1 条', r.stdout.includes('新增 1 条'), r.stdout);
}

console.log('\n[commit：合并并提交推送]');
{
  const r = journalCmd(['commit']);
  check('commit 成功', r.status === 0, `${r.stdout}\n${r.stderr}`);
  check('输出包含推送成功提示', r.stdout.includes('已推送'), r.stdout);

  const recs = readRecords();
  check('records.json 新增 1 条', recs.length === 1, String(recs.length));
  check('日期正确', recs[0]?.date === '2026-10-27');
  check('标题正确', recs[0]?.title === '不急着给今天下结论');
  check('正文完整', recs[0]?.body === '今天写了一些东西。');
  check('OHLC 正确', recs[0]?.ohlc.close === 1086.42 && recs[0]?.ohlc.high === 1088.20);
  check('标签为数组', Array.isArray(recs[0]?.tags) && recs[0].tags.length === 2);

  const log = git(['log', '--oneline']).stdout.trim().split('\n');
  check('产生了新提交', log.length === 2, log.join(' | '));
  check('提交信息含日期', log[0].includes('2026-10-27'), log[0]);

  const remoteLog = run('git', ['--git-dir', remote, 'log', '--oneline', 'main'], sandbox).stdout.trim().split('\n');
  check('提交已推送到远端', remoteLog.length === 2, remoteLog.join(' | '));
}

console.log('\n[同日期再次提交：更新而非重复]');
{
  const f = path.join(repo, 'journal', '2026-10-27.md');
  fs.writeFileSync(f, `---
title: 改过的标题
close: 1090.00
---

改过的正文。`, 'utf-8');

  const r = journalCmd(['commit']);
  check('commit 成功', r.status === 0, `${r.stdout}\n${r.stderr}`);
  const recs = readRecords();
  check('记录数仍为 1（没有重复）', recs.length === 1, String(recs.length));
  check('标题已更新', recs[0]?.title === '改过的标题');
  check('正文已更新', recs[0]?.body === '改过的正文。');
  check('收盘价已更新', recs[0]?.ohlc.close === 1090);
  check('缺省 open 取上一条收盘（此为第一条，取沙箱基准 1000）', recs[0]?.ohlc.open === 1000, String(recs[0]?.ohlc.open));
  check('缺省 high 取 max(open, close)', recs[0]?.ohlc.high === 1090, String(recs[0]?.ohlc.high));
  check('缺省 low 取 min(open, close)', recs[0]?.ohlc.low === 1000, String(recs[0]?.ohlc.low));
}

console.log('\n[新增第二天：open 应取上一条收盘]');
{
  const f = path.join(repo, 'journal', '2026-10-29.md');
  fs.writeFileSync(f, `---
title: 第二天
close: 1100.00
---

第二天正文。`, 'utf-8');
  const r = journalCmd(['commit']);
  check('commit 成功', r.status === 0, `${r.stdout}\n${r.stderr}`);
  const recs = readRecords();
  check('记录数为 2', recs.length === 2, String(recs.length));
  const second = recs.find((x) => x.date === '2026-10-29');
  check('第二天的 open 取上一条收盘 1090', second?.ohlc.open === 1090, String(second?.ohlc.open));
  check('缺失的 10-28 没有被补造成记录', !recs.some((x) => x.date === '2026-10-28'));
}

console.log('\n[非法 OHLC：拒绝且不修改数据]');
{
  const before = fs.readFileSync(recordsFile, 'utf-8');
  const commitsBefore = git(['rev-list', '--count', 'HEAD']).stdout.trim();
  const f = path.join(repo, 'journal', '2026-11-01.md');
  fs.writeFileSync(f, `---
title: 坏数据
open: 1000
high: 900
low: 800
close: 850
---

坏数据正文。`, 'utf-8');

  const r = journalCmd(['commit']);
  check('commit 被拒绝', r.status !== 0);
  check('提示最高价问题', r.stdout.includes('最高价'), r.stdout.slice(0, 400));
  check('records.json 未被修改', fs.readFileSync(recordsFile, 'utf-8') === before);
  check('未产生新提交', git(['rev-list', '--count', 'HEAD']).stdout.trim() === commitsBefore,
    `${commitsBefore} → ${git(['rev-list', '--count', 'HEAD']).stdout.trim()}`);

  fs.unlinkSync(f);
}

console.log('\n[没有对应日记文件的记录：保留不删]');
{
  const recs = readRecords();
  recs.push({
    date: '2026-09-01', title: '只存在于 JSON 的记录', body: 'x', mood: '', energy: null, tags: [],
    ohlc: { open: 1000, high: 1000, low: 1000, close: 1000 },
  });
  fs.writeFileSync(recordsFile, `${JSON.stringify(recs, null, 2)}\n`, 'utf-8');

  const f = path.join(repo, 'journal', '2026-12-01.md');
  fs.writeFileSync(f, `---
title: 新的一天
close: 1200.00
---

新的一天。`, 'utf-8');

  const r = journalCmd(['commit']);
  check('commit 成功', r.status === 0, `${r.stdout}\n${r.stderr}`);
  const after = readRecords();
  check('孤儿记录被保留', after.some((x) => x.date === '2026-09-01' && x.title === '只存在于 JSON 的记录'));
  check('新记录也写入了', after.some((x) => x.date === '2026-12-01'));
}

console.log('\n[同步到远端后站点可读取]');
{
  // 裸仓库没有 worktree，需用 --git-dir 明确指定
  const pushed = run('git', ['--git-dir', remote, 'show', 'main:data/records.json'], sandbox);
  const parsed = JSON.parse(pushed.stdout);
  check('远端 records.json 可解析', Array.isArray(parsed));
  check('远端含最新记录', parsed.some((x) => x.date === '2026-12-01'));
  const pushedJournal = run('git', ['--git-dir', remote, 'show', 'main:journal/2026-12-01.md'], sandbox);
  check('远端同时包含日记源文件', pushedJournal.status === 0);
  const remoteLog = run('git', ['--git-dir', remote, 'log', '--oneline', 'main'], sandbox).stdout.trim().split('\n');
  check('远端提交数正确', remoteLog.length === 5, `实际=${remoteLog.length}`);
}

console.log('\n[清理]');
fs.rmSync(sandbox, { recursive: true, force: true });
check('沙箱已清理', !fs.existsSync(sandbox));

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
