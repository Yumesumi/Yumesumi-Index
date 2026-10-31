/* 概览：当前点位、核心指标、K 线与最近记录 */

import { renderKLine } from '../lib/chart.js';
import {
  directionClass, escapeHtml, formatDateLong, formatNumber, formatPct, formatSigned,
} from '../lib/data.js';
import {
  FREQUENCY_LABEL, latestEntries, rangeEmptyHint, recordsInWindow, resolveWindow,
} from '../lib/selectors.js';
import { entryCard } from '../components/entry-card.js';
import { emptyState } from '../components/ui.js';
import { maButton, rangeButtons, rangeSummary } from '../components/chart-controls.js';
import { icon } from '../components/icons.js';

function statCard({ label, value, sub, tone = '', index = 0 }) {
  return `
    <article class="stat glass-soft reveal" style="--i:${index}">
      <p class="stat-label">${label}</p>
      <div class="stat-value ${tone}">${value}</div>
      <p class="stat-sub">${sub}</p>
    </article>`;
}

export function renderOverview(host, state, handlers = {}) {
  const s = state.summary;
  const meta = state.meta;
  const dir = directionClass(s.lastChange);
  const cumDir = directionClass(s.cumChange);
  const window = resolveWindow(state.metrics, state.range, state.window);
  const visible = recordsInWindow(state.metrics, window);
  const recent = latestEntries(state.metrics, 4);
  const freq = FREQUENCY_LABEL[meta.frequency] ?? meta.frequency;
  const metaParts = [
    meta.base_date ? `基准日 ${meta.base_date}` : '',
    `基准 ${formatNumber(meta.base_value, 0)}`,
    freq,
  ].filter(Boolean);

  const hero = s.empty ? `
    <article class="hero-panel glass reveal" data-tilt>
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-top">
        <p class="hero-label">YSI 当前点位</p>
        <p class="hero-symbol">梦澄指数 · YUMESUMI INDEX</p>
      </div>
      <div class="hero-value is-empty">—</div>
      <div class="hero-change flat">还没有正式记录</div>
      <div class="hero-foot">${metaParts.map((part) => `<span>${part}</span>`).join('')}</div>
    </article>` : `
    <article class="hero-panel glass reveal" data-tilt>
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-top">
        <p class="hero-label">YSI 当前点位 <span class="live-pill"><i></i>最新</span></p>
        <p class="hero-symbol">梦澄指数 · YUMESUMI INDEX</p>
      </div>
      <div class="hero-value ${dir}">${formatNumber(s.lastClose)}</div>
      <div class="hero-change ${dir}">
        <span class="hero-delta">${formatSigned(s.lastChange)}</span>
        <span class="hero-pct">${formatPct(s.lastChangePct)}</span>
        <em>较上一条记录</em>
      </div>
      <div class="hero-foot">
        <span>截至 ${formatDateLong(s.lastDate)}</span>
        ${metaParts.map((part) => `<span>${part}</span>`).join('')}
      </div>
    </article>`;

  const stats = s.empty ? [
    statCard({ label: '相对基准', value: '—', sub: '等待第一条记录', index: 0 }),
    statCard({ label: '已记录', value: '0', sub: '尚未开始', index: 1 }),
    statCard({ label: '数据频率', value: freq, sub: meta.base_date ? `基准日 ${meta.base_date}` : '手动记录', index: 2 }),
    statCard({ label: '最近心境', value: '—', sub: '还没有内容', index: 3 }),
  ] : [
    statCard({
      label: `相对基准 ${formatNumber(meta.base_value, 0)}`,
      value: formatSigned(s.cumChange),
      sub: Number.isFinite(s.cumPct) ? formatPct(s.cumPct) : '基准为 0，不计算累计百分比',
      tone: cumDir,
      index: 0,
    }),
    statCard({
      label: '已记录',
      value: String(s.count),
      sub: `首条 ${state.metrics[0].date}`,
      index: 1,
    }),
    statCard({
      label: '数据频率',
      value: freq,
      sub: meta.base_date ? `基准日 ${meta.base_date}` : '手动记录',
      index: 2,
    }),
    statCard({
      label: '最近心境',
      value: s.lastMood ? `<span class="stat-mood">${escapeHtml(s.lastMood)}</span>` : '—',
      sub: escapeHtml(s.lastTitle || '—'),
      index: 3,
    }),
  ];

  host.innerHTML = `
    <section class="view-head reveal">
      <p class="eyebrow">YSI · 一个人的时间序列</p>
      <div class="view-head-row">
        <h2>用指数，记录时间。</h2>
        <p class="lede">每一条记录是一根 K 线：开盘是那期开始的状态，最高是当期最好的时刻，最低是最难熬的时候，收盘是落笔时的自己。</p>
      </div>
    </section>

    <section class="hero-grid">
      ${hero}
      <div class="stat-grid">${stats.join('')}</div>
    </section>

    <section class="panel panel-data glass reveal">
      <div class="panel-head">
        <div>
          <p class="eyebrow">MARKET CHART</p>
          <h3>盘面 K 线</h3>
          <p class="panel-sub">${state.metrics.length ? rangeSummary(state, window, visible) : '暂无数据'}</p>
        </div>
        <div class="chart-controls">
          ${rangeButtons(state)}
          ${maButton(state)}
        </div>
      </div>
      <div class="chart-mount" id="overview-chart"></div>
      <div class="chart-legend">
        <span><i class="legend-swatch up"></i>上涨 · 空心</span>
        <span><i class="legend-swatch down"></i>下跌 · 实心</span>
        <span><i class="legend-swatch base"></i>基准 ${formatNumber(meta.base_value, 0)}</span>
        <span><i class="legend-swatch ma"></i>MA7</span>
      </div>
      <p class="chart-note">${icon('info', 13)} 时间轴按真实记录日期排布；滚轮或双指缩放，拖拽平移。纵轴跟随可视窗口，基准在区间外时以边缘提示标出。</p>
    </section>

    <section class="overview-grid">
      <div class="panel glass-soft reveal">
        <div class="panel-head">
          <div>
            <p class="eyebrow">LATEST ENTRIES</p>
            <h3>最近记录</h3>
          </div>
          <a class="text-btn" href="#/journal">查看全部 ${icon('arrowRight', 13)}</a>
        </div>
        ${recent.length
          ? `<div class="entry-list entry-list--compact">${recent.map((m, i) => entryCard(m, i)).join('')}</div>`
          : emptyState({
            eyebrow: 'START HERE',
            title: '还没有任何记录',
            text: '梦澄指数从第一条日记开始。没有记录的时候，这里不会虚构任何点位。',
            action: '<button type="button" class="btn btn-primary" data-action="new">写下第一条记录</button>',
          })}
      </div>

      <aside class="side-stack">
        <section class="panel glass-soft reveal concept">
          <p class="eyebrow">PHILOSOPHY</p>
          <h3>记录本身，就是行情。</h3>
          <p>这里借用了金融终端的视觉语言，但没有交易、没有资产、没有市场。点位只代表记录本身，不能换算成任何东西。</p>
          <dl class="kv">
            <div><dt>基准</dt><dd>${formatNumber(meta.base_value, 0)}</dd></div>
            <div><dt>频率</dt><dd>${freq}</dd></div>
            <div><dt>数据</dt><dd>手动记录 / 公开 JSON</dd></div>
          </dl>
        </section>
        <section class="panel glass-soft reveal publish">
          <p class="eyebrow">PUBLISH</p>
          <h3>写日记 ≠ 发日记</h3>
          <p>网页里的「保存记录」只写入浏览器暂存区，不会改动仓库。真正发布走 journal 脚本或导出 JSON。</p>
          <code class="code-line">node tools/journal.mjs commit</code>
          <a class="text-btn" href="#/methodology">查看发布流程 ${icon('arrowRight', 13)}</a>
        </section>
      </aside>
    </section>`;

  const chartHost = document.getElementById('overview-chart');
  if (chartHost) {
    renderKLine(chartHost, state.metrics, {
      baseValue: meta.base_value,
      showMA: state.showMA,
      window,
      animate: state.range !== 'custom',
      emptyText: rangeEmptyHint(state.metrics, window) || '还没有正式记录，图表不会凭空生成数据。',
      onWindowCommit: handlers.onWindowCommit,
    });
  }
}
