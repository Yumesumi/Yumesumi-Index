/* journal.mjs 单元验证：node tools/journal-verify.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJournalFile, resolveRecord, mergeRecords } from './journal.mjs';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysi-journal-'));
const datePool = Array.from({ length: 40 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}.md`);
let seq = 0;
function write(content, name) {
  const file = name || datePool[seq++];
  const full = path.join(tmp, file);
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

const FULL = `---
title: 不急着给今天下结论
mood: 平静 · 认真
energy: 7
tags: 生活, 自我观察
cover: images/journal/2026-10-01.webp
open: 1000
close: 1086
---

今天写了一些东西。
`;

console.log('\n[解析头部与正文]');
{
  const e = parseJournalFile(write(FULL));
  check('无解析错误', e.errors.length === 0, JSON.stringify(e.errors));
  check('日期取自文件名', /^\d{4}-\d{2}-\d{2}$/.test(e.record.date));
  check('标题正确', e.record.title === '不急着给今天下结论', e.record.title);
  check('心境正确', e.record.mood === '平静 · 认真');
  check('能量为数字 7', e.record.energy === 7, String(e.record.energy));
  check('标签拆分为数组', Array.isArray(e.record.tags) && e.record.tags.length === 2, JSON.stringify(e.record.tags));
  check('正文正确', e.record.body === '今天写了一些东西。', JSON.stringify(e.record.body));
  check('封面解析正确', e.record.cover === 'images/journal/2026-10-01.webp', e.record.cover);
  check('开盘与收盘解析', e.record.ohlc.open === 1000 && e.record.ohlc.close === 1086);
  check('不再包含 high/low', !('high' in e.record.ohlc) && !('low' in e.record.ohlc));
}

console.log('\n[无头部：正文即全部]');
{
  const e = parseJournalFile(write('只是一段正文。'));
  check('无头部不报错', e.errors.length === 0);
  check('正文被完整保留', e.record.body === '只是一段正文。', JSON.stringify(e.record.body));
  check('标题为空', e.record.title === '');
}

console.log('\n[价格补全与校验]');
{
  const e = parseJournalFile(write(`---
title: 缺收盘
open: 1000
---
正文`));
  const r = resolveRecord(e, 1000);
  check('缺 close 被拒绝', r.errors.length > 0, JSON.stringify(r.errors));
}
{
  const e = parseJournalFile(write(`---
title: 缺开盘
close: 1010
---
正文`));
  const r = resolveRecord(e, 1000);
  check('缺 open 时取上一条收盘价', r.candidate.ohlc.open === 1000, String(r.candidate.ohlc.open));
  check('补全后通过校验', r.errors.length === 0, JSON.stringify(r.errors));
}
{
  const e = parseJournalFile(write(`---
title: 小数
open: 1000
close: 1010.5
---
正文`));
  const r = resolveRecord(e, 1000);
  check('小数收盘被拒绝', r.errors.some((x) => x.includes('整数')), JSON.stringify(r.errors));
}
{
  const e = parseJournalFile(write(`---
title: 旧字段
high: 1100
low: 900
close: 1000
---
正文`));
  check('high 已不再支持', e.errors.some((x) => x.includes('未知字段')), JSON.stringify(e.errors));
}
{
  const e = parseJournalFile(write(`---
title: 能量越界
energy: 99
close: 1000
---
正文`));
  const r = resolveRecord(e, 1000);
  check('energy 越界被拒绝', r.errors.some((x) => x.includes('能量')), JSON.stringify(r.errors));
}

console.log('\n[文件名与头部日期]');
{
  check('非日期文件名返回 null', parseJournalFile(write('x', 'notes.md')) === null);
}
{
  const e = parseJournalFile(write('x', '2026-13-45.md'));
  check('非法日期文件名被识别', e !== null && e.errors.some((x) => x.includes('日期不存在')));
}
{
  const e = parseJournalFile(write(`---
title: 日期不一致
date: 2026-01-01
close: 1000
---
正文`, '2026-02-01.md'));
  check('头部日期不一致被提示', e.errors.some((x) => x.includes('不一致')));
}
{
  const e = parseJournalFile(write(`---
title: 缺结束
close: 1000
正文`));
  check('头部缺少结束标记被拒绝', e.errors.some((x) => x.includes('结束')));
}

console.log('\n[合并：新增 / 更新 / 保留]');
{
  const existing = [
    { date: '2026-10-20', title: '旧标题', body: '旧正文', mood: '', energy: null, tags: [],
      ohlc: { open: 1000, close: 1005 } },
    { date: '2026-10-25', title: '仅在 JSON 里', body: 'x', mood: '', energy: null, tags: [],
      ohlc: { open: 1005, close: 1015 } },
  ];
  const entries = [
    parseJournalFile(write(`---
title: 新标题
close: 1012
---
新正文`, '2026-10-20.md')),
    parseJournalFile(write(`---
title: 第二篇
close: 1020
---
正文二`, '2026-10-27.md')),
  ];
  const res = mergeRecords(existing, entries);
  check('同日期算更新而非新增', res.updated.includes('2026-10-20') && !res.added.includes('2026-10-20'));
  check('新日期算新增', res.added.includes('2026-10-27'));
  check('总数为 3', res.records.length === 3, String(res.records.length));
  check('更新后的标题生效', res.records.find((r) => r.date === '2026-10-20').title === '新标题');
  check('更新后的正文生效', res.records.find((r) => r.date === '2026-10-20').body === '新正文');
  check('没有日记文件的记录被保留', res.records.find((r) => r.date === '2026-10-25').title === '仅在 JSON 里');
  check('结果按日期升序',
    res.records[0].date === '2026-10-20' && res.records[1].date === '2026-10-25' && res.records[2].date === '2026-10-27');
  check('无错误', res.errors.length === 0, JSON.stringify(res.errors));
}

console.log('\n[合并：非法记录不污染结果]');
{
  const existing = [
    { date: '2026-10-20', title: '保留', body: 'x', mood: '', energy: null, tags: [],
      ohlc: { open: 1000, close: 1005 } },
  ];
  const entries = [parseJournalFile(write(`---
title: 坏的
open: 1000
close: 850.5
---
正文`, '2026-11-21.md'))];
  const res = mergeRecords(existing, entries);
  check('非法记录被标记为错误', res.errors.length === 1);
  check('非法记录未被写入结果', res.records.length === 1 && res.records[0].date === '2026-10-20');
  check('原有记录未受影响', res.records[0].title === '保留');
}

console.log('\n[合并：open 取上一条的有效收盘]');
{
  const entries = [
    parseJournalFile(write(`---
title: 一
close: 1020
---
a`, '2026-12-20.md')),
    parseJournalFile(write(`---
title: 二
close: 1030
---
b`, '2026-12-21.md')),
  ];
  const res = mergeRecords([], entries);
  const meta = JSON.parse(fs.readFileSync(new URL('../data/index.json', import.meta.url), 'utf-8'));
  const base = Number(meta.base_value);
  check('第一条 open 用当前基准值', res.records[0].ohlc.open === base, `期望=${base} 实际=${res.records[0].ohlc.open}`);
  check('第二条 open 用上一条收盘 1020', res.records[1].ohlc.open === 1020, String(res.records[1].ohlc.open));
}

console.log('\n[正文完整性]');
{
  const body = '第一段。\n\n第二段有 , 逗号和 "引号"。\n\n第三段。';
  const e = parseJournalFile(write(`---
title: t
close: 1000
---

${body}
`));
  check('正文完整保留（含空行与标点）', e.record.body === body.trim(), JSON.stringify(e.record.body));
  check('不因生成摘要而丢失内容', e.record.body.includes('第三段。'));
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);