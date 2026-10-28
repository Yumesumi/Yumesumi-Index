/* 日记：检索、年份归档、分批加载与阅读入口 */

import { refreshEnhancements } from '../lib/ambience.js';
import { escapeHtml, groupByYear } from '../lib/data.js';
import { archiveYears, journalMatches } from '../lib/selectors.js';
import { entryCard } from '../components/entry-card.js';
import { emptyState } from '../components/ui.js';
import { icon } from '../components/icons.js';

const PAGE_SIZE = 24;

export function renderJournal(host, state) {
  const years = archiveYears(state.metrics);
  const totalYears = groupByYear(state.metrics).length;

  host.innerHTML = `
    <section class="view-head reveal">
      <p class="eyebrow">JOURNAL · 归档</p>
      <div class="view-head-row">
        <h2>记录与归档。</h2>
        <p class="lede">按日期排序、按年份归档。搜索会覆盖标题、正文、心境和标签；点开一条记录可以阅读完整正文。</p>
      </div>
    </section>

    <section class="panel glass-soft journal-panel">
      <div class="journal-toolbar">
        <label class="search-field">
          ${icon('search', 16)}
          <input class="field-input" type="search" id="journal-search" placeholder="搜索标题、正文、心境或标签" value="${escapeHtml(state.query)}" aria-label="搜索日记">
        </label>
        <label class="sort-field">
          <span class="sr-only">排序方式</span>
          <select id="journal-sort" aria-label="排序方式">
            <option value="desc" ${state.sort === 'desc' ? 'selected' : ''}>最新在前</option>
            <option value="asc" ${state.sort === 'asc' ? 'selected' : ''}>最早在前</option>
          </select>
          ${icon('chevronDown', 14)}
        </label>
        <button type="button" class="btn btn-primary journal-new" data-action="new">${icon('plus', 15)}<span>新建记录</span></button>
      </div>

      <div class="archive-bar" id="archive-bar" aria-label="按年份筛选"></div>

      <div class="journal-list-head">
        <span id="journal-count" class="panel-sub"></span>
        <span class="archive-count">${totalYears} 个年份 · ${state.metrics.length} 条</span>
      </div>

      <div id="journal-list"></div>
      <div class="load-more-wrap" id="load-more-wrap"></div>
    </section>`;

  const list = host.querySelector('#journal-list');
  const archiveBar = host.querySelector('#archive-bar');
  const countEl = host.querySelector('#journal-count');
  const loadWrap = host.querySelector('#load-more-wrap');

  if (!state.journalLimit) state.journalLimit = PAGE_SIZE;

  const currentRecords = () => {
    let records = state.metrics.filter((record) => journalMatches(record, state.query));
    if (state.year !== 'all') records = records.filter((record) => record.date.startsWith(state.year));
    return state.sort === 'desc' ? [...records].reverse() : records;
  };

  const paintArchives = () => {
    const chips = [
      `<button type="button" class="chip ${state.year === 'all' ? 'is-active' : ''}" data-action="filter-year" data-year="all">全部 <b>${state.metrics.length}</b></button>`,
      ...years.map(({ year, count }) => `<button type="button" class="chip ${state.year === year ? 'is-active' : ''}" data-action="filter-year" data-year="${year}">${year} <b>${count}</b></button>`),
    ];
    archiveBar.innerHTML = chips.join('');
  };

  const paintList = () => {
    const records = currentRecords();
    const visible = records.slice(0, state.journalLimit);
    countEl.textContent = `显示 ${visible.length} / ${records.length} 条`;
    if (!records.length) {
      list.innerHTML = emptyState({
        eyebrow: state.query ? 'NO MATCH' : 'START HERE',
        title: state.query ? '没有匹配的记录' : '还没有任何记录',
        text: state.query ? '换个关键词试试。搜索会覆盖标题、正文、标签和心境。' : '所有正式记录都手动创建。最低记录单位是一天，允许补记过去的日子。',
        action: state.query ? '' : '<button type="button" class="btn btn-primary" data-action="new">写下第一条记录</button>',
      });
    } else {
      list.innerHTML = `<div class="journal-list">${visible.map((record, i) => entryCard(record, i)).join('')}</div>`;
      refreshEnhancements(list);
    }
    const remaining = records.length - visible.length;
    loadWrap.innerHTML = remaining > 0
      ? `<button type="button" class="btn load-more" data-action="load-more">加载更早的 ${Math.min(PAGE_SIZE, remaining)} 条 <span>还有 ${remaining} 条</span></button>`
      : '';
  };

  paintArchives();
  paintList();

  host.querySelector('#journal-search').addEventListener('input', (event) => {
    state.query = event.target.value;
    state.journalLimit = PAGE_SIZE;
    paintList();
  });

  host.querySelector('#journal-sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.journalLimit = PAGE_SIZE;
    paintList();
  });

  archiveBar.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action="filter-year"]');
    if (!btn) return;
    state.year = btn.dataset.year;
    state.journalLimit = PAGE_SIZE;
    paintArchives();
    paintList();
  });

  loadWrap.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action="load-more"]')) return;
    state.journalLimit += PAGE_SIZE;
    paintList();
  });
}
