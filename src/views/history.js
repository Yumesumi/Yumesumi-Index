/* 历史：K 线、区间统计与行情表 */

import { renderKLine } from '../lib/chart.js';
import { refreshEnhancements } from '../lib/ambience.js';
import {
  directionClass, formatNumber, formatPct, formatSigned,
} from '../lib/data.js';
import { RANGES, filterByRange, rangeEmptyHint } from '../lib/selectors.js';
import { emptyState } from '../components/ui.js';
import { icon } from '../components/icons.js';

const PAGE_SIZE = 120;

function stat({ label, value, sub = '', tone = '' }) {
  return `
    <div class="range-stat">
      <span>${label}</span>
      <b class="${tone}">${value}</b>
      ${sub ? `<small>${sub}</small>` : ''}
    </div>`;
}

export function renderHistory(host, state) {
  const data = filterByRange(state.metrics, state.range);
  const rows = [...data].reverse();
  if (!state.historyLimit) state.historyLimit = PAGE_SIZE;
  const visibleRows = rows.slice(0, state.historyLimit);
  const rangeLabel = RANGES.find((r) => r.key === state.range)?.label ?? '全部';
  const highs = data.map((m) => m.ohlc.high);
  const lows = data.map((m) => m.ohlc.low);
  const maxHigh = highs.length ? Math.max(...highs) : null;
  const minLow = lows.length ? Math.min(...lows) : null;
  const last = data[data.length - 1] ?? null;

  host.innerHTML = `
    <section class="view-head reveal">
      <p class="eyebrow">HISTORY · 行情</p>
      <div class="view-head-row">
        <h2>历史走势。</h2>
        <p class="lede">K 线与行情表来自同一份记录。范围只筛选真实存在的记录，不会为空白日期补齐行情。</p>
      </div>
    </section>

    <section class="panel panel-data glass reveal">
      <div class="panel-head">
        <div>
          <p class="eyebrow">PRICE HISTORY</p>
          <h3>历史 K 线</h3>
          <p class="panel-sub">${data.length} 条记录 · ${rangeLabel}</p>
        </div>
        <div class="chart-controls">
          <div class="segmented" role="group" aria-label="时间范围">
            ${RANGES.map((r) => `<button type="button" class="seg-btn ${state.range === r.key ? 'is-active' : ''}" data-action="range" data-range="${r.key}">${r.label}</button>`).join('')}
          </div>
          <button type="button" class="btn btn-sm ${state.showMA ? 'is-on' : ''}" data-action="toggle-ma" aria-pressed="${state.showMA}">MA7</button>
          <button type="button" class="btn btn-sm" data-action="export-csv">${icon('download', 14)}<span>CSV</span></button>
        </div>
      </div>

      <div class="range-stats">
        ${stat({ label: '区间最高', value: maxHigh == null ? '—' : formatNumber(maxHigh) })}
        ${stat({ label: '区间最低', value: minLow == null ? '—' : formatNumber(minLow) })}
        ${stat({ label: '最新收盘', value: last ? formatNumber(last.ohlc.close) : '—', tone: last ? directionClass(last.change) : '', sub: last ? formatPct(last.changePct) : '' })}
        ${stat({ label: '区间记录', value: String(data.length), sub: rangeLabel })}
      </div>

      <div class="chart-mount" id="history-chart"></div>
      <div class="chart-legend">
        <span><i class="legend-swatch up"></i>上涨 · 空心</span>
        <span><i class="legend-swatch down"></i>下跌 · 实心</span>
        <span><i class="legend-swatch base"></i>基准</span>
        <span><i class="legend-swatch ma"></i>MA7</span>
      </div>
      <p class="chart-note">${icon('info', 13)} 纵轴跟随当前范围，基准在区间外时以边缘提示标出；数据量大时可以横向拖动查看更早的记录。</p>
    </section>

    <section class="panel glass-soft reveal">
      <div class="panel-head">
        <div>
          <p class="eyebrow">QUOTES</p>
          <h3>行情表</h3>
          <p class="panel-sub">按时间倒序 · 缺失日期不会补成 K 线</p>
        </div>
        <span class="count-pill">${data.length} 条</span>
      </div>
      ${visibleRows.length ? `
        <div class="table-wrap table-wrap--history">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">日期</th><th scope="col">开盘</th><th scope="col">最高</th>
                <th scope="col">最低</th><th scope="col">收盘</th><th scope="col">日变化</th>
                <th scope="col">涨跌幅</th><th scope="col" class="col-title">标题</th>
              </tr>
            </thead>
            <tbody>
              ${visibleRows.map((m) => `
                <tr class="${m.pending ? 'is-draft' : ''}">
                  <td class="num"><button type="button" class="link-btn" data-action="view" data-date="${m.date}">${m.date}</button></td>
                  <td class="num">${formatNumber(m.ohlc.open)}</td>
                  <td class="num">${formatNumber(m.ohlc.high)}</td>
                  <td class="num">${formatNumber(m.ohlc.low)}</td>
                  <td class="num strong">${formatNumber(m.ohlc.close)}</td>
                  <td class="num ${directionClass(m.change)}">${formatSigned(m.change)}</td>
                  <td class="num ${directionClass(m.change)}">${formatPct(m.changePct)}</td>
                  <td class="col-title">${m.title}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="load-more-wrap">
          ${visibleRows.length < rows.length
            ? `<button type="button" class="btn load-more" data-action="load-more-history">加载更多 <span>还有 ${rows.length - visibleRows.length} 条</span></button>`
            : `<p class="table-end">已显示全部 ${rows.length} 条记录</p>`}
        </div>` : emptyState({
          eyebrow: 'EMPTY RANGE',
          title: '该时间范围内没有记录',
          text: rangeEmptyHint(state.metrics) || '还没有正式记录。',
        })}
    </section>`;

  const chartHost = document.getElementById('history-chart');
  if (chartHost) {
    renderKLine(chartHost, data, {
      baseValue: state.meta.base_value,
      showMA: state.showMA,
      emptyText: rangeEmptyHint(state.metrics) || '还没有正式记录，图表不会凭空生成数据。',
      animate: true,
    });
  }

  const loadWrap = host.querySelector('[data-action="load-more-history"]');
  if (loadWrap) {
    loadWrap.addEventListener('click', () => {
      state.historyLimit += PAGE_SIZE;
      renderHistory(host, state);
      refreshEnhancements(host);
    });
  }
}
