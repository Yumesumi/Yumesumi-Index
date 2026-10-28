/* =========================================================
   richtext.js — 日记正文的安全渲染
   只支持一个刻意收窄的 Markdown 子集：
     段落、换行、标题、引用、无序/有序列表、分割线、
     图片、链接、粗体、斜体、行内代码。
   原始 HTML 一律转义，图片与链接经过协议白名单。
   ========================================================= */

import { assetUrl, escapeHtml, isSafeImageSource } from './data.js';

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

function safeLink(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  if (value.startsWith('//')) return false;
  if (/^(?:javascript|vbscript|data):/i.test(value)) return false;
  // 明确的协议只允许 http(s) 与 mailto；其余无协议字符串视为站内相对路径
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^(?:https?|mailto):/i.test(value)) return false;
  return true;
}

function imageTag(src, alt, title, className = '') {
  const source = assetUrl(src);
  const caption = alt ? ` alt="${alt}"` : ' alt=""';
  const titleAttr = title ? ` title="${title}"` : '';
  const cls = className ? ` class="${className}"` : '';
  return `<img src="${source}"${caption}${titleAttr}${cls} loading="lazy" decoding="async">`;
}

/** 行内标记：先整体转义，再替换受控的 Markdown 片段 */
export function renderInline(raw) {
  let text = escapeHtml(raw);

  text = text.replace(IMAGE_RE, (match, alt, src, title) => {
    if (!isSafeImageSource(src)) return match;
    return imageTag(src, alt, title, 'inline-image');
  });

  text = text.replace(LINK_RE, (match, label, url, title) => {
    if (!safeLink(url)) return match;
    const href = url.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : assetUrl(url);
    const external = /^https?:\/\//i.test(url);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr}${attrs}>${label}</a>`;
  });

  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s（(])\*([^*\n]+)\*(?=$|[\s，。；、）)])/g, '$1<em>$2</em>');
  return text;
}

function isImageOnly(line) {
  const match = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
  return match ? match : null;
}

/**
 * 把日记正文渲染成 HTML。
 * 空行分段；单换行保留为 <br>，因为旧日记是按行书写的。
 */
export function renderJournalBody(body) {
  const source = String(body ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '<p class="is-muted">（正文为空）</p>';

  const lines = source.split('\n');
  const out = [];
  let paragraph = [];
  let list = null; // { type: 'ul' | 'ol', items: [] }
  let quote = [];
  let fence = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${renderInline(quote.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (fence) {
      if (trimmed.startsWith('```')) {
        out.push(`<pre><code>${escapeHtml(fence.lines.join('\n'))}</code></pre>`);
        fence = null;
      } else {
        fence.lines.push(rawLine);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushAll();
      fence = { lines: [] };
      continue;
    }

    if (!trimmed) {
      flushAll();
      continue;
    }

    const image = isImageOnly(trimmed);
    if (image && isSafeImageSource(image[2])) {
      flushAll();
      out.push(`<figure class="journal-figure">${imageTag(image[2], image[1], image[3])}${image[1] ? `<figcaption>${image[1]}</figcaption>` : ''}</figure>`);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = Math.min(4, heading[1].length + 2);
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(?:---+|\*\*\*+)$/.test(trimmed)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      flushList();
      quote.push(trimmed.replace(/^>\s?/, ''));
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.、]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
  }

  if (fence) {
    out.push(`<pre><code>${escapeHtml(fence.lines.join('\n'))}</code></pre>`);
  }
  flushAll();

  return out.join('\n');
}
