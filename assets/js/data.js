/* =========================================================
   data.js — 数据加载、校验、指标计算与导出序列化
   纯逻辑模块，不依赖 DOM，便于单独测试。
   ========================================================= */

export const BASE_VALUE = 1000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------- 基础工具 ---------------- */

export function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

/** 把 YYYY-MM-DD 转成 UTC 毫秒，便于做天数差计算 */
export function dateToMs(dateStr) {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

export function daysBetween(fromDate, toDate) {
  return Math.round((dateToMs(toDate) - dateToMs(fromDate)) / 86400000);
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(value), digits)}`;
}

export function formatPct(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(value), digits)}%`;
}

/** 涨跌方向的语义类名，颜色不是唯一区分方式 */
export function directionClass(value) {
  if (!Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 生成摘要：只截断展示，不改动原始正文 */
export function summarize(body, max = 120) {
  const text = String(body ?? '').trim();
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/* ---------------- 校验 ---------------- */

/** 校验 OHLC 关系，返回错误文案数组 */
export function validateOHLC(ohlc) {
  const errors = [];
  if (!ohlc || typeof ohlc !== 'object') {
    return ['缺少 OHLC 数据'];
  }
  const names = { open: '开盘价', high: '最高价', low: '最低价', close: '收盘价' };
  const values = {};
  for (const key of ['open', 'high', 'low', 'close']) {
    const raw = ohlc[key];
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (raw === null || raw === undefined || raw === '') {
      errors.push(`${names[key]}尚未填写`);
    } else if (!Number.isFinite(num)) {
      errors.push(`${names[key]}必须是有效数字`);
    } else {
      values[key] = num;
    }
  }
  if (errors.length) return errors;

  const { open, high, low, close } = values;
  if (high < open) errors.push('最高价必须大于等于开盘价');
  if (high < close) errors.push('最高价必须大于等于收盘价');
  if (low > open) errors.push('最低价必须小于等于开盘价');
  if (low > close) errors.push('最低价必须小于等于收盘价');
  if (low > high) errors.push('最低价必须小于等于最高价');
  return errors;
}

/** 校验一条记录（不含派生字段），返回错误文案数组 */
export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return ['记录必须是对象'];

  if (!isValidDateString(record.date)) {
    errors.push('日期必须是有效的 YYYY-MM-DD');
  }
  if (typeof record.title !== 'string' || !record.title.trim()) {
    errors.push('标题不能为空');
  }
  if (typeof record.body !== 'string' || !record.body.trim()) {
    errors.push('正文不能为空');
  }
  if (record.mood != null && typeof record.mood !== 'string') {
    errors.push('心境必须是文本');
  }
  if (record.energy != null && record.energy !== '') {
    const energy = Number(record.energy);
    if (!Number.isFinite(energy)) errors.push('能量值必须是数字');
    else if (energy < 0 || energy > 10) errors.push('能量值必须在 0 到 10 之间');
  }
  if (record.tags != null && !Array.isArray(record.tags)) {
    errors.push('标签必须是数组');
  }
  errors.push(...validateOHLC(record.ohlc));
  return errors;
}

/** 把原始 JSON 记录规范化为统一结构，缺失字段用空值占位而不是崩溃 */
export function normalizeRecord(raw) {
  const ohlc = raw?.ohlc ?? {};
  const toNum = (v) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    date: typeof raw?.date === 'string' ? raw.date : '',
    title: typeof raw?.title === 'string' ? raw.title : '',
    body: typeof raw?.body === 'string' ? raw.body : '',
    mood: typeof raw?.mood === 'string' ? raw.mood : '',
    energy: raw?.energy == null || raw.energy === '' ? null : Number(raw.energy),
    tags: Array.isArray(raw?.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    ohlc: {
      open: toNum(ohlc.open),
      high: toNum(ohlc.high),
      low: toNum(ohlc.low),
      close: toNum(ohlc.close),
    },
  };
}

export function sortRecords(records) {
  return [...records].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ---------------- 指标计算 ---------------- */

/**
 * 计算涨跌幅。
 *
 * 常规做法是 (close / prevClose - 1) × 100，但当前收为负数时该式会翻转符号：
 * 从 -200 涨到 -100 是上涨（+100），公式却算出 -50%。
 *
 * 因此这里改用「以变动幅度对前收的绝对值取比」的写法，符号由 change 单独决定：
 *   涨跌幅 = change / |prevClose| × 100
 * 这样不论前收是正、负还是 0，方向都与涨跌额保持一致。
 *
 * 前收为 0 时没有可比的基数，涨跌幅没有意义，返回 null——
 * 页面会显示「—」而不是误导性的 0.00%。涨跌额仍然准确。
 */
export function computeChangePct(close, prevClose) {
  if (!Number.isFinite(close) || !Number.isFinite(prevClose) || prevClose === 0) return null;
  return ((close - prevClose) / Math.abs(prevClose)) * 100;
}

/**
 * 为记录补齐派生指标：前收、涨跌额、涨跌幅、相对基准的累计变化。
 * 第一条记录没有前一条正式收盘价，统一以基准点位作为比较对象。
 */
export function computeMetrics(records, baseValue = BASE_VALUE) {
  const sorted = sortRecords(records);
  let prevClose = baseValue;
  return sorted.map((record) => {
    const close = record.ohlc.close;
    const change = close - prevClose;
    const changePct = computeChangePct(close, prevClose);
    const cumChange = close - baseValue;
    const cumPct = computeChangePct(close, baseValue);
    const enriched = { ...record, prevClose, change, changePct, cumChange, cumPct };
    prevClose = close;
    return enriched;
  });
}

/** 站点顶部使用的汇总指标 */
export function computeSummary(metrics, baseValue = BASE_VALUE) {
  const list = metrics;
  if (!list.length) {
    return {
      empty: true,
      count: 0,
      lastClose: null,
      lastChange: null,
      lastChangePct: null,
      cumChange: null,
      cumPct: null,
      lastDate: null,
      lastMood: '',
      lastTitle: '',
      baseValue,
    };
  }
  const last = list[list.length - 1];
  return {
    empty: false,
    count: list.length,
    lastClose: last.ohlc.close,
    lastChange: last.change,
    lastChangePct: last.changePct,
    cumChange: last.cumChange,
    cumPct: last.cumPct,
    lastDate: last.date,
    lastMood: last.mood,
    lastTitle: last.title,
    baseValue,
  };
}

/** 移动平均线：只基于真实记录计算，不补造缺失日期 */
export function movingAverage(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    const windowSize = Math.min(i + 1, period);
    if (windowSize === period) out[i] = sum / period;
  }
  return out;
}

/**
 * 合并正式记录与本地暂存记录。
 * pending 以日期为键：{ mode: 'upsert' | 'delete', record }
 * 同一天的暂存记录覆盖正式记录，但不会产生重复日期。
 */
export function mergeRecords(published, pending = {}) {
  const map = new Map();
  for (const record of published) map.set(record.date, { ...record, pending: false });
  for (const [date, item] of Object.entries(pending)) {
    if (!item) continue;
    if (item.mode === 'delete') {
      map.delete(date);
    } else if (item.record) {
      map.set(date, { ...item.record, pending: true });
    }
  }
  return sortRecords([...map.values()]);
}

export function pendingDates(pending = {}) {
  return Object.keys(pending).sort();
}

/* ---------------- 序列化与导出 ---------------- */

export function toExportRecords(records) {
  return records.map((record) => ({
    date: record.date,
    title: record.title,
    body: record.body,
    mood: record.mood ?? '',
    energy: record.energy ?? null,
    tags: Array.isArray(record.tags) ? record.tags : [],
    ohlc: {
      open: record.ohlc.open,
      high: record.ohlc.high,
      low: record.ohlc.low,
      close: record.ohlc.close,
    },
  }));
}

/** CSV 单元格转义：逗号、引号、换行都要正确处理 */
function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(records, baseValue = BASE_VALUE) {
  const metrics = computeMetrics(records, baseValue);
  const header = [
    '日期', '开盘', '最高', '最低', '收盘',
    '日涨跌额', '日涨跌幅(%)', '相对基准累计(%)', '标题', '心境', '能量', '标签',
  ];
  const rows = metrics.map((r) => [
    r.date,
    r.ohlc.open,
    r.ohlc.high,
    r.ohlc.low,
    r.ohlc.close,
    r.change.toFixed(2),
    // 百分比在没有可比基数时为 null，写出空单元格而不是 0.00
    Number.isFinite(r.changePct) ? r.changePct.toFixed(2) : '',
    Number.isFinite(r.cumPct) ? r.cumPct.toFixed(2) : '',
    r.title,
    r.mood,
    r.energy ?? '',
    (r.tags || []).join(' '),
  ]);
  // BOM 让 Excel 正确识别 UTF-8 中文
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** 解析并校验一份 JSON 记录文件，任何结构问题都拒绝而不是静默覆盖 */
export function parseRecordsJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`JSON 解析失败：${err.message}`], records: [] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, errors: ['文件根节点必须是数组'], records: [] };
  }
  const errors = [];
  const seen = new Set();
  const records = [];
  parsed.forEach((raw, index) => {
    const normalized = normalizeRecord(raw);
    const recordErrors = validateRecord(normalized);
    if (recordErrors.length) {
      errors.push(`第 ${index + 1} 条：${recordErrors.join('；')}`);
      return;
    }
    if (seen.has(normalized.date)) {
      errors.push(`第 ${index + 1} 条：日期 ${normalized.date} 重复`);
      return;
    }
    seen.add(normalized.date);
    records.push(normalized);
  });
  if (errors.length) return { ok: false, errors, records: [] };
  return { ok: true, errors: [], records: sortRecords(records) };
}

/* ---------------- 加载 ---------------- */

async function fetchJSON(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`${path} 加载失败（HTTP ${response.status}）`);
  }
  return response.json();
}

export async function loadIndex() {
  const meta = await fetchJSON('./data/index.json');
  return {
    name: meta.name ?? 'Yumesumi Index',
    name_zh: meta.name_zh ?? '梦澄指数',
    symbol: meta.symbol ?? 'YSI',
    // 基准可以是 0（此时没有可比基数，累计百分比显示为「—」），
    // 所以不能用 || 兜底，也不能把 null 当成 0
    base_value: meta.base_value === null || meta.base_value === undefined || meta.base_value === ''
      ? BASE_VALUE
      : (Number.isFinite(Number(meta.base_value)) ? Number(meta.base_value) : BASE_VALUE),
    base_date: isValidDateString(meta.base_date) ? meta.base_date : '',
    frequency: meta.frequency ?? 'daily',
    data_mode: meta.data_mode ?? 'manual',
  };
}

/**
 * 加载正式记录。非法记录不会让整页崩溃：单独收集并回报。
 */
export async function loadRecords() {
  const raw = await fetchJSON('./data/records.json');
  if (!Array.isArray(raw)) {
    throw new Error('data/records.json 根节点必须是数组');
  }
  const invalid = [];
  const valid = [];
  const seen = new Set();
  raw.forEach((item, index) => {
    const normalized = normalizeRecord(item);
    const errors = validateRecord(normalized);
    if (errors.length) {
      invalid.push({ index, date: normalized.date, errors });
      return;
    }
    if (seen.has(normalized.date)) {
      invalid.push({ index, date: normalized.date, errors: ['日期重复'] });
      return;
    }
    seen.add(normalized.date);
    valid.push(normalized);
  });
  return { records: sortRecords(valid), invalid };
}
