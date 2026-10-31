/* 选择器：时间窗口、范围筛选、检索、归档与分页 */

import { dateToMs, daysBetween, groupByYear, yearOf } from './data.js';

export const DAY_MS = 86400000;

export const RANGES = [
  { key: '7', label: '7 天', days: 7 },
  { key: '30', label: '30 天', days: 30 },
  { key: '90', label: '90 天', days: 90 },
  { key: '180', label: '180 天', days: 180 },
  { key: '365', label: '1 年', days: 365 },
  { key: '1095', label: '3 年', days: 1095 },
  { key: 'all', label: '成立来', days: null },
];

export const FREQUENCY_LABEL = {
  daily: '日频',
  weekly: '周频',
  monthly: '月频',
};

export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isoFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function formatWindowLabel(window) {
  if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)) return '';
  return `${isoFromMs(window.startMs)} — ${isoFromMs(window.endMs)}`;
}

export function rangeLabel(rangeKey) {
  if (rangeKey === 'custom') return '自定义窗口';
  return RANGES.find((r) => r.key === rangeKey)?.label ?? '成立来';
}

/**
 * 时间窗口以“最后一条记录”为锚点，而不是今天。
 * 这样 7 天 / 30 天等窗口总能落在真实填写过的日期上。
 */
export function resolveWindow(metrics, rangeKey = '365', customWindow = null) {
  if (customWindow && Number.isFinite(customWindow.startMs) && Number.isFinite(customWindow.endMs)
    && customWindow.endMs > customWindow.startMs) {
    return { startMs: customWindow.startMs, endMs: customWindow.endMs };
  }
  if (!metrics.length) return null;
  const firstMs = dateToMs(metrics[0].date);
  const lastMs = dateToMs(metrics[metrics.length - 1].date);
  const pad = DAY_MS;
  if (rangeKey === 'all') {
    return { startMs: firstMs - pad, endMs: lastMs + pad };
  }
  const range = RANGES.find((r) => r.key === rangeKey);
  if (!range?.days) {
    return { startMs: firstMs - pad, endMs: lastMs + pad };
  }
  const endMs = lastMs + pad;
  let startMs = endMs - range.days * DAY_MS;
  if (startMs < firstMs - pad) startMs = firstMs - pad;
  return { startMs, endMs };
}

export function recordsInWindow(metrics, window) {
  if (!window) return metrics;
  return metrics.filter((record) => {
    const ms = dateToMs(record.date);
    return ms >= window.startMs && ms <= window.endMs;
  });
}

export function rangeEmptyHint(metrics, window = null) {
  if (!metrics.length) return '';
  if (window) {
    return `当前窗口 ${formatWindowLabel(window)} 内没有记录。可以滚动缩放或拖拽查看其他时间段。`;
  }
  const last = metrics[metrics.length - 1];
  const gap = daysBetween(last.date, todayISO());
  return `最近一条记录是 ${last.date}，距今 ${gap} 天。`;
}

export function journalMatches(record, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    record.title, record.body, record.mood, (record.tags || []).join(' '),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

export function latestEntries(metrics, count = 4) {
  return [...metrics].reverse().slice(0, count);
}

export function archiveYears(records) {
  return groupByYear(records).map(({ year, count }) => ({ year, count }));
}

export function yearsInRange(records, rangeKey, window) {
  const filtered = recordsInWindow(records, window);
  return new Set(filtered.map((r) => yearOf(r.date)));
}
