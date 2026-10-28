/* 选择器：范围筛选、检索、归档与分页，供各视图共用 */

import { daysBetween, groupByYear, yearOf } from './data.js';

export const RANGES = [
  { key: '90', label: '90 天', days: 90 },
  { key: '365', label: '1 年', days: 365 },
  { key: '1095', label: '3 年', days: 1095 },
  { key: 'all', label: '全部', days: null },
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

/** 时间范围筛选：相对今天；范围内没有记录就如实显示空状态，不补造 K 线 */
export function filterByRange(metrics, rangeKey, now = new Date()) {
  if (rangeKey === 'all') return metrics;
  const range = RANGES.find((r) => r.key === rangeKey);
  if (!range?.days) return metrics;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (range.days - 1));
  const pad = (n) => String(n).padStart(2, '0');
  const cutoffStr = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
  return metrics.filter((m) => m.date >= cutoffStr);
}

export function rangeEmptyHint(metrics, now = new Date()) {
  const last = metrics[metrics.length - 1];
  if (!last) return '';
  const gap = daysBetween(last.date, todayISO(now));
  return `当前时间范围内没有记录。最近一条记录是 ${last.date}，距今 ${gap} 天。`;
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

export function yearsInRange(records, rangeKey, now = new Date()) {
  const filtered = rangeKey === 'all' ? records : records.filter((r) => {
    const cutoff = new Date(now);
    const range = RANGES.find((x) => x.key === rangeKey);
    if (!range?.days) return true;
    cutoff.setDate(cutoff.getDate() - (range.days - 1));
    const pad = (n) => String(n).padStart(2, '0');
    const cutoffStr = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
    return r.date >= cutoffStr;
  });
  return new Set(filtered.map((r) => yearOf(r.date)));
}
