/* 盘面控制：时间窗口按钮与 MA 开关 */

import { RANGES, formatWindowLabel, rangeLabel } from '../lib/selectors.js';

export function rangeButtons(state) {
  const custom = state.range === 'custom'
    ? '<span class="seg-btn is-active" aria-current="true">自定义</span>'
    : '';
  return `
    <div class="segmented segmented--ranges" role="group" aria-label="时间窗口">
      ${RANGES.map((r) => `<button type="button" class="seg-btn ${state.range === r.key ? 'is-active' : ''}" data-action="range" data-range="${r.key}">${r.label}</button>`).join('')}
      ${custom}
    </div>`;
}

export function maButton(state) {
  return `<button type="button" class="btn btn-sm ${state.showMA ? 'is-on' : ''}" data-action="toggle-ma" aria-pressed="${state.showMA}">MA7</button>`;
}

export function rangeSummary(state, window, records = []) {
  const label = rangeLabel(state.range);
  const first = records[0]?.date;
  const last = records[records.length - 1]?.date;
  const dates = first && last ? `${first} — ${last}` : formatWindowLabel(window);
  return `${records.length} 条记录 · ${label}${dates ? ` · ${dates}` : ''}`;
}
