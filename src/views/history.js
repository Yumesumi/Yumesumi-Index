/* 历史：K 线、区间统计与行情表 */

import { renderKLine } from '../lib/chart.js';
import {
  directionClass, escapeHtml, formatNumber, formatPct, formatSigned,
} from '../lib/data.js';
import {
  rangeEmptyHint, rangeLabel, recordsInWindow, resolveWindow,
} from '../lib/selectors.js';
import { emptyState } from '../components/ui.js';
import {
  maButton, rangeButtons, rangeSummary, syncRangeButtons,
} from '../components/chart-controls.js';
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

function statsHtml(data, closeLabel = '最新收盘') {
  const highs = data.map((m) => m.ohlc.high);
  const lows = data.map((m) => m.ohlc.low);
  const maxHigh = highs.length ? Math.max(...highs) : null;
  const minLow = lows.length ? Math.min(...lows) : null;
  const last = data[data.length - 1] ?? null;
  return [
    stat({ label: '区间最高', value: maxHigh == null ? '—' : formatNumber(maxHigh) }),
    stat({ label: '区间最低', value: minLow == null ? '—' : formatNumber(minLow) }),
    stat({
      label: closeLabel,
      value: last ? formatNumber(last.ohlc.close) : '—',
      tone: last ? directionClass(last.change) : '',
      sub: last ? formatPct(last.changePct) : '',
    }),
    stat({ label: '区间记录', value: String(data.length) }),
  ].join('');
}

function quotesHtml(data, state, window) {
  const rows = [...data].reverse();
  const visibleRows = rows.slice(0, state.historyLimit);
  if (!visibleRows.length) {
    return emptyState({
      eyebrow: 'EMPTY RANGE',
      title: '该时间范围内没有记录',
      text: rangeEmptyHint(state.metrics, window) || '还没有正式记录。',
    });
  }
  return `
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
              <td class="col-title">${escapeHtml(m.title)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="load-more-wrap">
      ${visibleRows.length < rows.length
        ? `<button type="button" class="btn load-more" data-action="load-more-history">加载更多 <span>还有 ${rows.length - visibleRows.length} 条</span></button>`
        : `<p class="table-end">已显示全部 ${rows.length} 条记录</p>`}
    </div>`;
}

export function renderHistory(host, state, handlers = {}) {
  const window = resolveWindow(state.metrics, state.range, state.window);
  const data = recordsInWindow(state.metrics, window);
  if (!state.historyLimit) state.historyLimit = PAGE_SIZE;

  host.innerHTML = `
    <section class="view-head reveal">
      <p class="eyebrow">HISTORY · 行情</p>
      <div class="view-head-row">
        <h2>历史走势。</h2>
        <p class="lede">K 线与行情表来自同一份记录。时间窗口按真实填写日期计算，不会为空白日期补齐行情。</p>
      </div>
    </section>

    <section class="panel panel-data glass reveal">
      <div class="panel-head">
        <div>
          <p class="eyebrow">PRICE HISTORY</p>
          <h3>历史 K 线</h3>
          <p class="panel-sub" id="history-range-summary">${rangeSummary(state, window, data)}</p>
        </div>
        <div class="chart-controls">
          ${rangeButtons(state)}
          ${maButton(state)}
          <button type="button" class="btn btn-sm" data-action="export-csv">${icon('download', 14)}<span>CSV</span></button>
        </div>
      </div>

      <div class="range-stats" id="history-range-stats">${statsHtml(data, state.range === 'custom' ? '窗口末收盘' : '最新收盘')}</div>

      <div class="chart-mount" id="history-chart"></div>
      <div class="chart-legend">
        <span><i class="legend-swatch up"></i>上涨 · 空心</span>
        <span><i class="legend-swatch down"></i>下跌 · 实心</span>
        <span><i class="legend-swatch base"></i>基准</span>
        <span><i class="legend-swatch ma"></i>MA7</span>
      </div>
      <p class="chart-note">${icon('info', 13)} 时间轴按真实记录日期排布；滚轮或双指缩放，拖拽平移。纵轴跟随可视窗口，基准在区间外时以边缘提示标出。</p>
    </section>

    <section class="panel glass-soft reveal">
      <div class="panel-head">
        <div>
          <p class="eyebrow">QUOTES</p>
          <h3>行情表</h3>
          <p class="panel-sub">按时间倒序 · 缺失日期不会补成 K 线</p>
        </div>
        <span class="count-pill" id="history-count">${data.length} 条</span>
      </div>
      <div id="history-quotes">${quotesHtml(data, state, window)}</div>
    </section>`;

  const summaryEl = host.querySelector('#history-range-summary');
  const statsEl = host.querySelector('#history-range-stats');
  const countEl = host.querySelector('#history-count');
  const quotesEl = host.querySelector('#history-quotes');

  const paintWindow = (nextWindow) => {
    const nextData = recordsInWindow(state.metrics, nextWindow);
    const closeLabel = state.range === 'custom' ? '窗口末收盘' : '最新收盘';
    if (summaryEl) summaryEl.textContent = rangeSummary(state, nextWindow, nextData);
    if (statsEl) statsEl.innerHTML = statsHtml(nextData, closeLabel);
    if (countEl) countEl.textContent = `${nextData.length} 条`;
    if (quotesEl) quotesEl.innerHTML = quotesHtml(nextData, state, nextWindow);
  };

  const onWindowCommit = (nextWindow) => {
    handlers.commitWindow?.(nextWindow);
    state.historyLimit = PAGE_SIZE;
    syncRangeButtons(host, state);
    paintWindow(nextWindow);
  };

  const chartHost = document.getElementById('history-chart');
  if (chartHost) {
    renderKLine(chartHost, state.metrics, {
      baseValue: state.meta.base_value,
      showMA: state.showMA,
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
      const maButton = event.target.closest('[data-action="toggle-ma"]');
      if (maButton) {
        state.showMA = !state.showMA;
        maButton.classList.toggle('is-on', state.showMA);
        maButton.setAttribute('aria-pressed', String(state.showMA));
        chartHost._chartState?.setShowMA(state.showMA);
      }
    });
  }

  // 行情表内部重绘时保留这个监听器，加载更多不再触发整页渲染
  quotesEl.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action="load-more-history"]')) return;
    state.historyLimit += PAGE_SIZE;
    paintWindow(resolveWindow(state.metrics, state.range, state.window));
  });
}
