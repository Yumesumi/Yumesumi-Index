/* 盘面控制：时间窗口按钮与 MA 开关 */

import { RANGES, formatWindowLabel, rangeLabel } from '../lib/selectors.js';

const MA_PERIODS = [7, 25, 99];

export function rangeButtons(state) {
  const custom = state.range === 'custom'
    ? '<span class="seg-btn is-active" data-custom="true" aria-current="true">自定义</span>'
    : '';
  return `
    <div class="segmented segmented--ranges" role="group" aria-label="时间窗口">
      ${RANGES.map((r) => `<button type="button" class="seg-btn ${state.range === r.key ? 'is-active' : ''}" ${state.range === r.key ? 'aria-current="true"' : ''} data-action="range" data-range="${r.key}">${r.label}</button>`).join('')}
      ${custom}
    </div>`;
}

/** 局部同步窗口按钮，避免缩放后重建整页 */
export function syncRangeButtons(root, state) {
  const segmented = root.querySelector('.segmented--ranges');
  if (!segmented) return;
  for (const button of segmented.querySelectorAll('[data-action="range"]')) {
    const active = button.dataset.range === state.range;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
  let custom = segmented.querySelector('[data-custom="true"]');
  if (state.range === 'custom') {
    if (!custom) {
      custom = document.createElement('span');
      custom.className = 'seg-btn is-active';
      custom.dataset.custom = 'true';
      custom.setAttribute('aria-current', 'true');
      custom.textContent = '自定义';
      segmented.append(custom);
    }
  } else if (custom) {
    custom.remove();
  }
}

export function maButtons(state) {
  return `
    <div class="ma-group" role="group" aria-label="移动平均线">
      ${MA_PERIODS.map((period) => `<button type="button" class="btn btn-sm ma-btn ${state.maVisible?.[period] ? 'is-on' : ''}" data-action="toggle-ma" data-period="${period}" aria-pressed="${Boolean(state.maVisible?.[period])}">MA${period}</button>`).join('')}
    </div>`;
}

export function syncMAButtons(root, state) {
  for (const button of root.querySelectorAll('[data-action="toggle-ma"][data-period]')) {
    const period = Number(button.dataset.period);
    const active = Boolean(state.maVisible?.[period]);
    button.classList.toggle('is-on', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

export function rangeSummary(state, window, records = []) {
  const label = rangeLabel(state.range);
  const first = records[0]?.date;
  const last = records[records.length - 1]?.date;
  const dates = first && last ? `${first} — ${last}` : formatWindowLabel(window);
  return `${records.length} 条记录 · ${label}${dates ? ` · ${dates}` : ''}`;
}
