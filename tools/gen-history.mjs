/* =========================================================
   tools/gen-history.mjs — 生成梦澄指数的日频历史序列

   数据规则：
     · 点位只使用整数，不使用小数
     · 2017-11-11 至 2026-10-28 每天一篇
     · 2026-10-29 至今天，每天收盘跌幅超过 10%
     · 2026-11-04 梦澄集团破产，指数收于 -30000
     · 只记录指数变化，不写生活与情绪

   用法：
     node tools/gen-history.mjs            写入 journal/ 日频文件
     node tools/gen-history.mjs --dry      只打印计划
     node tools/gen-history.mjs --stats    打印统计
     node tools/gen-history.mjs --dump     打印全部日期与收盘

   曲线构造：以 ANCHORS 为控制点按日线性插值，再叠加带种子的
   日级噪声；噪声在每个区间两端收敛到 0，锚点日期取精确整数。
   固定随机种子，重复运行结果一致。
   ========================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const JOURNAL_DIR = path.join(REPO, 'journal');

const START_DATE = '2017-11-11';
const HISTORY_END = '2026-10-28';
const CRASH_START = '2026-10-29';
const CRASH_FACTOR = 1.105;
const EVENT_END = '2026-11-04';
const EVENT_DAYS = {
  '2026-11-04': {
    close: -30000,
    title: '梦澄集团破产：指数直落 -30000',
    body: '梦澄集团破产的消息冲击市场，指数单日重挫。',
  },
};
const PEAK_CLOSE = 36741;

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TODAY = todayISO();

/* ---------------- 走势控制点 ----------------
   每一段是 [日期, 收盘点位]，中间按日线性插值。
   描述：2017~2019 震荡走高摸到 24000；2020~2022 高位横盘，
   2021.2.24 见顶 36741；22 年底跌回 8000；2023 起阴跌，
   2024.5.1 跌破基准线 0 后一路水下；2025.5.2-5.4 三连暴跌；
   2026.9.10 单日暴跌；2026.10.28 水下 12000。            */
const ANCHORS = [
  ['2017-11-11', 8600],
  ['2018-04-15', 12400],
  ['2018-11-18', 10800],
  ['2019-05-19', 18600],
  ['2019-12-22', 24000],
  ['2020-06-21', 26800],
  ['2020-12-20', 23200],
  ['2021-02-24', 36741],
  ['2021-09-26', 31200],
  ['2022-04-24', 28600],
  ['2022-11-27', 12400],
  ['2022-12-31', 8000],
  ['2023-06-25', 5200],
  ['2023-12-24', 3100],
  ['2024-04-28', 900],
  ['2024-05-01', -260],
  ['2024-11-24', -3400],
  ['2025-04-27', -6100],
  ['2025-05-02', -8400],
  ['2025-05-03', -10200],
  ['2025-05-04', -11900],
  ['2025-06-01', -10600],
  ['2025-11-02', -9600],
  ['2026-04-05', -10400],
  ['2026-09-09', -10900],
  ['2026-09-10', -13400],
  ['2026-09-27', -12100],
  ['2026-10-28', -12000],
];

const ANCHOR_DATES = new Set(ANCHORS.map(([date]) => date));

/* ---------------- 伪随机（固定种子，保证可复现） ---------------- */

function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashDate(date) {
  return [...date].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
}

/* ---------------- 日期工具 ---------------- */

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);

function addDays(dateStr, n) {
  const d = toDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

function eachDay(start, end) {
  const dates = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/* ---------------- 曲线插值 ---------------- */

/** 在控制点之间做线性插值；波动形态交给噪声包络塑造 */
function baselineValue(date) {
  const t = toDate(date).getTime();
  if (t <= toDate(ANCHORS[0][0]).getTime()) return ANCHORS[0][1];
  const last = ANCHORS[ANCHORS.length - 1];
  if (t >= toDate(last[0]).getTime()) return last[1];

  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    const [d0, v0] = ANCHORS[i];
    const [d1, v1] = ANCHORS[i + 1];
    const t0 = toDate(d0).getTime();
    const t1 = toDate(d1).getTime();
    if (t < t0 || t > t1) continue;
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return last[1];
}

/** 日级波动基准：周频波动缩小到约 1/5 */
function dailyVolatilityAt(date) {
  const year = Number(date.slice(0, 4));
  const base = year <= 2019 ? 0.035 : year <= 2022 ? 0.012 : 0.022;
  const t = toDate(date).getTime();
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    const t0 = toDate(ANCHORS[i][0]).getTime();
    const t1 = toDate(ANCHORS[i + 1][0]).getTime();
    if (t < t0 || t > t1) continue;
    const raw = (t - t0) / (t1 - t0);
    const envelope = Math.sin(raw * Math.PI);
    return base * Math.max(0.2, envelope) * 0.22;
  }
  return base * 0.22;
}

/* ---------------- 收盘价序列 ---------------- */

function buildHistorySeries() {
  const dates = eachDay(START_DATE, HISTORY_END);
  const rand = makeRandom(20261103);
  const series = [];
  let prev = null;

  dates.forEach((date, index) => {
    const base = baselineValue(date);
    let close = base;

    if (!ANCHOR_DATES.has(date)) {
      const vol = dailyVolatilityAt(date);
      const noise = (rand() - 0.5) * 2 * vol
        + Math.sin(index * 0.63) * vol * 0.35
        + (rand() - 0.5) * vol * 0.55;
      close += Math.abs(base || 1) * noise;
    }

    close = Math.min(PEAK_CLOSE, Math.round(close));
    series.push({ date, close, prevClose: prev });
    prev = close;
  });

  return series;
}

function buildCrashSeries(startClose) {
  const end = TODAY > EVENT_END ? TODAY : EVENT_END;
  const dates = eachDay(CRASH_START, end);
  const series = [];
  let prev = startClose;

  dates.forEach((date, index) => {
    const event = EVENT_DAYS[date];
    const close = event ? event.close : Math.floor(prev * CRASH_FACTOR);
    const rate = (close - prev) / Math.abs(prev);
    if (rate > -0.1) {
      throw new Error(`跌幅不足 10%：${date} ${prev} -> ${close}`);
    }
    series.push({
      date,
      close,
      prevClose: prev,
      crashIndex: index + 1,
      event,
    });
    prev = close;
  });

  return series;
}

/* ---------------- OHLC（全部整数） ---------------- */

function buildOHLC(entry, isCrash = false) {
  const { date, close, prevClose } = entry;
  const prev = prevClose ?? close;
  const seed = hashDate(date);
  const move = close - prev;

  const open = Math.round(prev + move * (0.15 + (seed % 25) / 100));
  const bodyTop = Math.max(open, close);
  const bodyBottom = Math.min(open, close);
  const scale = isCrash
    ? Math.max(30, Math.abs(close) * 0.008)
    : Math.max(6, Math.abs(close) * 0.002 + Math.abs(move) * 0.25);
  const upper = Math.round(scale + (seed % 23));
  const lower = Math.round(scale + ((seed >>> 5) % 23));

  return {
    open,
    high: bodyTop + upper,
    low: bodyBottom - lower,
    close,
  };
}

function buildCrashOHLC(entry) {
  const seed = hashDate(entry.date);
  const open = entry.prevClose;
  const close = entry.close;
  return {
    open,
    high: Math.max(open, close) + 20 + (seed % 70),
    low: Math.min(open, close) - 20 - ((seed >>> 5) % 70),
    close,
  };
}

/* ---------------- 标题与正文 ---------------- */

function makeTitle(date, ohlc, prevClose, index, total, ctx) {
  if (ctx.event?.title) return ctx.event.title;
  if (ctx.crash) {
    if (index === total - 1) return '最新一期：连续下跌仍在延续';
    return `连续下跌：第 ${ctx.crashIndex} 日跌幅超 10%`;
  }
  if (index === total - 1) return '最新一期：指数仍在水下徘徊';
  if (date === '2021-02-24') return '历史最高点：阶段顶部';
  if (date === '2024-05-01') return '跌破基准线：转入水下';
  if (date === '2025-05-02' || date === '2025-05-03' || date === '2025-05-04') return '连续暴跌：三日重挫';
  if (date === '2026-09-10') return '单日暴跌：断崖下挫';

  const change = prevClose === null ? 0 : ohlc.close - prevClose;
  const dir = change > 0 ? '涨' : change < 0 ? '跌' : '平';
  const ratio = Math.abs(change) / Math.max(Math.abs(prevClose ?? ohlc.close), 1);
  const close = ohlc.close;

  const year = Number(date.slice(0, 4));
  let phase = '';
  if (year <= 2019) phase = '震荡上行';
  else if (year <= 2022) phase = '高位盘整';
  else phase = '阴跌延续';

  const belowBase = close < 0;
  const fromPeak = ctx.peak > 0 ? Math.abs((ctx.peak - close) / ctx.peak) : 0;
  let waterMark;
  if (belowBase) {
    waterMark = fromPeak > 0.9 ? '深水区' : fromPeak > 0.7 ? '水下' : '浅水区';
  } else {
    waterMark = close > ctx.peak * 0.9 ? '逼近峰值'
      : close > ctx.peak * 0.7 ? '高位'
        : close > ctx.peak * 0.4 ? '半山' : '山脚';
  }

  const streakWord = ctx.streak >= 4 ? '连跌' : ctx.streak >= 3 ? '续跌' : ctx.streak >= 2 ? '延续跌势' : '';

  if (ratio > 0.06) return belowBase ? `${waterMark}·跌幅扩大` : `${phase}·涨势扩大`;
  if (ratio > 0.025) return streakWord ? `${waterMark}·${streakWord}` : `${phase}·${dir}势明显`;
  if (ratio > 0.008) return streakWord ? `${waterMark}·${streakWord}` : `${phase}·小幅${dir}落`;
  return belowBase ? `${waterMark}·盘整` : `${phase}·窄幅整理`;
}

function makeBody(date, ohlc, isCrash, event) {
  const year = Number(date.slice(0, 4));
  let context;
  if (year <= 2019) context = '区间在震荡中逐步抬高，波动幅度较大。';
  else if (year <= 2021) context = '点位维持在高位区间运行，横向整理明显。';
  else if (year === 2022) context = '高位盘整的形态被打破，指数开始快速回落。';
  else if (year <= 2024) context = '阴跌延续，下行通道清晰，中途短暂跌破基准线。';
  else context = '指数持续运行于基准线下方，反弹力度有限。';

  return [
    `本日记录：${date}。`,
    `开 ${ohlc.open}，高 ${ohlc.high}，低 ${ohlc.low}，收 ${ohlc.close}。`,
    context,
    ...(event?.body ? [event.body] : []),
    ...(isCrash ? ['当日跌幅超过 10%。'] : []),
    '本日仅记录指数变化。',
  ].join('\n');
}

function journalContent(date, ohlc, prevClose, index, total, ctx) {
  const title = makeTitle(date, ohlc, prevClose, index, total, ctx);
  const body = makeBody(date, ohlc, ctx.crash, ctx.event);
  return `---\ntitle:${title}\nopen:${ohlc.open}\nhigh:${ohlc.high}\nlow:${ohlc.low}\nclose:${ohlc.close}\n---\n${body}\n`;
}

/* ---------------- 入口 ---------------- */

const args = process.argv.slice(2);
const history = buildHistorySeries();
const crash = buildCrashSeries(history[history.length - 1].close);

const entries = [
  ...history.map((item) => ({ ...item, crash: false, crashIndex: 0 })),
  ...crash.map((item) => ({ ...item, crash: true })),
].map((item) => ({
  ...item,
  ohlc: item.crash ? buildCrashOHLC(item) : buildOHLC(item, false),
}));

const peak = Math.max(...entries.map((e) => e.close));
let streak = 0;
let lastSign = 0;
entries.forEach((entry, index) => {
  const prev = index > 0 ? entries[index - 1].close : null;
  const change = prev === null ? 0 : entry.close - prev;
  const sign = change > 0 ? 1 : change < 0 ? -1 : 0;
  if (sign !== 0 && sign === lastSign) streak += 1;
  else if (sign !== 0) { streak = 1; lastSign = sign; }
  else streak = 0;
  entry.ctx = {
    peak,
    streak: sign < 0 ? streak : 0,
    crash: entry.crash,
    crashIndex: entry.crashIndex,
    event: entry.event,
  };
});

if (args.includes('--stats') || args.includes('--dry')) {
  console.log(`计划生成 ${entries.length} 篇日频日记（${entries[0].date} ~ ${entries[entries.length - 1].date}）`);
  console.log(`历史 ${history.length} 篇，连续下跌 ${crash.length} 篇`);
}
if (args.includes('--stats')) {
  const max = entries.reduce((a, b) => (b.close > a.close ? b : a));
  const min = entries.reduce((a, b) => (b.close < a.close ? b : a));
  console.log(`最高: ${max.close} @ ${max.date}`);
  console.log(`最低: ${min.close} @ ${min.date}`);
  console.log(`当前: ${entries[entries.length - 1].close}`);
  const below = entries.filter((e) => e.close < 0);
  console.log(`水下记录: ${below.length} 条，首次 ${below[0]?.date}`);
  for (const item of crash) {
    const rate = (item.close - item.prevClose) / Math.abs(item.prevClose) * 100;
    console.log(`  ${item.date} ${item.prevClose} -> ${item.close} (${rate.toFixed(2)}%)`);
  }
  const nonInteger = entries.filter((e) => [e.ohlc.open, e.ohlc.high, e.ohlc.low, e.ohlc.close].some((v) => !Number.isInteger(v)));
  console.log(`非整数 OHLC: ${nonInteger.length} 条`);
  process.exit(0);
}
if (args.includes('--dump')) {
  for (const e of entries) console.log(`${e.date} ${e.close}`);
  process.exit(0);
}
if (args.includes('--dry')) process.exit(0);

// 清理旧日记
if (fs.existsSync(JOURNAL_DIR)) {
  for (const file of fs.readdirSync(JOURNAL_DIR)) {
    if (/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) fs.unlinkSync(path.join(JOURNAL_DIR, file));
  }
}

entries.forEach((entry, index) => {
  const content = journalContent(
    entry.date, entry.ohlc, entry.prevClose, index, entries.length, entry.ctx,
  );
  fs.writeFileSync(path.join(JOURNAL_DIR, `${entry.date}.md`), content, 'utf-8');
});

console.log(`✓ 已生成 ${entries.length} 篇日频日记到 journal/`);
console.log(`  区间 ${entries[0].date} ~ ${entries[entries.length - 1].date}`);
console.log(`  历史 ${history.length} 篇，连续下跌 ${crash.length} 篇`);
console.log(`  最高 ${Math.max(...entries.map((e) => e.close))}，当前 ${entries[entries.length - 1].close}`);
console.log('  下一步：node tools/journal.mjs sync');