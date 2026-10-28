/* =========================================================
   app.js — 界面渲染、路由、表单与导出

   重要区分：
     · 网页里的「保存记录」= 写入浏览器 localStorage 暂存区
     · Git commit / push      = 真正发布到仓库
   两者在界面上始终分开表述，网页不会声称已改动仓库。
   ========================================================= */

import {
  loadIndex, loadRecords, mergeRecords, pendingDates,
  computeMetrics, computeSummary, validateRecord, normalizeRecord,
  parseRecordsJSON, toCSV, toExportRecords,
  formatNumber, formatSigned, formatPct, directionClass,
  escapeHtml, summarize, isValidDateString, daysBetween,
} from './data.js';
import { renderKLine } from './chart.js';

const STORAGE_KEY = 'ysi.pending.v1';
/* 数据频率的显示文案 */
const FREQUENCY_LABEL = {
  daily: '日频',
  weekly: '周频',
  monthly: '月频',
};
/* 时间范围：数据跨度可能长达数年，除了近段也提供按年的档位 */
const RANGES = [
  { key: '90', label: '90 天' },
  { key: '365', label: '1 年' },
  { key: '1095', label: '3 年' },
  { key: 'all', label: '全部' },
];
const VIEWS = ['overview', 'journal', 'history', 'methodology'];

const state = {
  meta: null,
  published: [],
  pending: {},
  invalid: [],
  merged: [],
  metrics: [],
  summary: null,
  view: 'overview',
  range: 'all',
  query: '',
  sort: 'desc',
  showMA: true,
  loadError: null,
};

/* ---------------- 浏览器本地暂存 ---------------- */

function loadPending() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [date, item] of Object.entries(parsed)) {
      if (!item || typeof item !== 'object') continue;
      if (item.mode === 'delete') {
        out[date] = { mode: 'delete' };
      } else if (item.record) {
        out[date] = { mode: 'upsert', record: normalizeRecord(item.record) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function savePending() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pending));
    return true;
  } catch {
    toast('浏览器暂存失败：本地存储不可用或已满。', 'err');
    return false;
  }
}

/* ---------------- 工具 ---------------- */

function todayISO() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 取某日期之前最近一条有效记录的收盘价，作为默认开盘价 */
function previousClose(date) {
  const earlier = state.metrics.filter((m) => m.date < date);
  if (earlier.length) return earlier[earlier.length - 1].ohlc.close;
  return state.meta.base_value;
}

function toast(message, kind = '') {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = `toast ${kind}`;
  node.hidden = false;
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.hidden = true; }, 4600);
}

function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = root.querySelector('.modal-backdrop');
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', escClose);
  const focusTarget = root.querySelector('input:not([type=hidden]), textarea, select, button.btn-primary');
  if (focusTarget) focusTarget.focus();
  return root.querySelector('.modal');
}

function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  document.removeEventListener('keydown', escClose);
}

function escClose(e) {
  if (e.key === 'Escape') closeModal();
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- 数据流 ---------------- */

function recompute() {
  state.merged = mergeRecords(state.published, state.pending);
  state.metrics = computeMetrics(state.merged, state.meta.base_value);
  state.summary = computeSummary(state.metrics, state.meta.base_value);
}

/** 时间范围筛选：相对今天；范围内没有记录就如实显示空状态，不补造 K 线 */
function filteredMetrics() {
  if (state.range === 'all') return state.metrics;
  const days = Number(state.range);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const pad = (n) => String(n).padStart(2, '0');
  const cutoffStr = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
  return state.metrics.filter((m) => m.date >= cutoffStr);
}

function rangeEmptyHint() {
  const last = state.metrics[state.metrics.length - 1];
  if (!last) return '';
  const gap = daysBetween(last.date, todayISO());
  return `当前时间范围内没有记录。最近一条记录是 ${last.date}，距今 ${gap} 天。`;
}

/* ---------------- 视图 ---------------- */

function viewTitle() {
  return {
    overview: ['概览', '指数总览'],
    journal: ['日记', '每日记录'],
    history: ['历史', '历史走势'],
    methodology: ['说明', '指数说明与方法论'],
  }[state.view] ?? ['概览', '指数总览'];
}

function renderChrome() {
  const [title, sub] = viewTitle();
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = sub;

  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === state.view);
  });

  const dot = document.querySelector('#side-status .status-dot');
  const statusText = document.getElementById('side-status-text');
  if (state.loadError) {
    dot.className = 'status-dot err';
    statusText.textContent = '数据加载失败';
  } else {
    dot.className = 'status-dot ok';
    statusText.textContent = `${state.published.length} 条正式记录`;
  }

  const pending = pendingDates(state.pending);
  const bar = document.getElementById('pending-bar');
  if (pending.length) {
    bar.hidden = false;
    bar.innerHTML = `
      <span><strong>${pending.length}</strong> 条记录只保存在当前浏览器，尚未写入仓库。</span>
      <span>网页操作不会修改 GitHub，发布请走「导出 JSON → 写入 data/records.json → git commit &amp; push」。</span>
    `;
  } else {
    bar.hidden = true;
    bar.innerHTML = '';
  }
}

function renderView() {
  const host = document.getElementById('view');
  if (state.loadError) {
    host.innerHTML = `
      <div class="empty">
        <h3>无法读取数据文件</h3>
        <p>${escapeHtml(state.loadError)}</p>
        <p class="muted">提示：网页通过相对路径 <code>./data/records.json</code> 读取数据。若是直接双击打开本地文件，浏览器会因安全策略拦截读取，请改用本地静态服务器（例如 <code>npx serve .</code>）或访问 GitHub Pages 地址。</p>
      </div>`;
    return;
  }
  if (state.view === 'overview') renderOverview(host);
  else if (state.view === 'journal') renderJournal(host);
  else if (state.view === 'history') renderHistory(host);
  else renderMethodology(host);
}

/* ---------- 概览 ---------- */

function renderOverview(host) {
  const s = state.summary;
  const dir = directionClass(s.lastChange);
  const cumDir = directionClass(s.cumChange);

  const stats = s.empty ? `
    <div class="stat">
      <div class="stat-label">YSI 当前指数</div>
      <div class="stat-value lg">—</div>
      <div class="stat-sub">还没有正式记录</div>
    </div>
  ` : `
    <div class="stat">
      <div class="stat-label">YSI 当前指数</div>
      <div class="stat-value lg">${formatNumber(s.lastClose)}</div>
      <div class="stat-sub">截至 ${s.lastDate}</div>
    </div>
    <div class="stat">
      <div class="stat-label">最近日涨跌</div>
      <div class="stat-value ${dir}">${formatSigned(s.lastChange)}</div>
      <div class="stat-sub ${dir}">${formatPct(s.lastChangePct)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">相对基准 ${formatNumber(state.meta.base_value, 0)}</div>
      <div class="stat-value ${cumDir}">${formatSigned(s.cumChange)}</div>
      <div class="stat-sub ${cumDir}">${formatPct(s.cumPct)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">已记录日期</div>
      <div class="stat-value">${s.count}</div>
      <div class="stat-sub">${s.count ? `首条 ${state.metrics[0].date}` : '尚未开始'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">最近心境</div>
      <div class="stat-value" style="font-size:17px;line-height:1.5">${escapeHtml(s.lastMood || '—')}</div>
      <div class="stat-sub">${escapeHtml(s.lastTitle || '')}</div>
    </div>
  `;

  const recent = [...state.metrics].reverse().slice(0, 5);

  host.innerHTML = `
    <section class="section">
      <div class="grid">${stats}</div>
    </section>

    <section class="section">
      <div class="chart-panel">
        <div class="chart-toolbar">
          <div>
            <h2 style="margin:0;font-size:14px;font-weight:600">${FREQUENCY_LABEL[state.meta.frequency] ?? ''}K 线</h2>
            <span class="muted" style="font-size:12px">${state.metrics.length ? `共 ${state.metrics.length} 条真实记录` : '暂无数据'}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div class="range-group" role="group" aria-label="时间范围">
              ${RANGES.map((r) => `<button type="button" class="range-btn ${state.range === r.key ? 'active' : ''}" data-action="range" data-range="${r.key}">${r.label}</button>`).join('')}
            </div>
            <button type="button" class="btn btn-sm" data-action="toggle-ma" aria-pressed="${state.showMA}">MA7 ${state.showMA ? '开' : '关'}</button>
          </div>
        </div>
        <div class="chart-scroll"><div class="chart-host" id="overview-chart"></div></div>
        <div class="chart-legend">
          <span class="legend-item"><i class="legend-swatch up"></i>上涨（空心）</span>
          <span class="legend-item"><i class="legend-swatch down"></i>下跌（实心）</span>
          <span class="legend-item"><i class="legend-swatch base"></i>基准 ${formatNumber(state.meta.base_value)}</span>
          <span class="legend-item"><i class="legend-swatch ma"></i>MA7 移动平均</span>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>最近日记</h2>
        <a href="#/journal" class="hint">查看全部 →</a>
      </div>
      ${recent.length ? `<div class="entry-list">${recent.map(entryCard).join('')}</div>` : `
        <div class="empty">
          <h3>还没有任何记录</h3>
          <p>梦澄指数从第一条日记开始。没有记录的时候，这里不会虚构任何点位。</p>
          <button type="button" class="btn btn-primary" data-action="new">写下第一条记录</button>
        </div>`}
    </section>

    <section class="section">
      <div class="section-head"><h2>指数理念</h2></div>
      <div class="panel prose">
        <p><strong>A Journal, Expressed as an Index.</strong> 用指数表达日记，用记录留住时间。</p>
        <p>每条记录是一根 K 线：开盘是那期开始时的状态，最高是当期最好的时刻，最低是最难熬的时候，收盘是落笔时的自己。相邻两条记录可以相隔好几天——中间的日子没有记录，就没有 K 线，指数不会替你编造。</p>
        <p>基准点位为 <code>${formatNumber(state.meta.base_value)}</code>。涨跌颜色只是记账符号，不代表人生价值的高低。</p>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>发布流程</h2></div>
      <div class="notice">
        <strong>网页里的「保存记录」不等于 Git 提交。</strong>
        表单只会把记录写入当前浏览器的暂存区，刷新页面后仍在，但线上站点和 GitHub 仓库不会有任何变化。
        真正发布需要手动完成：
        <ol style="margin:8px 0 0;padding-left:20px">
          <li>在日记页填写并保存记录（仅写入浏览器暂存区）</li>
          <li>点「导出 JSON」，得到 <code>records.json</code></li>
          <li>用导出的文件替换仓库里的 <code>data/records.json</code></li>
          <li>检查 JSON 内容与日期无误后，执行 <code>git add</code> → <code>git commit</code> → <code>git push</code></li>
          <li>GitHub Pages 自动重新构建，站点更新</li>
        </ol>
        <p style="margin:8px 0 0">第一步和第四步是两件不同的事，站点界面会一直把它们区分开。</p>
      </div>
    </section>
  `;

  drawOverviewChart();
}

function entryCard(m) {
  return `
    <article class="entry">
      <div class="entry-head">
        <div style="min-width:0">
          <div class="entry-date">${m.date}${m.pending ? ' · 待发布' : ''}</div>
          <h3 class="entry-title">${escapeHtml(m.title)}</h3>
        </div>
        <div class="entry-actions">
          <button type="button" class="btn btn-sm" data-action="view" data-date="${m.date}">查看</button>
          <button type="button" class="btn btn-sm" data-action="edit" data-date="${m.date}">编辑</button>
        </div>
      </div>
      ${summarize(m.body) ? `<p class="entry-summary">${escapeHtml(summarize(m.body))}</p>` : ''}
      <div class="entry-meta">
        ${m.mood ? `<span class="mood">${escapeHtml(m.mood)}</span>` : ''}
        ${Number.isFinite(m.energy) ? `<span class="num">能量 ${m.energy}</span>` : ''}
        <span class="num">收盘 ${formatNumber(m.ohlc.close)}</span>
        <span class="num ${directionClass(m.change)}">${formatSigned(m.change)} (${formatPct(m.changePct)})</span>
        ${(m.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      </div>
    </article>
  `;
}

function drawOverviewChart() {
  const host = document.getElementById('overview-chart');
  if (!host) return;
  renderKLine(host, filteredMetrics(), {
    baseValue: state.meta.base_value,
    showMA: state.showMA,
    emptyText: rangeEmptyHint() || '还没有正式记录，图表不会凭空生成数据。',
  });
}

/* ---------- 日记 ---------- */

function journalMatches(record) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    record.title, record.body, record.mood, (record.tags || []).join(' '),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

function renderJournal(host) {
  // 工具栏与列表分离：搜索时只重绘列表，输入框不会失焦
  host.innerHTML = `
    <section class="section">
      <div class="journal-toolbar">
        <input class="field-input search-input" type="search" id="journal-search"
               placeholder="搜索标题、正文、标签、心境" value="${escapeHtml(state.query)}"
               aria-label="搜索日记">
        <select class="field-select" id="journal-sort" aria-label="排序方式" style="width:auto">
          <option value="desc" ${state.sort === 'desc' ? 'selected' : ''}>最新在前</option>
          <option value="asc" ${state.sort === 'asc' ? 'selected' : ''}>最早在前</option>
        </select>
        <span class="muted" id="journal-count" style="font-size:12.5px"></span>
        <button type="button" class="btn btn-primary" data-action="new">新建记录</button>
      </div>
      <div id="journal-list"></div>
    </section>
  `;

  const list = document.getElementById('journal-list');

  function paintList() {
    const matched = state.metrics.filter(journalMatches);
    const sorted = state.sort === 'desc' ? [...matched].reverse() : matched;
    document.getElementById('journal-count').textContent = `${matched.length} / ${state.metrics.length} 条`;
    list.innerHTML = sorted.length ? `<div class="entry-list">${sorted.map(entryCard).join('')}</div>` : `
      <div class="empty">
        <h3>${state.metrics.length ? '没有匹配的记录' : '还没有任何记录'}</h3>
        <p>${state.metrics.length ? '换个关键词试试，搜索会覆盖标题、正文、标签和心境。' : '所有正式记录都手动创建。最低记录单位是一天，允许补记过去的日子。'}</p>
        ${state.metrics.length ? '' : '<button type="button" class="btn btn-primary" data-action="new">写下第一条记录</button>'}
      </div>`;
  }
  paintList();

  document.getElementById('journal-search').addEventListener('input', (e) => {
    state.query = e.target.value;
    paintList();
  });

  document.getElementById('journal-sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    paintList();
  });
}

/* ---------- 历史 ---------- */

function renderHistory(host) {
  const data = filteredMetrics();
  const rows = [...data].reverse();

  host.innerHTML = `
    <section class="section">
      <div class="chart-panel">
        <div class="chart-toolbar">
          <div>
            <h2 style="margin:0;font-size:14px;font-weight:600">历史 K 线</h2>
            <span class="muted" style="font-size:12px">${data.length} 条记录</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div class="range-group" role="group" aria-label="时间范围">
              ${RANGES.map((r) => `<button type="button" class="range-btn ${state.range === r.key ? 'active' : ''}" data-action="range" data-range="${r.key}">${r.label}</button>`).join('')}
            </div>
            <button type="button" class="btn btn-sm" data-action="toggle-ma" aria-pressed="${state.showMA}">MA7 ${state.showMA ? '开' : '关'}</button>
            <button type="button" class="btn btn-sm" data-action="export-csv">导出 CSV</button>
          </div>
        </div>
        <div class="chart-scroll"><div class="chart-host" id="history-chart"></div></div>
        <div class="chart-legend">
          <span class="legend-item"><i class="legend-swatch up"></i>上涨（空心）</span>
          <span class="legend-item"><i class="legend-swatch down"></i>下跌（实心）</span>
          <span class="legend-item"><i class="legend-swatch base"></i>基准 ${formatNumber(state.meta.base_value)}</span>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>行情表</h2>
        <span class="hint">按时间倒序 · 缺失日期不会补成 K 线</span>
      </div>
      ${rows.length ? `
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th scope="col">日期</th><th scope="col">开盘</th><th scope="col">最高</th>
                <th scope="col">最低</th><th scope="col">收盘</th><th scope="col">日变化</th>
                <th scope="col">涨跌幅</th><th scope="col">标题</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((m) => `
                <tr class="${m.pending ? 'is-draft' : ''}">
                  <td class="num">${m.date}</td>
                  <td class="num">${formatNumber(m.ohlc.open)}</td>
                  <td class="num">${formatNumber(m.ohlc.high)}</td>
                  <td class="num">${formatNumber(m.ohlc.low)}</td>
                  <td class="num">${formatNumber(m.ohlc.close)}</td>
                  <td class="num ${directionClass(m.change)}">${formatSigned(m.change)}</td>
                  <td class="num ${directionClass(m.change)}">${formatPct(m.changePct)}</td>
                  <td style="text-align:left;white-space:normal;max-width:280px">${escapeHtml(m.title)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : `
        <div class="empty">
          <h3>该时间范围内没有记录</h3>
          <p>${escapeHtml(rangeEmptyHint() || '还没有正式记录。')}</p>
        </div>`}
    </section>
  `;

  const chart = document.getElementById('history-chart');
  if (chart) {
    renderKLine(chart, data, {
      baseValue: state.meta.base_value,
      showMA: state.showMA,
      emptyText: rangeEmptyHint() || '还没有正式记录，图表不会凭空生成数据。',
    });
  }
}

/* ---------- 说明 ---------- */

function renderMethodology(host) {
  host.innerHTML = `
    <div class="prose">
      <section>
        <h2>YSI 是什么</h2>
        <p><strong>梦澄指数 / Yumesumi Index（YSI）</strong> 是一个以记录为内核、以指数为外壳的个人档案站。每一条记录对应一根 K 线，记录当期的数字与文字。</p>
        <p>它借用了金融指数终端的视觉语言，但这里没有交易、没有资产、没有市场。点位只代表记录本身，不能换算成任何东西。</p>
        <dl class="kv">
          <dt>基准点位</dt><dd class="num">${formatNumber(state.meta.base_value)}</dd>
          <dt>基准日期</dt><dd class="num">${state.meta.base_date || '—'}</dd>
          <dt>频率</dt><dd>${FREQUENCY_LABEL[state.meta.frequency] ?? state.meta.frequency}</dd>
          <dt>数据模式</dt><dd>手动记录，不自动生成</dd>
          <dt>当前正式记录</dt><dd class="num">${state.published.length} 条</dd>
        </dl>
      </section>

      <section>
        <h2>OHLC 规则</h2>
        <p>每条记录保存四个数：</p>
        <ul>
          <li><strong>开盘价 open</strong>：默认取上一条有效记录的收盘价，可手动调整。</li>
          <li><strong>最高价 high</strong>：必须 <code>≥ open</code> 且 <code>≥ close</code>。</li>
          <li><strong>最低价 low</strong>：必须 <code>≤ open</code> 且 <code>≤ close</code>。</li>
          <li><strong>收盘价 close</strong>：当天落笔时的状态。</li>
        </ul>
        <p>不满足关系的输入会被表单当场拒绝，不会被静默接受或悄悄改写。</p>
      </section>

      <section>
        <h2>涨跌如何计算</h2>
        <ul>
          <li>日涨跌额 = 当日收盘价 − 上一条有效记录的收盘价</li>
          <li>日涨跌幅 = 日涨跌额 ÷ |上一条有效记录收盘价| × 100%</li>
          ${state.meta.base_value === 0
    ? '<li>累计变化 = 最新收盘价 − 0（基准为 0 时没有可比基数，不计算累计百分比）</li>'
    : `<li>累计变化 = (最新收盘价 − ${formatNumber(state.meta.base_value)}) ÷ ${formatNumber(state.meta.base_value)} × 100%</li>`}
        </ul>
        <p>第一条记录没有前一条收盘价，统一以基准点位 ${formatNumber(state.meta.base_value)} 作为比较对象。所有涨跌都由数据算出，页面任何地方都不单独硬编码这些数字。</p>
        <h3>点位可以是负数</h3>
        <p>点位不限定为正数。当期出现负数时，涨跌幅的分母取前收的<strong>绝对值</strong>，这样涨跌额的符号与涨跌幅始终一致——从 −200 涨到 −100 记作 +50%，而不是被除法翻转成负数。前收为 0 时没有可比基数，涨跌幅显示为「—」，涨跌额仍然准确。</p>
      </section>

      <section>
        <h2>缺失日期</h2>
        <p>相邻两条记录可以相隔好几天。<strong>没有记录的日期不会生成任何 K 线</strong>，日变化的比较对象是上一条真实记录，不代表中间每个自然日都有行情。也不会因为今天没写就自动补一条空记录。</p>
        <p>同一日期最多一条正式记录；重新保存同一天的内容是<b>更新</b>那条记录，而不是新增一条。</p>
      </section>

      <section>
        <h2>「网页保存」与「Git 提交」的区别</h2>
        <p>这是本站最容易混淆的一点，所以在界面上单独写明：</p>
        <table class="data" style="min-width:0;margin:12px 0">
          <thead><tr><th scope="col" style="text-align:left">行为</th><th scope="col" style="text-align:left">在哪儿发生</th><th scope="col" style="text-align:left">影响</th></tr></thead>
          <tbody>
            <tr>
              <td style="text-align:left"><b>保存记录</b>（网页按钮）</td>
              <td style="text-align:left">浏览器</td>
              <td style="text-align:left;white-space:normal">仅写入当前浏览器的 localStorage 暂存区。刷新后仍在，但仓库和线上站点毫无变化。</td>
            </tr>
            <tr>
              <td style="text-align:left"><b>git commit &amp; push</b>（命令行）</td>
              <td style="text-align:left">本地终端</td>
              <td style="text-align:left;white-space:normal">真正把 JSON 写进 GitHub 仓库，Pages 随后重新构建并发布新站点。</td>
            </tr>
          </tbody>
        </table>
        <p>换句话说：网页里的「提交记录」是<b>写日记</b>，Git commit 才是<b>发布日记</b>。本站不实现 GitHub API 写入、OAuth 或 Token，也不会谎称已经改动了仓库。</p>
      </section>

      <section>
        <h2>数据保存在哪里</h2>
        <ul>
          <li><strong>正式数据</strong>：仓库里的 <code>data/records.json</code>。这是网站唯一的数据来源。</li>
          <li><strong>指数元信息</strong>：<code>data/index.json</code>。</li>
          <li><strong>浏览器暂存</strong>：<code>localStorage</code> 键 <code>ysi.pending.v1</code>。只存在于这台设备这个浏览器，换设备就看不到。</li>
        </ul>
        <p>正式发布流程：在网页保存 → 导出 JSON → 用导出的 <code>records.json</code> 替换仓库文件 → 检查 → <code>git add</code> / <code>git commit</code> / <code>git push</code>。</p>
      </section>

      <section>
        <h2>导出与导入</h2>
        <ul>
          <li><strong>导出 JSON</strong>：导出当前展示的全部记录（含浏览器暂存内容），格式与 <code>data/records.json</code> 完全一致，导出前会先确认清单。</li>
          <li><strong>导出 CSV</strong>：导出行情表，正确处理逗号、引号、中文与换行，带 UTF-8 BOM 以便 Excel 直接打开。</li>
          <li><strong>导入 JSON</strong>：先校验结构、日期与 OHLC 关系，任何一处不合法就整体拒绝，绝不覆盖现有数据。导入的内容进入浏览器暂存区，仓库文件不会被自动改动。</li>
        </ul>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn" data-action="import-json">导入 JSON 文件</button>
          <button type="button" class="btn" data-action="export-json">导出 JSON</button>
          <button type="button" class="btn" data-action="export-csv">导出 CSV</button>
        </div>
      </section>

      <section>
        <h2>隐私提醒</h2>
        <div class="notice">
          GitHub Pages 上的站点是公开的，仓库里的 <code>data/records.json</code> 同样公开。正式发布前请确认日记内容适合公开阅读，<b>不要把密码、账号、密钥或任何不希望公开的细节提交进仓库</b>。导出 JSON 前也请自行检查一遍内容。
        </div>
      </section>

      <section>
        <h2>免责声明</h2>
        <p>YSI 不是金融资产，不构成任何投资建议。上涨与下跌的颜色只是记账符号，不表示人生价值的高低，也不用于比较任何真实市场的涨跌。</p>
      </section>
    </div>
  `;
}

/* ---------------- 表单 ---------------- */

function openEditor(date) {
  const existing = date ? state.merged.find((r) => r.date === date) : null;
  const rec = existing
    ? { ...existing }
    : {
        date: todayISO(),
        title: '', body: '', mood: '', energy: '', tags: [],
        ohlc: { open: previousClose(todayISO()), high: null, low: null, close: null },
      };

  const defOpen = existing ? rec.ohlc.open : previousClose(rec.date);
  const defHigh = Number.isFinite(rec.ohlc.high) ? rec.ohlc.high : defOpen;
  const defLow = Number.isFinite(rec.ohlc.low) ? rec.ohlc.low : defOpen;
  const defClose = Number.isFinite(rec.ohlc.close) ? rec.ohlc.close : defOpen;

  const modal = openModal(`
    <div class="modal-head">
      <h2>${existing ? `编辑 ${existing.date} 的记录` : '新建记录'}</h2>
      <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
    </div>
    <form id="record-form" novalidate>
      <div class="form-grid">
        <div class="form-row">
          <label for="f-date">日期 <span class="req">*</span></label>
          <input class="field-input" type="date" id="f-date" value="${rec.date}" required>
          <span class="field-hint" id="date-hint">${existing ? '保存将更新这一天的记录' : '可补记过去的日期'}</span>
        </div>
        <div class="form-row">
          <label for="f-mood">心境</label>
          <input class="field-input" type="text" id="f-mood" value="${escapeHtml(rec.mood || '')}" placeholder="例如：平静 · 认真">
        </div>
        <div class="form-row full">
          <label for="f-title">标题 <span class="req">*</span></label>
          <input class="field-input" type="text" id="f-title" value="${escapeHtml(rec.title || '')}" placeholder="今天想记住的一句话" required>
        </div>
        <div class="form-row full">
          <label for="f-body">正文 <span class="req">*</span></label>
          <textarea class="field-textarea" id="f-body" placeholder="在这里写入当天真实的日记。" required>${escapeHtml(rec.body || '')}</textarea>
        </div>
        <div class="form-row">
          <label for="f-energy">能量（0–10）</label>
          <input class="field-input" type="number" id="f-energy" min="0" max="10" step="1" value="${rec.energy ?? ''}">
        </div>
        <div class="form-row">
          <label for="f-tags">标签</label>
          <input class="field-input" type="text" id="f-tags" value="${escapeHtml((rec.tags || []).join('、'))}" placeholder="用、或逗号分隔">
        </div>
        <div class="form-row">
          <label for="f-open">开盘价 <span class="req">*</span></label>
          <input class="field-input num" type="number" id="f-open" step="0.01" value="${defOpen}" required>
          <span class="field-hint">默认上一条收盘价，可调整</span>
        </div>
        <div class="form-row">
          <label for="f-high">最高价 <span class="req">*</span></label>
          <input class="field-input num" type="number" id="f-high" step="0.01" value="${defHigh}" required>
          <span class="field-hint">自动跟随开盘/收盘，可手动改</span>
        </div>
        <div class="form-row">
          <label for="f-low">最低价 <span class="req">*</span></label>
          <input class="field-input num" type="number" id="f-low" step="0.01" value="${defLow}" required>
          <span class="field-hint">自动跟随开盘/收盘，可手动改</span>
        </div>
        <div class="form-row">
          <label for="f-close">收盘价 <span class="req">*</span></label>
          <input class="field-input num" type="number" id="f-close" step="0.01" value="${defClose}" required>
          <span class="field-hint">落笔时的状态</span>
        </div>
      </div>

      <div class="ohlc-preview" id="ohlc-preview"></div>

      <div class="form-error" id="form-error" hidden></div>

      <label class="check-row" style="margin-top:12px">
        <input type="checkbox" id="f-confirm">
        <span>我确认这条记录的内容和日期无误。保存后它只存在于当前浏览器，<b>不会</b>写入 GitHub 仓库。</span>
      </label>

      <div class="modal-foot">
        <button type="button" class="btn" data-action="close-modal">取消</button>
        <button type="submit" class="btn btn-primary">保存到浏览器暂存区</button>
      </div>
    </form>
  `);

  const form = modal.querySelector('#record-form');
  const f = {
    date: modal.querySelector('#f-date'),
    title: modal.querySelector('#f-title'),
    body: modal.querySelector('#f-body'),
    mood: modal.querySelector('#f-mood'),
    energy: modal.querySelector('#f-energy'),
    tags: modal.querySelector('#f-tags'),
    open: modal.querySelector('#f-open'),
    high: modal.querySelector('#f-high'),
    low: modal.querySelector('#f-low'),
    close: modal.querySelector('#f-close'),
  };
  const errorBox = modal.querySelector('#form-error');
  const preview = modal.querySelector('#ohlc-preview');
  const dateHint = modal.querySelector('#date-hint');
  // high / low 是否被用户手动改过：改过之后就不再自动跟随
  const touched = { high: Number.isFinite(rec.ohlc.high), low: Number.isFinite(rec.ohlc.low) };

  function num(input) {
    if (input.value.trim() === '') return null;
    const v = Number(input.value);
    return Number.isFinite(v) ? v : null;
  }

  function syncDefaults() {
    const o = num(f.open);
    const c = num(f.close);
    if (o === null || c === null) return;
    if (!touched.high) f.high.value = Math.max(o, c).toFixed(2);
    if (!touched.low) f.low.value = Math.min(o, c).toFixed(2);
  }

  function updatePreview() {
    const o = num(f.open); const h = num(f.high);
    const l = num(f.low); const c = num(f.close);
    if ([o, h, l, c].some((v) => v === null)) {
      preview.innerHTML = '<span>填写完整的四个数字后显示校验结果</span>';
      return;
    }
    const problems = [];
    if (h < o) problems.push('最高价需 ≥ 开盘价');
    if (h < c) problems.push('最高价需 ≥ 收盘价');
    if (l > o) problems.push('最低价需 ≤ 开盘价');
    if (l > c) problems.push('最低价需 ≤ 收盘价');
    const base = state.meta.base_value;
    const change = c - base;
    preview.innerHTML = `
      <span>开 <b>${formatNumber(o)}</b></span>
      <span>高 <b>${formatNumber(h)}</b></span>
      <span>低 <b>${formatNumber(l)}</b></span>
      <span>收 <b>${formatNumber(c)}</b></span>
      <span>对基准 ${formatNumber(base)} <b class="${directionClass(change)}">${formatSigned(change)}</b></span>
      ${problems.length ? `<span class="down">${problems.join('；')}</span>` : '<span class="up">OHLC 关系有效</span>'}
    `;
  }

  f.high.addEventListener('input', () => { touched.high = true; updatePreview(); });
  f.low.addEventListener('input', () => { touched.low = true; updatePreview(); });
  [f.open, f.close].forEach((input) => input.addEventListener('input', () => { syncDefaults(); updatePreview(); }));

  // 换日期时重算默认开盘价，并提示该日期是否已有记录
  f.date.addEventListener('change', () => {
    if (!isValidDateString(f.date.value)) return;
    touched.high = false;
    touched.low = false;
    f.open.value = previousClose(f.date.value).toFixed(2);
    syncDefaults();
    updatePreview();
    const dup = state.merged.find((r) => r.date === f.date.value);
    dateHint.textContent = dup
      ? `${f.date.value} 已有记录，保存将更新它`
      : '可补记过去的日期';
  });

  updatePreview();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = {
      date: f.date.value,
      title: f.title.value.trim(),
      body: f.body.value.trim(),
      mood: f.mood.value.trim(),
      energy: f.energy.value === '' ? null : Number(f.energy.value),
      tags: f.tags.value.split(/[、,，;；\s]+/).map((t) => t.trim()).filter(Boolean),
      ohlc: { open: num(f.open), high: num(f.high), low: num(f.low), close: num(f.close) },
    };
    const errors = validateRecord(raw);
    if (errors.length) {
      errorBox.hidden = false;
      errorBox.innerHTML = `<b>无法保存</b><ul>${errors.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
      return;
    }
    const record = normalizeRecord(raw);
    const sameDate = state.merged.find((r) => r.date === record.date);
    state.pending[record.date] = { mode: 'upsert', record };
    if (!savePending()) return;
    recompute();
    closeModal();
    renderChrome();
    renderView();
    toast(sameDate
      ? `已更新 ${record.date} 的记录到浏览器暂存区（未写入仓库）。`
      : `已保存 ${record.date} 的记录到浏览器暂存区（未写入仓库）。`);
  });
}

function openDetail(date) {
  const rec = state.merged.find((r) => r.date === date);
  if (!rec) return;
  openModal(`
    <div class="modal-head">
      <h2>${escapeHtml(rec.title)}</h2>
      <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
    </div>
    <div class="entry-meta" style="margin-top:0">
      <span class="num">${rec.date}</span>
      ${rec.mood ? `<span class="mood">${escapeHtml(rec.mood)}</span>` : ''}
      ${Number.isFinite(rec.energy) ? `<span class="num">能量 ${rec.energy}</span>` : ''}
      ${(rec.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      ${rec.pending ? '<span class="badge">待发布</span>' : ''}
    </div>
    <div class="ohlc-preview">
      <span>开 <b>${formatNumber(rec.ohlc.open)}</b></span>
      <span>高 <b>${formatNumber(rec.ohlc.high)}</b></span>
      <span>低 <b>${formatNumber(rec.ohlc.low)}</b></span>
      <span>收 <b>${formatNumber(rec.ohlc.close)}</b></span>
      <span>日变化 <b class="${directionClass(rec.change)}">${formatSigned(rec.change)} (${formatPct(rec.changePct)})</b></span>
      <span>累计 <b class="${directionClass(rec.cumChange)}">${formatSigned(rec.cumChange)} (${formatPct(rec.cumPct)})</b></span>
    </div>
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.75;margin-top:16px;color:#C9D2DB">${escapeHtml(rec.body)}</div>
    <div class="modal-foot">
      <button type="button" class="btn" data-action="close-modal">关闭</button>
      <button type="button" class="btn btn-primary" data-action="edit" data-date="${rec.date}">编辑</button>
    </div>
  `);
}

/* ---------------- 导出 / 导入 ---------------- */

function openExportDialog() {
  const records = state.merged;
  if (!records.length) {
    toast('还没有可导出的记录。', 'warn');
    return;
  }
  const rows = records.slice(-8).map((r) => `
    <tr>
      <td class="num">${r.date}</td>
      <td class="num">${formatNumber(r.ohlc.close)}</td>
      <td style="text-align:left;white-space:normal">${escapeHtml(r.title)}</td>
      <td>${r.pending ? '<span class="badge">待发布</span>' : '正式'}</td>
    </tr>`).join('');

  const modal = openModal(`
    <div class="modal-head">
      <h2>导出 JSON</h2>
      <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
    </div>
    <div class="notice" style="margin-bottom:12px">
      导出的是<b>当前展示的全部 ${records.length} 条记录</b>（含浏览器暂存区内容），格式与仓库中的 <code>data/records.json</code> 完全一致。
      导出后请手动替换仓库文件并自行执行 <code>git commit</code> 与 <code>git push</code>——网页不会替你提交。
    </div>
    <div class="table-wrap" style="max-height:260px;overflow-y:auto">
      <table class="data" style="min-width:0">
        <thead><tr><th scope="col">日期</th><th scope="col">收盘</th><th scope="col" style="text-align:left">标题</th><th scope="col" style="text-align:left">状态</th></tr></thead>
        <tbody>${rows}${records.length > 8 ? `<tr><td colspan="4" class="muted" style="text-align:center">… 以及更早的 ${records.length - 8} 条</td></tr>` : ''}</tbody>
      </table>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-action="close-modal">取消</button>
      <button type="button" class="btn btn-primary" id="do-export-json">下载 records.json</button>
    </div>
  `);

  modal.querySelector('#do-export-json').addEventListener('click', () => {
    const payload = toExportRecords(records);
    download('records.json', `${JSON.stringify(payload, null, 2)}\n`, 'application/json');
    closeModal();
    toast('已下载 records.json。下一步：替换仓库文件 → git commit & push。');
  });
}

function openImportDialog() {
  const modal = openModal(`
    <div class="modal-head">
      <h2>导入 JSON</h2>
      <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
    </div>
    <div class="notice" style="margin-bottom:12px">
      选择一个 <code>records.json</code> 格式的文件。导入前会先完整校验结构、日期与 OHLC 关系，
      <b>任何一处不合法就整体拒绝</b>，现有数据不会被动到。校验通过后，记录进入浏览器暂存区，仓库文件不会被自动改动。
    </div>
    <div class="form-row">
      <label for="import-pick">选择文件</label>
      <input class="field-input" type="file" id="import-pick" accept="application/json,.json">
      <span class="field-hint">文件根节点必须是数组，格式与仓库中的 data/records.json 一致</span>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn" data-action="close-modal">取消</button>
    </div>
  `);

  const picker = modal.querySelector('#import-pick');
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseRecordsJSON(text);
    if (!result.ok) {
      openModal(`
        <div class="modal-head">
          <h2>导入失败</h2>
          <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
        </div>
        <div class="form-error" style="margin-top:0">
          <b>文件未通过校验，现有数据没有被改动</b>
          <ul>${result.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </div>
        <div class="modal-foot"><button type="button" class="btn" data-action="close-modal">知道了</button></div>
      `);
      return;
    }
    const existing = new Set(state.merged.map((r) => r.date));
    const conflict = result.records.filter((r) => existing.has(r.date));
    const confirm = openModal(`
      <div class="modal-head">
        <h2>导入确认</h2>
        <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
      </div>
      <p style="font-size:13.5px;color:#B9C2CC;margin:0 0 10px">
        文件通过校验，共 <b class="num">${result.records.length}</b> 条记录。
        ${conflict.length ? `其中 <b class="num">${conflict.length}</b> 条与现有记录同日期，将<b>更新</b>而不是新增。` : '全部为新日期。'}
        导入后它们进入浏览器暂存区，仓库文件不会被自动改动。
      </p>
      <div class="table-wrap" style="max-height:240px;overflow-y:auto">
        <table class="data" style="min-width:0">
          <thead><tr><th scope="col">日期</th><th scope="col">收盘</th><th scope="col" style="text-align:left">标题</th></tr></thead>
          <tbody>${result.records.map((r) => `
            <tr>
              <td class="num">${r.date}</td>
              <td class="num">${formatNumber(r.ohlc.close)}</td>
              <td style="text-align:left;white-space:normal">${escapeHtml(r.title)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" id="do-import">导入到暂存区</button>
      </div>
    `);
    confirm.querySelector('#do-import').addEventListener('click', () => {
      for (const record of result.records) {
        state.pending[record.date] = { mode: 'upsert', record };
      }
      if (!savePending()) return;
      recompute();
      closeModal();
      renderChrome();
      renderView();
      toast(`已导入 ${result.records.length} 条记录到浏览器暂存区（仓库未改动）。`);
    });
  });
}

function exportCSV() {
  if (!state.merged.length) {
    toast('还没有可导出的记录。', 'warn');
    return;
  }
  download('ysi-history.csv', toCSV(state.merged, state.meta.base_value), 'text/csv');
  toast(`已导出 ${state.merged.length} 条记录的 CSV。`);
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  // 统一用事件委托，避免动态渲染后重复绑定
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'new') { openEditor(null); return; }
    if (action === 'edit') {
      closeModal();
      openEditor(btn.dataset.date);
      return;
    }
    if (action === 'view') { openDetail(btn.dataset.date); return; }
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'export-json') { openExportDialog(); return; }
    if (action === 'export-csv') { exportCSV(); return; }
    if (action === 'import-json') { openImportDialog(); return; }
    if (action === 'toggle-ma') {
      state.showMA = !state.showMA;
      renderView();
      return;
    }
    if (action === 'range') {
      state.range = btn.dataset.range;
      renderChrome();
      renderView();
    }
  });

  window.addEventListener('hashchange', () => {
    const hash = (location.hash || '#/overview').replace('#/', '');
    state.view = VIEWS.includes(hash) ? hash : 'overview';
    renderChrome();
    renderView();
    window.scrollTo({ top: 0 });
  });
}

/* ---------------- 启动 ---------------- */

async function init() {
  const hash = (location.hash || '#/overview').replace('#/', '');
  state.view = VIEWS.includes(hash) ? hash : 'overview';
  state.pending = loadPending();

  try {
    const [meta, loaded] = await Promise.all([loadIndex(), loadRecords()]);
    state.meta = meta;
    state.published = loaded.records;
    state.invalid = loaded.invalid;
  } catch (err) {
    state.loadError = err.message || String(err);
    bindEvents();
    renderChrome();
    renderView();
    return;
  }

  recompute();
  bindEvents();
  renderChrome();
  renderView();

  if (state.invalid.length) {
    toast(`data/records.json 中有 ${state.invalid.length} 条记录未通过校验，已跳过。`, 'warn');
  }
}

init();
