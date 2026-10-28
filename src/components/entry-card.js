/* 日记条目卡片：概览与日记列表共用 */

import {
  assetUrl, directionClass, escapeHtml, formatDateLong, formatNumber,
  formatPct, formatSigned, summarize,
} from '../lib/data.js';
import { icon } from './icons.js';

function dateParts(date) {
  return {
    ymd: date.replaceAll('-', '.'),
    long: formatDateLong(date),
  };
}

export function entryCard(record, index = 0) {
  const { ymd, long } = dateParts(record.date);
  const dir = directionClass(record.change);
  const cover = record.cover
    ? `<button type="button" class="entry-cover" data-action="view" data-date="${record.date}" aria-label="阅读 ${record.date} 的日记">
         <img src="${assetUrl(record.cover)}" alt="" loading="lazy" decoding="async">
       </button>`
    : '';
  return `
    <article class="entry glass-soft reveal ${record.cover ? 'has-cover' : ''}" style="--i:${index % 6}" data-date="${record.date}">
      <div class="entry-main">
        <div class="entry-head">
          <div class="entry-date">
            <time datetime="${record.date}" title="${long}">${ymd}</time>
            ${record.pending ? '<span class="badge badge-warn">待发布</span>' : ''}
          </div>
          <button type="button" class="text-btn" data-action="view" data-date="${record.date}">
            阅读 ${icon('arrowRight', 13)}
          </button>
        </div>
        <h3 class="entry-title">
          <button type="button" data-action="view" data-date="${record.date}">${escapeHtml(record.title)}</button>
        </h3>
        <p class="entry-summary">${escapeHtml(summarize(record.body, 148))}</p>
        <div class="entry-meta">
          ${record.mood ? `<span class="meta-mood">${escapeHtml(record.mood)}</span>` : ''}
          ${Number.isFinite(record.energy) ? `<span class="meta-num">能量 ${record.energy}</span>` : ''}
          <span class="meta-num">收 ${formatNumber(record.ohlc.close)}</span>
          <span class="meta-num ${dir}">${formatSigned(record.change)} (${formatPct(record.changePct)})</span>
          ${(record.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      ${cover}
    </article>`;
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
      <div><span>开</span><b>${formatNumber(record.ohlc.open)}</b></div>
      <div><span>高</span><b>${formatNumber(record.ohlc.high)}</b></div>
      <div><span>低</span><b>${formatNumber(record.ohlc.low)}</b></div>
      <div><span>收</span><b>${formatNumber(record.ohlc.close)}</b></div>
      <div><span>日变化</span><b class="${dir}">${formatSigned(record.change)} <small>${formatPct(record.changePct)}</small></b></div>
      <div><span>累计</span><b class="${cumDir}">${formatSigned(record.cumChange)} <small>${formatPct(record.cumPct)}</small></b></div>
    </div>`;
}
