/* =========================================================
   app.js — 状态、路由、事件与数据读写
   网页「保存记录」只写 localStorage；Git 提交才是发布。
   ========================================================= */

import {
  loadIndex, loadRecords, mergeRecords, computeMetrics, computeSummary,
  validateRecord, normalizeRecord, parseRecordsJSON, toCSV, toExportRecords,
  formatNumber, formatSigned, directionClass, escapeHtml,
  isValidDateString, assetUrl, isSafeImageSource,
} from './lib/data.js';
import { renderJournalBody } from './lib/richtext.js';
import {
  initStarField, initScrollState, initTilt, refreshEnhancements,
} from './lib/ambience.js';
import {
  renderChrome, toggleMobileNav, closeMobileNav, VIEW_META,
} from './components/layout.js';
import { openModal, closeModal, toast, download } from './components/ui.js';
import { entryMetaHtml } from './components/entry-card.js';
import { icon } from './components/icons.js';
import { todayISO } from './lib/selectors.js';
import { renderOverview } from './views/overview.js';
import { renderJournal } from './views/journal.js';
import { renderHistory } from './views/history.js';
import { renderMethodology } from './views/methodology.js';

const STORAGE_KEY = 'ysi.pending.v1';
const VIEWS = Object.keys(VIEW_META);
const PAGE_SIZE = 24;

const state = {
  meta: null,
  published: [],
  pending: {},
  invalid: [],
  merged: [],
  metrics: [],
  summary: null,
  view: 'overview',
  range: '365',
  window: null,
  query: '',
  sort: 'desc',
  year: 'all',
  showMA: true,
  journalLimit: PAGE_SIZE,
  historyLimit: 120,
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
      if (item.mode === 'delete') out[date] = { mode: 'delete' };
      else if (item.record) out[date] = { mode: 'upsert', record: normalizeRecord(item.record) };
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

/* ---------------- 数据流 ---------------- */

function recompute() {
  state.merged = mergeRecords(state.published, state.pending);
  state.metrics = computeMetrics(state.merged, state.meta.base_value);
  state.summary = computeSummary(state.metrics, state.meta.base_value);
}

/** 取某日期之前最近一条有效记录的收盘价，作为默认开盘价 */
function previousClose(date) {
  const earlier = state.metrics.filter((m) => m.date < date);
  if (earlier.length) return earlier[earlier.length - 1].ohlc.close;
  return state.meta.base_value;
}

/* ---------------- 路由 ---------------- */

function currentView() {
  const raw = (location.hash || '#/overview').replace(/^#\/?/, '');
  return VIEWS.includes(raw) ? raw : 'overview';
}

const chartHandlers = {
  commitWindow(window) {
    if (!window) return;
    state.window = { ...window };
    state.range = 'custom';
  },
};

function renderView() {
  const host = document.getElementById('view');
  if (state.loadError) {
    host.innerHTML = `
      <div class="panel glass error-panel">
        <p class="eyebrow">DATA ERROR</p>
        <h2>无法读取数据文件</h2>
        <p>${escapeHtml(state.loadError)}</p>
        <p class="muted">页面通过相对路径读取 <code>data/index.json</code> 与 <code>data/records.json</code>。请确认数据文件存在，并通过本地静态服务器或 GitHub Pages 访问。</p>
        <div class="inline-actions">
          <button type="button" class="btn btn-primary" data-action="retry">重新加载</button>
        </div>
      </div>`;
    refreshEnhancements(host);
    return;
  }
  if (state.view === 'overview') renderOverview(host, state, chartHandlers);
  else if (state.view === 'journal') renderJournal(host, state);
  else if (state.view === 'history') renderHistory(host, state, chartHandlers);
  else renderMethodology(host, state);
  refreshEnhancements(host);
}

function render() {
  renderChrome(state);
  renderView();
}

function applyRoute({ scroll = true } = {}) {
  closeModal();
  closeMobileNav();
  state.view = currentView();
  render();
  if (scroll) {
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    window.scrollTo({ top: 0, behavior });
  }
}

/* ---------------- 表单 ---------------- */

function openEditor(date) {
  const existing = date ? state.merged.find((r) => r.date === date) : null;
  const rec = existing
    ? { ...existing }
    : {
        date: todayISO(),
        title: '', body: '', mood: '', energy: '', tags: [], cover: '',
        ohlc: { open: previousClose(todayISO()), high: null, low: null, close: null },
      };

  const defOpen = existing ? rec.ohlc.open : previousClose(rec.date);
  const defHigh = Number.isFinite(rec.ohlc.high) ? rec.ohlc.high : defOpen;
  const defLow = Number.isFinite(rec.ohlc.low) ? rec.ohlc.low : defOpen;
  const defClose = Number.isFinite(rec.ohlc.close) ? rec.ohlc.close : defOpen;

  const modal = openModal({
    title: existing ? '编辑记录' : '新建记录',
    subtitle: existing ? existing.date : 'NEW ENTRY',
    className: 'modal-wide',
    body: `
      <form id="record-form" novalidate>
        <div class="form-section">
          <p class="form-section-title">01 · 记录</p>
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
            <div class="form-row">
              <label for="f-energy">能量（0–10）</label>
              <input class="field-input" type="number" id="f-energy" min="0" max="10" step="1" value="${rec.energy ?? ''}">
            </div>
            <div class="form-row">
              <label for="f-tags">标签</label>
              <input class="field-input" type="text" id="f-tags" value="${escapeHtml((rec.tags || []).join('、'))}" placeholder="用、或逗号分隔">
            </div>
            <div class="form-row full">
              <label for="f-cover">封面（可选）</label>
              <input class="field-input" type="text" id="f-cover" value="${escapeHtml(rec.cover || '')}" placeholder="images/journal/2026-10-29.webp">
              <span class="field-hint">放在 public/images/journal/ 下；支持站内相对路径或 https 外链。</span>
              <div class="cover-preview" id="cover-preview" hidden><img alt="封面预览"></div>
            </div>
          </div>
        </div>

        <div class="form-section">
          <p class="form-section-title">02 · 正文</p>
          <div class="form-row full">
            <label for="f-body">正文 <span class="req">*</span></label>
            <textarea class="field-textarea" id="f-body" rows="8" placeholder="在这里写入当天真实的日记。" required>${escapeHtml(rec.body || '')}</textarea>
            <span class="field-hint">支持段落、标题、引用、列表、链接、图片与粗体；原始 HTML 会被转义。</span>
          </div>
        </div>

        <div class="form-section">
          <p class="form-section-title">03 · 行情</p>
          <div class="form-grid">
            <div class="form-row">
              <label for="f-open">开盘价 <span class="req">*</span></label>
              <input class="field-input num" type="number" id="f-open" step="0.01" value="${defOpen}" required>
              <span class="field-hint">默认上一条收盘价</span>
            </div>
            <div class="form-row">
              <label for="f-high">最高价 <span class="req">*</span></label>
              <input class="field-input num" type="number" id="f-high" step="0.01" value="${defHigh}" required>
            </div>
            <div class="form-row">
              <label for="f-low">最低价 <span class="req">*</span></label>
              <input class="field-input num" type="number" id="f-low" step="0.01" value="${defLow}" required>
            </div>
            <div class="form-row">
              <label for="f-close">收盘价 <span class="req">*</span></label>
              <input class="field-input num" type="number" id="f-close" step="0.01" value="${defClose}" required>
              <span class="field-hint">落笔时的状态</span>
            </div>
          </div>
          <div class="ohlc-preview" id="ohlc-preview"></div>
        </div>

        <div class="form-error" id="form-error" hidden></div>

        <label class="check-row">
          <input type="checkbox" id="f-confirm" checked>
          <span>我确认内容与日期无误。保存后它只存在于当前浏览器，<b>不会</b>写入 GitHub 仓库。</span>
        </label>
      </form>`,
    foot: `
      <button type="button" class="btn" data-action="close-modal">取消</button>
      <button type="submit" form="record-form" class="btn btn-primary">保存到浏览器暂存区</button>`,
  });

  const form = modal.querySelector('#record-form');
  const f = {
    date: modal.querySelector('#f-date'),
    title: modal.querySelector('#f-title'),
    body: modal.querySelector('#f-body'),
    mood: modal.querySelector('#f-mood'),
    energy: modal.querySelector('#f-energy'),
    tags: modal.querySelector('#f-tags'),
    cover: modal.querySelector('#f-cover'),
    open: modal.querySelector('#f-open'),
    high: modal.querySelector('#f-high'),
    low: modal.querySelector('#f-low'),
    close: modal.querySelector('#f-close'),
  };
  const errorBox = modal.querySelector('#form-error');
  const preview = modal.querySelector('#ohlc-preview');
  const dateHint = modal.querySelector('#date-hint');
  const coverPreview = modal.querySelector('#cover-preview');
  const coverImg = coverPreview.querySelector('img');
  const touched = { high: Number.isFinite(rec.ohlc.high), low: Number.isFinite(rec.ohlc.low) };

  const num = (input) => {
    if (input.value.trim() === '') return null;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : null;
  };

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
      preview.innerHTML = '<span class="muted">填写完整的四个数字后显示校验结果</span>';
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
      <span>对基准 <b class="${directionClass(change)}">${formatSigned(change)}</b></span>
      <span class="${problems.length ? 'down' : 'up'}">${problems.length ? problems.join('；') : 'OHLC 关系有效'}</span>`;
  }

  function updateCover() {
    const value = f.cover.value.trim();
    if (value && isSafeImageSource(value)) {
      coverImg.src = assetUrl(value);
      coverPreview.hidden = false;
      coverImg.onerror = () => { coverPreview.hidden = true; };
    } else {
      coverPreview.hidden = true;
      coverImg.removeAttribute('src');
    }
  }

  f.high.addEventListener('input', () => { touched.high = true; updatePreview(); });
  f.low.addEventListener('input', () => { touched.low = true; updatePreview(); });
  f.cover.addEventListener('input', updateCover);
  [f.open, f.close].forEach((input) => input.addEventListener('input', () => { syncDefaults(); updatePreview(); }));
  f.date.addEventListener('change', () => {
    if (!isValidDateString(f.date.value)) return;
    touched.high = false;
    touched.low = false;
    f.open.value = previousClose(f.date.value).toFixed(2);
    syncDefaults();
    updatePreview();
    const dup = state.merged.find((r) => r.date === f.date.value);
    dateHint.textContent = dup ? `${f.date.value} 已有记录，保存将更新它` : '可补记过去的日期';
  });

  updatePreview();
  updateCover();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = {
      date: f.date.value,
      title: f.title.value.trim(),
      body: f.body.value.trim(),
      mood: f.mood.value.trim(),
      energy: f.energy.value === '' ? null : Number(f.energy.value),
      tags: f.tags.value.split(/[、,，;；\s]+/).map((t) => t.trim()).filter(Boolean),
      cover: f.cover.value.trim(),
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
    render();
    toast(sameDate
      ? `已更新 ${record.date} 到浏览器暂存区（未写入仓库）。`
      : `已保存 ${record.date} 到浏览器暂存区（未写入仓库）。`);
  });
}

/* ---------------- 阅读 ---------------- */

function openDetail(date) {
  const rec = state.metrics.find((r) => r.date === date);
  if (!rec) return;
  openModal({
    title: rec.title,
    subtitle: rec.date,
    className: 'modal-reading',
    body: `
      ${entryMetaHtml(rec)}
      ${rec.cover ? `<figure class="detail-cover"><img src="${assetUrl(rec.cover)}" alt="日记封面" loading="lazy" decoding="async"></figure>` : ''}
      <div class="journal-body">${renderJournalBody(rec.body)}</div>`,
    foot: `
      <button type="button" class="btn" data-action="close-modal">关闭</button>
      <button type="button" class="btn btn-primary" data-action="edit" data-date="${rec.date}">${icon('edit', 14)}<span>编辑</span></button>`,
  });
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
      <td>${escapeHtml(r.title)}</td>
      <td>${r.pending ? '<span class="badge badge-warn">待发布</span>' : '<span class="badge">正式</span>'}</td>
    </tr>`).join('');

  const modal = openModal({
    title: '导出 JSON',
    subtitle: 'PUBLISH',
    className: 'modal-wide',
    body: `
      <div class="notice">
        导出的是<b>当前展示的全部 ${records.length} 条记录</b>（含浏览器暂存区），格式与仓库中的 <code>data/records.json</code> 完全一致。
        导出后请手动替换仓库文件并执行 <code>git commit</code> 与 <code>git push</code>——网页不会替你提交。
      </div>
      <div class="table-wrap table-wrap--short">
        <table class="data-table">
          <thead><tr><th scope="col">日期</th><th scope="col">收盘</th><th scope="col">标题</th><th scope="col">状态</th></tr></thead>
          <tbody>${rows}${records.length > 8 ? `<tr><td colspan="4" class="muted center">… 以及更早的 ${records.length - 8} 条</td></tr>` : ''}</tbody>
        </table>
      </div>`,
    foot: `
      <button type="button" class="btn" data-action="close-modal">取消</button>
      <button type="button" class="btn btn-primary" id="do-export-json">下载 records.json</button>`,
  });

  modal.querySelector('#do-export-json').addEventListener('click', () => {
    const payload = toExportRecords(records);
    download('records.json', `${JSON.stringify(payload, null, 2)}\n`, 'application/json');
    closeModal();
    toast('已下载 records.json。下一步：替换仓库文件 → git commit & push。');
  });
}

function openImportDialog() {
  const modal = openModal({
    title: '导入 JSON',
    subtitle: 'IMPORT',
    className: 'modal-wide',
    body: `
      <div class="notice">
        选择一份 <code>records.json</code> 格式的文件。导入前会完整校验结构、日期与 OHLC 关系，
        <b>任何一处不合法就整体拒绝</b>，现有数据不会被动到。校验通过后进入浏览器暂存区，仓库文件不会被自动改动。
      </div>
      <div class="form-row">
        <label for="import-pick">选择文件</label>
        <input class="field-input" type="file" id="import-pick" accept="application/json,.json">
        <span class="field-hint">文件根节点必须是数组，格式与仓库中的 data/records.json 一致</span>
      </div>`,
    foot: '<button type="button" class="btn" data-action="close-modal">取消</button>',
  });

  const picker = modal.querySelector('#import-pick');
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseRecordsJSON(text);
    if (!result.ok) {
      openModal({
        title: '导入失败',
        subtitle: 'REJECTED',
        body: `<div class="form-error"><b>文件未通过校验，现有数据没有被改动</b><ul>${result.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`,
        foot: '<button type="button" class="btn" data-action="close-modal">知道了</button>',
      });
      return;
    }
    const existing = new Set(state.merged.map((r) => r.date));
    const conflict = result.records.filter((r) => existing.has(r.date));
    const confirm = openModal({
      title: '导入确认',
      subtitle: 'VALIDATED',
      className: 'modal-wide',
      body: `
        <p>文件通过校验，共 <b>${result.records.length}</b> 条记录。${conflict.length ? `其中 <b>${conflict.length}</b> 条与现有记录同日期，将<b>更新</b>而不是新增。` : '全部为新日期。'}导入后进入浏览器暂存区，仓库文件不会被自动改动。</p>
        <div class="table-wrap table-wrap--short">
          <table class="data-table">
            <thead><tr><th scope="col">日期</th><th scope="col">收盘</th><th scope="col">标题</th></tr></thead>
            <tbody>${result.records.map((r) => `
              <tr>
                <td class="num">${r.date}</td>
                <td class="num">${formatNumber(r.ohlc.close)}</td>
                <td>${escapeHtml(r.title)}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>`,
      foot: `
        <button type="button" class="btn" data-action="close-modal">取消</button>
        <button type="button" class="btn btn-primary" id="do-import">导入到暂存区</button>`,
    });
    confirm.querySelector('#do-import').addEventListener('click', () => {
      for (const record of result.records) {
        state.pending[record.date] = { mode: 'upsert', record };
      }
      if (!savePending()) return;
      recompute();
      closeModal();
      render();
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
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const action = trigger.dataset.action;
    if (action !== 'toggle-menu' && action !== 'close-menu') closeMobileNav();

    if (action === 'new') { openEditor(null); return; }
    if (action === 'edit') { closeModal(); openEditor(trigger.dataset.date); return; }
    if (action === 'view') { openDetail(trigger.dataset.date); return; }
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'export-json') { openExportDialog(); return; }
    if (action === 'export-csv') { exportCSV(); return; }
    if (action === 'import-json') { openImportDialog(); return; }
    if (action === 'toggle-menu') { toggleMobileNav(); return; }
    if (action === 'close-menu') { closeMobileNav(); return; }
    if (action === 'retry') { window.location.reload(); return; }
    if (action === 'toggle-ma') {
      state.showMA = !state.showMA;
      renderView();
      return;
    }
    if (action === 'range') {
      state.range = trigger.dataset.range;
      state.window = null;
      state.historyLimit = 120;
      renderView();
    }
  });

  window.addEventListener('hashchange', () => applyRoute());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMobileNav();
  });
}

/* ---------------- 启动 ---------------- */

async function init() {
  initStarField();
  initScrollState();
  initTilt();
  state.pending = loadPending();
  state.view = currentView();
  bindEvents();
  renderChrome(state);

  try {
    const [meta, loaded] = await Promise.all([loadIndex(), loadRecords()]);
    state.meta = meta;
    state.published = loaded.records;
    state.invalid = loaded.invalid;
  } catch (err) {
    state.loadError = err.message || String(err);
    state.meta = state.meta ?? { base_value: 0, base_date: '', frequency: 'weekly' };
    state.summary = computeSummary([], 0);
    render();
    return;
  }

  recompute();
  render();

  if (state.invalid.length) {
    toast(`data/records.json 中有 ${state.invalid.length} 条记录未通过校验，已跳过。`, 'warn');
  }
}

init();
