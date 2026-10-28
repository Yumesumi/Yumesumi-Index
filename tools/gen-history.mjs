/* =========================================================
   tools/gen-history.mjs — 生成梦澄指数的历史周记序列

   按既定的走势描述，生成 2017-11-11 至今日的日记文件：
     · 常规区间每周一篇
     · 关键日期前后逐日生成（见 EXTRA_DAYS）
     · 只记录指数变化，不写生活与情绪

   用法：
     node tools/gen-history.mjs            生成日记文件
     node tools/gen-history.mjs --dry      只打印计划，不写文件
     node tools/gen-history.mjs --stats    打印走势统计

   曲线构造：以 ANCHORS 为控制点分段插值，再用带种子的伪随机
   噪声叠加，形成自然的波动。所有随机都带固定种子，重复运行
   结果完全一致，便于复现与审阅。
   ========================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const JOURNAL_DIR = path.join(REPO, 'journal');

const START_DATE = '2017-11-11';
const END_DATE = new Date().toISOString().slice(0, 10);

/* ---------------- 走势控制点 ----------------
   每一段是 [日期, 收盘点位]，中间线性插值。
   描述：2017~2019 震荡走高摸到 24000；2020~2022 高位横盘，
   2021.2.24 见顶 36741；22 年底跌回 8000；2023 起阴跌，
   2024.5.1 跌破基准线 0 后一路水下；2025.5.2-5.4 三连暴跌；
   2026.9.10 单日暴跌；目前水下 12000 附近。            */
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

/* 关键日期：这些日子逐日生成，用来呈现暴跌等剧烈变化 */
const EXTRA_DAYS = [
  '2021-02-22', '2021-02-23', '2021-02-24', '2021-02-25', '2021-02-26',
  '2024-04-29', '2024-04-30', '2024-05-01', '2024-05-02', '2024-05-03',
  '2025-04-30', '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05',
  '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11',
];

/* 控制点上的日期必须取锚点原值，不叠加噪声——
   2021.2.24 的 36741、2026.9.10 的暴跌幅度等都是叙事锚点，不能被噪声改动。 */
const ANCHOR_DATES = new Set(ANCHORS.map(([d]) => d));

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

/* ---------------- 日期工具 ---------------- */

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const WEEK = 7;

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

/**
 * 波动幅度随阶段而异：
 *   2017~2019 震荡期振幅大；2020~2022 横盘期振幅小；
 *   2023 之后阴跌期中等，暴跌日附近压到最低以免掩盖真实跳空。
 *
 * 关键：噪声必须收敛到区间两端。做法是在每个锚点区间内，
 * 用「到两端的距离」构造一个 0→1→0 的包络，噪声乘上它。
 * 这样区间的极值天然落在端点上，2021.2.24 的 36741 就一定是最高点。
 */
function volatilityAt(date) {
  const y = Number(date.slice(0, 4));
  const base = y <= 2019 ? 0.035 : y <= 2022 ? 0.012 : 0.022;

  // 找到所在的锚点区间
  const t = toDate(date).getTime();
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    const t0 = toDate(ANCHORS[i][0]).getTime();
    const t1 = toDate(ANCHORS[i + 1][0]).getTime();
    if (t < t0 || t > t1) continue;
    const raw = (t - t0) / (t1 - t0);
    // 包络：两端为 0，中段为 1
    const envelope = Math.sin(raw * Math.PI);
    return base * envelope;
  }
  return 0;
}

function isCrashWindow(date) {
  return EXTRA_DAYS.some((d) => Math.abs(daysBetween(d, date)) <= 1);
}

/* ---------------- 生成收盘价序列 ---------------- */

function buildSeries() {
  const dates = [];
  // 每周一篇：从起始日逐周推进
  for (let d = START_DATE; d <= END_DATE; d = addDays(d, WEEK)) {
    dates.push(d);
  }
  // 关键日期逐日补上
  for (const d of EXTRA_DAYS) {
    if (d >= START_DATE && d <= END_DATE && !dates.includes(d)) dates.push(d);
  }
  // 末日必须落在区间内，否则最后一周会漏掉
  if (!dates.includes(END_DATE)) dates.push(END_DATE);
  dates.sort();

  const rand = makeRandom(20261028);
  const series = [];
  let prev = null;

  for (const date of dates) {
    const base = baselineValue(date);
    let close = base;

    // 锚点日期取精确值，不叠加噪声
    if (!ANCHOR_DATES.has(date) && !isCrashWindow(date)) {
      const vol = volatilityAt(date);
      // 三个不同频率叠加，避免看起来像单一正弦
      const noise = (rand() - 0.5) * 2 * vol
        + Math.sin(date.length * 1.7) * vol * 0.35
        + (rand() - 0.5) * vol * 0.6;
      close += Math.abs(base) * noise;
    }

    // 与前一条保持连续：包络已保证平滑，这里只兜住异常的大跳空
    // （暴跌窗口刻意放开，让真实跳空得以呈现）
    if (prev !== null && !isCrashWindow(date) && !isCrashWindow(prev.date)) {
      const maxJump = Math.max(600, Math.abs(prev.close) * 0.12);
      const jump = close - prev.close;
      if (Math.abs(jump) > maxJump) {
        close = prev.close + Math.sign(jump) * maxJump;
      }
    }

    // 末日固定为当前点位
    if (date === END_DATE) close = ANCHORS[ANCHORS.length - 1][1];

    close = Math.round(close * 100) / 100;
    series.push({ date, close });
    prev = series[series.length - 1];
  }
  return series;
}

/* ---------------- 由收盘价推出 OHLC ---------------- */

/** 根据当日涨跌幅生成合理的开高低收 */
function buildOHLC(entry, prevClose) {
  const { date, close } = entry;
  const prev = prevClose ?? close;
  const move = close - prev;
  const magnitude = Math.abs(close);

  // 开盘：从前收向收盘方向走一小段
  const seed = [...date].reduce((a, c) => a + c.charCodeAt(0), 0);
  const openGap = move * (0.25 + ((seed % 17) / 100));
  let open = prev + openGap;

  // 上下影线长度：暴跌日影线更长（盘中剧烈波动）
  const isCrash = isCrashWindow(date);
  const wickScale = (isCrash ? 0.85 : 0.32) * (magnitude * 0.012 + Math.abs(move) * 0.35 + 40);
  const upperWick = wickScale * (0.6 + ((seed % 23) / 40));
  const lowerWick = wickScale * (0.6 + (((seed >> 5) % 19) / 40));

  const high = Math.max(open, close) + upperWick;
  const low = Math.min(open, close) - lowerWick;

  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    open: r2(open),
    high: r2(high),
    low: r2(low),
    close: r2(close),
  };
}

/* ---------------- 标题与正文 ---------------- */

/**
 * 依据当日走势、阶段位置与所处水位生成纯指数化的标题。
 *
 * 除了涨跌方向与幅度，还掺入「离峰值的距离」「离基准线的距离」
 * 「连续同向的天数」等维度，让标题更贴近当期实际形态，
 * 而不是同一个模板反复出现。
 */
function makeTitle(date, ohlc, prevClose, index, total, ctx) {
  const change = prevClose === null ? 0 : ohlc.close - prevClose;
  const dir = change > 0 ? '涨' : change < 0 ? '跌' : '平';
  const ratio = Math.abs(change) / Math.max(Math.abs(prevClose ?? ohlc.close), 1);
  const close = ohlc.close;

  const year = Number(date.slice(0, 4));
  let phase = '';
  if (year <= 2019) phase = '震荡上行';
  else if (year <= 2022) phase = '高位盘整';
  else phase = '阴跌延续';

  // 关键日期用固定标题
  if (index === total - 1) return '最新一期：指数仍在水下徘徊';
  if (date === '2021-02-24') return '历史最高点：阶段顶部';
  if (date === '2024-05-01') return '跌破基准线：转入水下';
  if (date === '2025-05-02' || date === '2025-05-03' || date === '2025-05-04') return '连续暴跌：三日重挫';
  if (date === '2026-09-10') return '单日暴跌：断崖下挫';

  // 水位描述：以基准线 0 为界，水下再按跌幅深浅细分
  const belowBase = close < 0;
  const fromPeak = ctx.peak > 0 ? Math.abs((ctx.peak - close) / ctx.peak) : 0;
  let waterMark;
  if (belowBase) {
    // 水下：按占峰值的跌幅分档
    waterMark = fromPeak > 0.9 ? '深水区' : fromPeak > 0.7 ? '水下' : '浅水区';
  } else {
    waterMark = close > ctx.peak * 0.9 ? '逼近峰值'
      : close > ctx.peak * 0.7 ? '高位'
        : close > ctx.peak * 0.4 ? '半山' : '山脚';
  }

  // 连续同向天数
  const streak = ctx.streak;
  const streakWord = streak >= 4 ? '连跌' : streak >= 3 ? '续跌' : streak >= 2 ? '延续跌势' : '';

  if (ratio > 0.06) {
    return belowBase ? `${waterMark}·跌幅扩大` : `${phase}·涨势扩大`;
  }
  if (ratio > 0.025) {
    return streakWord
      ? `${waterMark}·${streakWord}`
      : `${phase}·${dir}势明显`;
  }
  if (ratio > 0.008) {
    return streakWord ? `${waterMark}·${streakWord}` : `${phase}·小幅${dir}落`;
  }
  // 窄幅：用水位与阶段描述，细化「高位盘整·窄幅整理」这类高频标题
  return belowBase ? `${waterMark}·盘整` : `${phase}·窄幅整理`;
}

/** 纯指数叙述的正文，不涉及生活与情绪 */
function makeBody(date, ohlc, index) {
  const year = Number(date.slice(0, 4));
  let context;
  if (year <= 2019) context = '区间在震荡中逐步抬高，波动幅度较大。';
  else if (year <= 2021) context = '点位维持在高位区间运行，横向整理明显。';
  else if (year === 2022) context = '高位盘整的形态被打破，指数开始快速回落。';
  else if (year <= 2024) context = '阴跌延续，下行通道清晰，中途短暂跌破基准线。';
  else context = '指数持续运行于基准线下方，反弹力度有限。';

  return [
    `本期记录：${date}。`,
    `开 ${ohlc.open}，高 ${ohlc.high}，低 ${ohlc.low}，收 ${ohlc.close}。`,
    context,
    '本期仅记录指数变化。',
  ].join('\n');
}

/* ---------------- 文件生成 ---------------- */

function journalContent(date, ohlc, prevClose, index, total, ctx) {
  const title = makeTitle(date, ohlc, prevClose, index, total, ctx);
  const body = makeBody(date, ohlc, index);
  return `---\ntitle:${title}\nopen:${ohlc.open}\nhigh:${ohlc.high}\nlow:${ohlc.low}\nclose:${ohlc.close}\n---\n${body}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const statsOnly = args.includes('--stats');

  const series = buildSeries();
  const entries = series.map((s, i) => ({
    ...s,
    prevClose: i > 0 ? series[i - 1].close : null,
    ohlc: buildOHLC(s, i > 0 ? series[i - 1].close : null),
  }));

  // 标题需要的上下文：历史峰值、连续同向天数
  const peak = Math.max(...entries.map((e) => e.close));
  let streak = 0;
  let lastSign = 0;
  entries.forEach((e, i) => {
    const prev = i > 0 ? entries[i - 1].close : null;
    const change = prev === null ? 0 : e.close - prev;
    const sign = change > 0 ? 1 : change < 0 ? -1 : 0;
    if (sign !== 0 && sign === lastSign) streak += 1;
    else if (sign !== 0) { streak = 1; lastSign = sign; }
    else streak = 0;
    e.ctx = { peak, streak: sign < 0 ? streak : 0 };
  });

  if (statsOnly || dry) {
    console.log(`计划生成 ${entries.length} 篇日记（${entries[0].date} ~ ${entries[entries.length - 1].date}）`);
    console.log(`周记 ${series.filter((s, i) => !EXTRA_DAYS.includes(s.date)).length} 篇，关键日 ${series.filter((s) => EXTRA_DAYS.includes(s.date)).length} 篇`);
  }
  if (statsOnly) {
    const max = entries.reduce((a, b) => (b.close > a.close ? b : a));
    const min = entries.reduce((a, b) => (b.close < a.close ? b : a));
    console.log(`最高: ${max.close} @ ${max.date}`);
    console.log(`最低: ${min.close} @ ${min.date}`);
    console.log(`当前: ${entries[entries.length - 1].close}`);
    const below = entries.filter((e) => e.close < 0);
    console.log(`水下记录: ${below.length} 条，首次 ${below[0]?.date}`);
    return;
  }
  if (args.includes('--dump')) {
    for (const e of entries) console.log(`${e.date} ${e.close}`);
    return;
  }
  if (dry) return;

  // 清理旧日记
  if (fs.existsSync(JOURNAL_DIR)) {
    for (const f of fs.readdirSync(JOURNAL_DIR)) {
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) fs.unlinkSync(path.join(JOURNAL_DIR, f));
    }
  }

  // 写入新日记
  entries.forEach((e, i) => {
    const content = journalContent(e.date, e.ohlc, e.prevClose, i, entries.length, e.ctx);
    fs.writeFileSync(path.join(JOURNAL_DIR, `${e.date}.md`), content, 'utf-8');
  });

  console.log(`✓ 已生成 ${entries.length} 篇日记到 journal/`);
  console.log(`  区间 ${entries[0].date} ~ ${entries[entries.length - 1].date}`);
  const max = entries.reduce((a, b) => (b.close > a.close ? b : a));
  console.log(`  最高 ${max.close} @ ${max.date}`);
  console.log(`  最低 ${Math.min(...entries.map((e) => e.close))}`);
}

main();
