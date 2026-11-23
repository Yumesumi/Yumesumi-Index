/* 日记条目：列表单行 + 详情行情条 */

import {
  directionClass, escapeHtml, formatDateLong, formatNumber,
  formatPct, formatSigned,
} from '../lib/data.js';
import { icon } from './icons.js';

/** 日记列表的单行条目，不展示封面、摘要或价格 */
export function entryRow(record, index = 0) {
  return `
    <button type="button" class="journal-row reveal" style="--i:${index % 8}"
      data-action="view" data-date="${record.date}"
      aria-label="阅读 ${record.date} ${escapeHtml(record.title)}">
      <time datetime="${record.date}" title="${formatDateLong(record.date)}">${record.date.replaceAll('-', '.')}</time>
      <span class="journal-row-title">${escapeHtml(record.title)}</span>
      <span class="journal-row-side">
        ${record.pending ? '<span class="badge badge-warn">待发布</span>' : ''}
        ${icon('arrowRight', 14)}
      </span>
    </button>`;
}

export function entryMetaHtml(record) {
  const dir = directionClass(record.change);
  const cumDir = directionClass(record.cumChange);
  return `
    <div class="entry-meta detail-meta">
      ${record.mood ? `<span class="meta-mood">${escapeHtml(record.mood)}</span>` : ''}
      ${Number.isFinite(record.energy) ? `<span class="meta-num">能量 ${record.energy}</span>` : ''}
      ${(record.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      ${record.pending ? '<span class="badge badge-warn">待发布</span>' : ''}
    </div>
    <div class="quote-strip">
      <div><span>开盘</span><b>${formatNumber(record.ohlc.open)}</b></div>
      <div><span>收盘</span><b>${formatNumber(record.ohlc.close)}</b></div>
      <div><span>日变化</span><b class="${dir}">${formatSigned(record.change)} <small>${formatPct(record.changePct)}</small></b></div>
      <div><span>累计</span><b class="${cumDir}">${formatSigned(record.cumChange)} <small>${formatPct(record.cumPct)}</small></b></div>
    </div>`;
}