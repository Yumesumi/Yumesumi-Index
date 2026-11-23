/* 概览：当前指数 + K 线 + 页面底部的详细历史 */

import { renderKLine } from '../lib/chart.js';
import {
  directionClass, escapeHtml, formatDateLong, formatNumber, formatPct, formatSigned,
} from '../lib/data.js';
import {
  FREQUENCY_LABEL, rangeEmptyHint, recordsInWindow, resolveWindow,
} from '../lib/selectors.js';
import {
  maButtons, rangeButtons, rangeSummary, syncMAButtons, syncRangeButtons,
} from '../components/chart-controls.js';
import { emptyState } from '../components/ui.js';
import { icon } from '../components/icons.js';

const PAGE_SIZE = 120;

function quoteTableHtml(data, state, window) {
  const rows = [...data].reverse();
  const visibleRows = rows.slice(0, state.historyLimit);
  if (!visibleRows.length) {
    return emptyState({
      eyebrow: 'EMPTY RANGE',
      title: '该时间窗口内没有记录',
      text: rangeEmptyHint(state.metrics, window) || '还没有正式记录。',
    });
  }
  return `
    <div class="table-wrap table-wrap--history">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">日期</th><th scope="col">开盘</th><th scope="col">收盘</th>
            <th scope="col">日变化</th><th scope="col">涨跌幅</th><th scope="col" class="col-title">标题</th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows.map((m) => `
            <tr class="${m.pending ? 'is-draft' : ''}">
              <td class="num"><button type="button" class="link-btn" data-action="view" data-date="${m.date}">${m.date}</button></td>
              <td class="num">${formatNumber(m.ohlc.open)}</td>
              <td class="num strong">${formatNumber(m.ohlc.close)}</td>
              <td class="num ${directionClass(m.change)}">${formatSigned(m.change)}</td>
              <td class="num ${directionClass(m.change)}">${formatPct(m.changePct)}</td>
              <td class="col-title">${escapeHtml(m.title)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="load-more-wrap">
      ${visibleRows.length < rows.length
        ? `<button type="button" class="btn load-more" data-action="load-more-table">加载更多 <span>还有 ${rows.length - visibleRows.length} 条</span></button>`
        : `<p class="table-end">已显示全部 ${rows.length} 条记录</p>`}
    </div>`;
}

export function renderOverview(host, state, handlers = {}) {
  const meta = state.meta;
  const summary = state.summary;
  const window = resolveWindow(state.metrics, state.range, state.window);
  const data = recordsInWindow(state.metrics, window);
  const dir = directionClass(summary?.lastChange);
  const cumDir = directionClass(summary?.cumChange);
  const freq = FREQUENCY_LABEL[meta.frequency] ?? meta.frequency;
  const latestMeta = summary?.lastDate
    ? `截至 ${formatDateLong(summary.lastDate)} · ${summary.count} 条 · ${freq}`
    : '还没有正式记录';

  host.innerHTML = `
    <section class="view-head reveal overview-head">
      <p class="eyebrow">OVERVIEW · 当前指数</p>
      <p class="lede">每一条记录是一根 K 线。向下滚动，查看与盘面同步的完整历史。</p>
    </section>

    <section class="panel panel-data glass reveal market-panel">
      <div class="market-head">
        <div class="market-summary">
          <p class="market-label">YSI 当前点位 <span class="live-pill"><i></i>最新</span></p>
          <div class="market-value ${summary?.empty ? 'is-empty' : ''}">${summary?.empty ? '—' : formatNumber(summary.lastClose)}</div>
          <div class="market-change ${dir}">
            ${summary?.empty
              ? '<span>还没有正式记录</span>'
              : `<span class="hero-delta">${formatSigned(summary.lastChange)}</span>
                 <span class="hero-pct">${formatPct(summary.lastChangePct)}</span>
                 <em>较上一条</em>`}
          </div>
          <p class="market-meta">${latestMeta}${summary?.empty ? '' : ` · 相对基准 ${formatSigned(summary.cumChange)}`}</p>
        </div>
        <div class="chart-controls">
          ${rangeButtons(state)}
          ${maButtons(state)}
        </div>
      </div>

      <p class="panel-sub" id="overview-range-summary">${rangeSummary(state, window, data)}</p>
      <div class="chart-mount" id="overview-chart"></div>
      <div class="chart-legend">
        <span><i class="legend-swatch up"></i>上涨 · 空心</span>
        <span><i class="legend-swatch down"></i>下跌 · 实心</span>
        <span><i class="legend-swatch base"></i>基准 ${formatNumber(meta.base_value, 0)}</span>
        <span><i class="legend-swatch ma ma-7"></i>MA7</span>
        <span><i class="legend-swatch ma ma-25"></i>MA25</span>
        <span><i class="legend-swatch ma ma-99"></i>MA99</span>
      </div>
      <p class="chart-note">${icon('info', 13)} 时间轴按真实记录日期排布；滚轮或双指缩放，拖拽平移。纵轴跟随可视窗口，基准在区间外时以边缘提示标出。</p>
    </section>

    <section class="panel glass-soft reveal detailed-history" id="detailed-history">
      <div class="panel-head">
        <div>
          <p class="eyebrow">HISTORY</p>
          <h3>详细历史</h3>
          <p class="panel-sub">与上方 K 线窗口同步 · 最近记录在前</p>
        </div>
        <span class="count-pill" id="overview-table-count">${data.length} 条</span>
      </div>
      <div id="overview-quotes">${quoteTableHtml(data, state, window)}</div>
    </section>`;

  const chartHost = document.getElementById('overview-chart');
  const summaryEl = host.querySelector('#overview-range-summary');
  const quotesEl = host.querySelector('#overview-quotes');
  const countEl = host.querySelector('#overview-table-count');

  const paintWindow = (nextWindow) => {
    const nextData = recordsInWindow(state.metrics, nextWindow);
    if (summaryEl) summaryEl.textContent = rangeSummary(state, nextWindow, nextData);
    if (countEl) countEl.textContent = `${nextData.length} 条`;
    if (quotesEl) quotesEl.innerHTML = quoteTableHtml(nextData, state, nextWindow);
  };

  if (chartHost) {
    const onWindowCommit = (nextWindow) => {
      handlers.commitWindow?.(nextWindow);
      state.historyLimit = PAGE_SIZE;
      syncRangeButtons(host, state);
      syncMAButtons(host, state);
      paintWindow(nextWindow);
    };

    renderKLine(chartHost, state.metrics, {
      baseValue: meta.base_value,
      maVisible: state.maVisible,
      window,
      animate: state.range !== 'custom',
      emptyText: rangeEmptyHint(state.metrics, window) || '还没有正式记录，图表不会凭空生成数据。',
      onWindowCommit,
    });

    const controls = host.querySelector('.chart-controls');
    controls?.addEventListener('click', (event) => {
      const rangeButton = event.target.closest('[data-action="range"]');
      if (rangeButton) {
        state.range = rangeButton.dataset.range;
        state.window = null;
        state.historyLimit = PAGE_SIZE;
        const nextWindow = resolveWindow(state.metrics, state.range, null);
        chartHost._chartState?.applyWindow(nextWindow);
        syncRangeButtons(host, state);
        paintWindow(nextWindow);
        return;
      }
      const maButton = event.target.closest('[data-action="toggle-ma"][data-period]');
      if (maButton) {
        const period = Number(maButton.dataset.period);
        state.maVisible[period] = !state.maVisible[period];
        syncMAButtons(host, state);
        chartHost._chartState?.setMAVisible(state.maVisible);
      }
    });
  }

  quotesEl?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action="load-more-table"]')) return;
    state.historyLimit += PAGE_SIZE;
    paintWindow(resolveWindow(state.metrics, state.range, state.window));
  });
}