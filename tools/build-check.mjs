/* =========================================================
   build-check.mjs — 源数据与构建产物的发布前检查

   node tools/build-check.mjs           检查源数据、CNAME、journal 同步
   node tools/build-check.mjs --dist    额外检查 dist/ 产物完整性
   ========================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRecordsJSON, isValidDateString, normalizeRecord,
} from '../src/lib/data.js';
import { readJournalFiles, resolveRecord } from './journal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const DIST = path.join(REPO, 'dist');
const checkDist = process.argv.includes('--dist');

let pass = 0;
let fail = 0;

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function sameRecord(a, b) {
  return JSON.stringify({
    title: a.title,
    body: a.body,
    mood: a.mood ?? '',
    energy: a.energy ?? null,
    tags: a.tags ?? [],
    cover: a.cover ?? '',
    ohlc: a.ohlc,
  }) === JSON.stringify({
    title: b.title,
    body: b.body,
    mood: b.mood ?? '',
    energy: b.energy ?? null,
    tags: b.tags ?? [],
    cover: b.cover ?? '',
    ohlc: b.ohlc,
  });
}

console.log('\n[源数据]');
const indexPath = path.join(REPO, 'data', 'index.json');
const recordsPath = path.join(REPO, 'data', 'records.json');
check('data/index.json 存在', fs.existsSync(indexPath));
check('data/records.json 存在', fs.existsSync(recordsPath));

const meta = readJSON(indexPath);
check('基准点位是数字（允许 0）', Number.isFinite(Number(meta.base_value)), String(meta.base_value));
check('基准日期合法', meta.base_date === '' || isValidDateString(meta.base_date), String(meta.base_date));
check('频率字段存在', Boolean(meta.frequency), String(meta.frequency));

const rawRecords = readJSON(recordsPath);
const parsed = parseRecordsJSON(JSON.stringify(rawRecords));
check('records.json 全部记录通过校验', parsed.ok, parsed.errors.slice(0, 3).join('；'));
check('记录数量大于 0', parsed.records.length > 0, String(parsed.records.length));

const dates = parsed.records.map((r) => r.date);
check('日期唯一', new Set(dates).size === dates.length);
check('按日期严格升序', dates.every((date, i) => i === 0 || dates[i - 1] < date));

const cnamePath = path.join(REPO, 'CNAME');
check('CNAME 文件存在', fs.existsSync(cnamePath));
if (fs.existsSync(cnamePath)) {
  check('CNAME 指向 index.yumesumi.cyou', fs.readFileSync(cnamePath, 'utf-8').trim() === 'index.yumesumi.cyou');
}

/* ---------- journal 与 records 同步 ---------- */
console.log('\n[journal 同步]');
const entries = readJournalFiles();
check('journal/ 至少有一篇日记', entries.length > 0, String(entries.length));
const byDate = new Map(parsed.records.map((r) => [r.date, r]));
let previousClose = Number(meta.base_value);
const journalOrdered = [...entries].sort((a, b) => (a.record.date < b.record.date ? -1 : 1));
const unsynced = [];
const invalid = [];
const missingImages = [];

for (const entry of journalOrdered) {
  const { candidate, errors } = resolveRecord(entry, previousClose);
  if (errors.length) {
    invalid.push(`${entry.fileName}: ${errors.join('；')}`);
    continue;
  }
  previousClose = candidate.ohlc.close;
  const published = byDate.get(candidate.date);
  if (!published) unsynced.push(`${candidate.date} 未合并`);
  else if (!sameRecord(candidate, published)) unsynced.push(`${candidate.date} 内容不一致`);

  if (candidate.cover && !/^https?:\/\//i.test(candidate.cover)) {
    const imagePath = path.join(REPO, 'public', candidate.cover.replace(/^\.?\//, ''));
    if (!fs.existsSync(imagePath)) missingImages.push(`${candidate.date} → ${candidate.cover}`);
  }
}

check('journal 文件全部合法', invalid.length === 0, invalid.slice(0, 3).join(' | '));
check('journal 全部已合并进 records.json', unsynced.length === 0, unsynced.slice(0, 5).join(' | '));
check('日记封面图片存在', missingImages.length === 0, missingImages.slice(0, 3).join(' | '));

/* ---------- dist 产物 ---------- */
if (checkDist) {
  console.log('\n[构建产物]');
  const base = process.env.YSI_BASE || '/';
  const distIndexPath = path.join(DIST, 'index.html');
  check('dist/index.html 存在', fs.existsSync(distIndexPath));
  check('dist/data/records.json 存在', fs.existsSync(path.join(DIST, 'data', 'records.json')));
  check('dist/CNAME 存在', fs.existsSync(path.join(DIST, 'CNAME')));
  check('dist/.nojekyll 存在', fs.existsSync(path.join(DIST, '.nojekyll')));
  check('dist/fonts/fonts.css 存在', fs.existsSync(path.join(DIST, 'fonts', 'fonts.css')));
  check('dist/brand/logo.svg 存在', fs.existsSync(path.join(DIST, 'brand', 'logo.svg')));

  if (fs.existsSync(path.join(DIST, 'CNAME'))) {
    check('产物 CNAME 内容正确', fs.readFileSync(path.join(DIST, 'CNAME'), 'utf-8').trim() === 'index.yumesumi.cyou');
  }

  if (fs.existsSync(distIndexPath)) {
    const html = fs.readFileSync(distIndexPath, 'utf-8');
    check('入口脚本已打包（不再引用 /src/main.js）', !html.includes('/src/main.js'));
    check('样式已打包', /<link[^>]+href="[^"]*\/assets\/[^"]+\.css"/.test(html));

    const refs = [...html.matchAll(/(?:href|src)="(\/(?!\/)[^"]+)"/g)].map((m) => m[1]);
    const missing = [];
    for (const ref of refs) {
      if (ref.startsWith('//')) continue;
      let rel = ref;
      if (base !== '/' && rel.startsWith(base)) rel = rel.slice(base.length);
      else rel = rel.replace(/^\//, '');
      if (!rel || rel.includes('#')) continue;
      const file = path.join(DIST, rel);
      if (!fs.existsSync(file)) missing.push(ref);
    }
    check('HTML 引用的站内资源全部存在', missing.length === 0, missing.slice(0, 5).join(' | '));

    const assets = fs.existsSync(path.join(DIST, 'assets')) ? fs.readdirSync(path.join(DIST, 'assets')) : [];
    check('存在带哈希的 JS 产物', assets.some((f) => /\.js$/.test(f)), assets.join(','));
    check('存在带哈希的 CSS 产物', assets.some((f) => /\.css$/.test(f)), assets.join(','));
  }

  const distRecordsPath = path.join(DIST, 'data', 'records.json');
  if (fs.existsSync(distRecordsPath)) {
    const distRecords = parseRecordsJSON(fs.readFileSync(distRecordsPath, 'utf-8'));
    check('产物 records.json 有效', distRecords.ok, distRecords.errors.slice(0, 3).join('；'));
    check('产物记录数量与源数据一致', distRecords.records.length === parsed.records.length,
      `源=${parsed.records.length} 产物=${distRecords.records.length}`);
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) process.exit(1);
