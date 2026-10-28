/* 内联 SVG 图标：统一 24 视框、细线描边，避免额外图标依赖 */

const PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/>',
  table: '<path d="M4 6h16M4 12h16M4 18h16M9 4v16M15 4v16"/>',
  menu: '<path d="M4 8h16M4 16h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  arrowRight: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5m6 6-6-6 6-6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 4.5-4.5L14 17l2.5-2.5L20 18"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  upload: '<path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m14.5 5.5 4 4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  trend: '<path d="M4 17 10 11l4 4 6-7"/><path d="M15 8h5v5"/>',
};

export function icon(name, size = 16, className = '') {
  const path = PATHS[name];
  if (!path) return '';
  return `<svg class="icon ${className}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
