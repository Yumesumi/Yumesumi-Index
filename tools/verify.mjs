/* data.js 单元验证：node tools/verify.mjs */
import {
  validateRecord, normalizeRecord, computeMetrics, computeSummary,
  mergeRecords, toCSV, toExportRecords, parseRecordsJSON,
  isValidDateString, daysBetween, formatNumber, formatPct, formatSigned,
} from '../src/lib/data.js';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} ${extra}`); }
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log('\n[日期校验]');
check('合法日期', isValidDateString('2026-10-27'));
check('非法月份 13', !isValidDateString('2026-13-01'));
check('非法日期 02-30', !isValidDateString('2026-02-30'));
check('格式错误', !isValidDateString('2026/10/27'));
check('闰年 2024-02-29', isValidDateString('2024-02-29'));
check('平年 2026-02-29', !isValidDateString('2026-02-29'));
check('天数差', daysBetween('2026-10-20', '2026-10-27') === 7);

console.log('\n[OHLC 校验]');
const base = {
  date: '2026-10-27', title: 't', body: 'b',
  ohlc: { open: 100, high: 110, low: 90, close: 105 },
};
check('合法 OHLC', validateRecord(base).length === 0, JSON.stringify(validateRecord(base)));
check('high < open 被拒', validateRecord({ ...base, ohlc: { open: 100, high: 99, low: 90, close: 95 } }).length > 0);
check('high < close 被拒', validateRecord({ ...base, ohlc: { open: 100, high: 104, low: 90, close: 105 } }).length > 0);
check('low > open 被拒', validateRecord({ ...base, ohlc: { open: 100, high: 110, low: 101, close: 105 } }).length > 0);
check('low > close 被拒', validateRecord({ ...base, ohlc: { open: 100, high: 110, low: 106, close: 105 } }).length > 0);
check('high == low == open == close 合法（平盘）',
  validateRecord({ ...base, ohlc: { open: 100, high: 100, low: 100, close: 100 } }).length === 0);
check('缺 ohlc 被拒', validateRecord({ date: '2026-10-27', title: 't', body: 'b' }).length > 0);
check('空标题被拒', validateRecord({ ...base, title: '  ' }).length > 0);
check('非法日期被拒', validateRecord({ ...base, date: '2026-02-30' }).length > 0);
check('字符串数字被接受（表单输入）',
  validateRecord({ ...base, ohlc: { open: '100', high: '110', low: '90', close: '105' } }).length === 0);

console.log('\n[指标计算]');
const recs = [
  { date: '2026-10-20', ohlc: { open: 1000, high: 1010, low: 990, close: 1005 } },
  { date: '2026-10-25', ohlc: { open: 1005, high: 1020, low: 1000, close: 1015 } },
];
const m = computeMetrics(recs, 1000);
check('第一条以基准 1000 为前收', near(m[0].prevClose, 1000));
check('第一条涨跌额 = 5', near(m[0].change, 5));
check('第一条涨跌幅 = 0.5%', near(m[0].changePct, 0.5));
check('第一条累计 = 0.5%', near(m[0].cumPct, 0.5));
check('第二条前收 = 1005', near(m[1].prevClose, 1005));
check('第二条涨跌额 = 10', near(m[1].change, 10));
check('跨 5 天仍以前一条收盘比较', near(m[1].changePct, (1015 / 1005 - 1) * 100));

const summary = computeSummary(m, 1000);
check('汇总：最新收盘 1015', near(summary.lastClose, 1015));
check('汇总：日期数 2', summary.count === 2);
check('空数据汇总不崩', computeSummary([], 1000).empty === true);

console.log('\n[合并与去重]');
const published = [
  { date: '2026-10-20', title: 'a', body: 'a', ohlc: { open: 1000, high: 1010, low: 990, close: 1005 } },
  { date: '2026-10-21', title: 'b', body: 'b', ohlc: { open: 1005, high: 1015, low: 1000, close: 1010 } },
];
const pending = {
  '2026-10-20': { mode: 'upsert', record: { ...published[0], title: '改过的标题' } },
  '2026-10-22': { mode: 'upsert', record: { date: '2026-10-22', title: 'c', body: 'c', ohlc: { open: 1010, high: 1020, low: 1005, close: 1018 } } },
};
const merged = mergeRecords(published, pending);
check('同日期被更新而非重复', merged.filter((r) => r.date === '2026-10-20').length === 1);
check('更新内容生效', merged.find((r) => r.date === '2026-10-20').title === '改过的标题');
check('新增日期进入合并', merged.length === 3);
check('合并结果按日期升序', merged[0].date < merged[1].date && merged[1].date < merged[2].date);
check('删除模式生效', mergeRecords(published, { '2026-10-21': { mode: 'delete' } }).length === 1);

console.log('\n[导出]');
const csv = toCSV(merged, 1000);
check('CSV 含 BOM', csv.charCodeAt(0) === 0xFEFF);
check('CSV 含表头', csv.includes('日期') && csv.includes('收盘'));
check('CSV 行数正确', csv.trim().split('\r\n').length === 4);
const tricky = [{ date: '2026-10-20', title: '含"引号",逗号\n和换行', body: 'b', mood: '', energy: null, tags: [], ohlc: { open: 1, high: 2, low: 0.5, close: 1.5 } }];
const csv2 = toCSV(tricky, 1000);
check('CSV 正确转义 引号/逗号/换行', csv2.includes('"含""引号"",逗号\n和换行"'));

const exported = toExportRecords(merged);
check('导出 JSON 含 date 字段', exported[0].date === '2026-10-20');
check('导出 JSON 含 ohlc.close', exported[0].ohlc.close === 1005);
check('导出 JSON 不含派生字段', !('change' in exported[0]) && !('cumPct' in exported[0]));
check('导出 JSON 可被回读', (() => {
  const r = parseRecordsJSON(JSON.stringify(exported));
  return r.ok && r.records.length === 3;
})());

console.log('\n[负数点位]');
{
  // 点位可以为负：涨跌幅的符号必须始终与涨跌额一致
  const neg = computeMetrics([
    { date: '2026-10-27', ohlc: { open: 1000, high: 1000, low: -200, close: -200 } },
    { date: '2026-10-28', ohlc: { open: -200, high: -100, low: -250, close: -100 } },
    { date: '2026-10-29', ohlc: { open: -100, high: -100, low: -300, close: -300 } },
  ], 1000);
  check('负数收盘可被计算', neg[0].ohlc.close === -200);
  check('首条负数涨跌额 = -1200', near(neg[0].change, -1200));
  check('首条负数涨跌幅 = -120%', near(neg[0].changePct, -120));
  check('负数区间的上涨方向正确（前收 -200 → -100）', near(neg[1].changePct, 50), `实际=${neg[1].changePct}`);
  check('负数区间的下跌方向正确（前收 -100 → -300）', near(neg[2].changePct, -200), `实际=${neg[2].changePct}`);
  check('负数累计变化相对基准', near(neg[2].cumChange, -1300) && near(neg[2].cumPct, -130));
  check('涨跌额与涨跌幅符号始终一致', neg.every((r) => (
    (r.change > 0 && r.changePct > 0)
    || (r.change < 0 && r.changePct < 0)
    || (r.change === 0 && r.changePct === 0)
  )));
}
{
  // 前收为 0 时不应产生 Infinity / NaN；此时涨跌幅没有可比基数，记为 null
  const zero = computeMetrics([
    { date: '2026-10-27', ohlc: { open: 0, high: 0, low: 0, close: 0 } },
    { date: '2026-10-28', ohlc: { open: 0, high: 50, low: -50, close: 50 } },
  ], 1000);
  check('前收为 0 时涨跌幅不产生 NaN', !Number.isNaN(zero[1].changePct), String(zero[1].changePct));
  check('前收为 0 时涨跌幅记为无意义(null)', zero[1].changePct === null, String(zero[1].changePct));
  check('前收为 0 时涨跌额仍准确', near(zero[1].change, 50));
}
{
  // 基准为 0 时累计涨跌幅同样没有可比基数
  const zeroBase = computeMetrics([
    { date: '2026-10-27', ohlc: { open: 100, high: 120, low: 90, close: 110 } },
    { date: '2026-10-28', ohlc: { open: 110, high: 130, low: 100, close: 120 } },
  ], 0);
  check('基准为 0 时累计涨跌幅为 null', zeroBase[0].cumPct === null, String(zeroBase[0].cumPct));
  check('基准为 0 时累计涨跌额准确', near(zeroBase[0].cumChange, 110));
  check('基准为 0 时首条涨跌幅为 null', zeroBase[0].changePct === null, String(zeroBase[0].changePct));
  // 前收 110 → 收 120：涨 10，涨跌幅 = 10 / |110| = 9.0909...%
  check('基准为 0 时第二条涨跌幅正常', near(zeroBase[1].changePct, (10 / 110) * 100, 1e-9), String(zeroBase[1].changePct));
}
{
  // 负数 OHLC 关系校验
  const base = { date: '2026-10-27', title: 't', body: 'b' };
  check('全负 OHLC 关系合法时通过',
    validateRecord({ ...base, ohlc: { open: -200, high: -100, low: -300, close: -250 } }).length === 0);
  check('负数下 high < open 仍被拒',
    validateRecord({ ...base, ohlc: { open: -200, high: -250, low: -300, close: -240 } }).length > 0);
  check('负数下 low > close 仍被拒',
    validateRecord({ ...base, ohlc: { open: -200, high: -100, low: -190, close: -200 } }).length > 0);
  check('全 0 OHLC 合法（平盘）',
    validateRecord({ ...base, ohlc: { open: 0, high: 0, low: 0, close: 0 } }).length === 0);
}
{
  // 负数记录可导出与回读
  const negRecs = [{ date: '2026-10-27', title: '负', body: '负正文', mood: '', energy: null, tags: [],
    ohlc: { open: -200, high: -100, low: -300, close: -250 } }];
  const csvNeg = toCSV(negRecs, 1000);
  check('CSV 正确输出负数', csvNeg.includes('-250') && csvNeg.includes('-300'));
  check('负数记录可被 JSON 回读', parseRecordsJSON(JSON.stringify(toExportRecords(negRecs))).ok);
}

console.log('\n[JSON 导入校验]');check('非法 JSON 被拒', parseRecordsJSON('{bad').ok === false);
check('根节点非数组被拒', parseRecordsJSON('{"a":1}').ok === false);
check('重复日期被拒', parseRecordsJSON(JSON.stringify([
  { date: '2026-10-20', title: 'a', body: 'a', ohlc: { open: 1, high: 2, low: 0.5, close: 1.5 } },
  { date: '2026-10-20', title: 'b', body: 'b', ohlc: { open: 1, high: 2, low: 0.5, close: 1.5 } },
])).ok === false);
check('OHLC 非法被拒', parseRecordsJSON(JSON.stringify([
  { date: '2026-10-20', title: 'a', body: 'a', ohlc: { open: 10, high: 5, low: 1, close: 2 } },
])).ok === false);
check('空数组视为合法', parseRecordsJSON('[]').ok === true);

console.log('\n[格式化]');
check('数字格式化', formatNumber(1234.5) === '1,234.50');
check('正数带 +', formatPct(1.5) === '+1.50%');
check('负数带 −', formatSigned(-2.5) === '−2.50');
check('零不加号', formatSigned(0) === '0.00');

console.log('\n[空数据健壮性]');
check('空数组计算不崩', computeMetrics([], 1000).length === 0);
check('normalize 处理残缺对象', normalizeRecord({}).ohlc.close === null);
check('normalize 处理 null', normalizeRecord(null).date === '');

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
