/* =========================================================
   ui.js — 模态框、提示条与下载
   ========================================================= */

import { icon } from './icons.js';
import { escapeHtml } from '../lib/data.js';

let lastFocused = null;
let escHandler = null;
let trapHandler = null;

export function openModal({ title = '', body = '', foot = '', className = '', subtitle = '' }) {
  const root = document.getElementById('modal-root');
  lastFocused = document.activeElement;
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal glass ${className}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title || '对话框')}">
        <div class="modal-head">
          <div>
            ${subtitle ? `<p class="modal-eyebrow">${escapeHtml(subtitle)}</p>` : ''}
            <h2>${escapeHtml(title)}</h2>
          </div>
          <button type="button" class="icon-btn modal-close" data-action="close-modal" aria-label="关闭">${icon('close', 18)}</button>
        </div>
        <div class="modal-body">${body}</div>
        ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
      </div>
    </div>`;

  const backdrop = root.querySelector('[data-modal-backdrop]');
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) closeModal();
  });

  escHandler = (event) => { if (event.key === 'Escape') closeModal(); };
  trapHandler = (event) => {
    if (event.key !== 'Tab') return;
    const nodes = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.disabled && node.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', escHandler);
  document.addEventListener('keydown', trapHandler);
  document.body.classList.add('modal-open');

  const panel = root.querySelector('.modal');
  requestAnimationFrame(() => panel.classList.add('is-open'));
  const target = root.querySelector('input:not([type=hidden]), textarea, select, button.btn-primary, button.btn');
  if (target) target.focus();

  return panel;
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root || !root.innerHTML) return;
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (escHandler) document.removeEventListener('keydown', escHandler);
  if (trapHandler) document.removeEventListener('keydown', trapHandler);
  escHandler = null;
  trapHandler = null;
  if (lastFocused instanceof HTMLElement) lastFocused.focus({ preventScroll: true });
  lastFocused = null;
}

export function isModalOpen() {
  return !!document.querySelector('#modal-root .modal');
}

export function toast(message, kind = '') {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = `toast ${kind}`;
  node.hidden = false;
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.hidden = true; }, 4600);
}

export function download(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function emptyState({ eyebrow = 'NO DATA', title, text = '', action = '' }) {
  return `
    <div class="empty">
      <p class="eyebrow">${eyebrow}</p>
      <h3>${title}</h3>
      ${text ? `<p>${text}</p>` : ''}
      ${action}
    </div>`;
}
