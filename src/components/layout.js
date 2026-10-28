/* 站点外壳：导航、标题、状态、暂存提示与移动端菜单 */

import { formatDateLong, pendingDates } from '../lib/data.js';
import { icon } from './icons.js';

export const VIEW_META = {
  overview: { title: '指数概览', eyebrow: 'OVERVIEW', sub: '当前点位与最近记录' },
  journal: { title: '日记归档', eyebrow: 'JOURNAL', sub: '记录、检索与阅读' },
  history: { title: '历史行情', eyebrow: 'HISTORY', sub: 'K 线与行情表' },
  methodology: { title: '指数说明', eyebrow: 'METHODOLOGY', sub: '规则、数据与发布' },
};

export function renderChrome(state) {
  const meta = VIEW_META[state.view] ?? VIEW_META.overview;
  document.getElementById('page-title').textContent = meta.title;
  document.getElementById('page-eyebrow').textContent = meta.eyebrow;
  document.getElementById('page-sub').textContent = meta.sub;

  document.querySelectorAll('.nav-link').forEach((link) => {
    const active = link.dataset.nav === state.view;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.mobile-nav-link').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.nav === state.view);
  });

  const dot = document.getElementById('side-status-dot');
  const text = document.getElementById('side-status-text');
  const dateEl = document.getElementById('side-status-date');
  if (state.loadError) {
    dot.className = 'status-dot is-err';
    text.textContent = '数据加载失败';
    dateEl.textContent = '请检查 data/ 目录';
  } else {
    dot.className = 'status-dot is-ok';
    text.textContent = `${state.published.length} 条正式记录`;
    dateEl.textContent = state.summary?.lastDate
      ? `最近更新 ${formatDateLong(state.summary.lastDate)}`
      : '尚未开始记录';
  }

  const mobileStatus = document.getElementById('mobile-status');
  if (mobileStatus) {
    mobileStatus.innerHTML = state.loadError
      ? '<span class="status-dot is-err"></span> 数据加载失败'
      : `<span class="status-dot is-ok"></span> ${state.published.length} 条正式记录 · ${state.summary?.lastDate ?? '—'}`;
  }

  const pending = pendingDates(state.pending);
  const bar = document.getElementById('pending-bar');
  if (pending.length) {
    bar.hidden = false;
    bar.innerHTML = `
      <span class="pending-dot" aria-hidden="true"></span>
      <span class="pending-text"><b>${pending.length}</b> 条记录只保存在当前浏览器，尚未写入仓库。</span>
      <span class="pending-hint">发布请走 journal 脚本或导出 JSON 后 git push。</span>
      <button type="button" class="btn btn-sm" data-action="export-json">${icon('download', 14)}<span>导出发布</span></button>`;
  } else {
    bar.hidden = true;
    bar.innerHTML = '';
  }

  const title = state.view === 'overview'
    ? '梦澄指数 YSI · Yumesumi Index'
    : `${meta.title} · 梦澄指数 YSI`;
  document.title = title;
}

export function openMobileNav() {
  const panel = document.getElementById('mobile-nav');
  if (!panel) return;
  panel.hidden = false;
  document.body.classList.add('menu-open');
  const toggle = document.querySelector('[data-action="toggle-menu"]');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => panel.classList.add('is-open'));
  const first = panel.querySelector('.mobile-nav-link');
  if (first) first.focus({ preventScroll: true });
}

export function closeMobileNav() {
  const panel = document.getElementById('mobile-nav');
  if (!panel || panel.hidden) return;
  panel.classList.remove('is-open');
  document.body.classList.remove('menu-open');
  const toggle = document.querySelector('[data-action="toggle-menu"]');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  window.setTimeout(() => { panel.hidden = true; }, 240);
}

export function toggleMobileNav() {
  const panel = document.getElementById('mobile-nav');
  if (panel?.hidden) openMobileNav();
  else closeMobileNav();
}
