/* =========================================================
   chart.js — 原生 SVG 日 K 线绘制
   无第三方图表库。输入已计算好派生指标的记录数组。
   ========================================================= */

import { formatNumber, movingAverage } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = { top: 18, right: 20, bottom: 34, left: 60 };

/** 每个容器只挂一个 resize 观察器，重复渲染时复用 */
const observers = new WeakMap();

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

/** 计算坐标轴范围：把基准点位一并纳入，避免参考线被裁掉 */
function computeScale(metrics, baseValue) {
  let min = baseValue;
  let max = baseValue;
  for (const m of metrics) {
    if (Number.isFinite(m.ohlc.low)) min = Math.min(min, m.ohlc.low);
    if (Number.isFinite(m.ohlc.high)) max = Math.max(max, m.ohlc.high);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = baseValue * 0.9;
    max = baseValue * 1.1;
  }
  if (min === max) {
    min -= baseValue * 0.02;
    max += baseValue * 0.02;
  }
  const padding = (max - min) * 0.08;
  return { min: min - padding, max: max + padding };
}

/** 生成"好看"的刻度值：步长取 1/2/2.5/5 × 10^n */
function niceTicks(min, max, count = 5) {
  const span = max - min;
  if (span <= 0) return [min];
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  let step;
  if (normalized <= 1) step = magnitude;
  else if (normalized <= 2) step = 2 * magnitude;
  else if (normalized <= 2.5) step = 2.5 * magnitude;
  else if (normalized <= 5) step = 5 * magnitude;
  else step = 10 * magnitude;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

/**
 * 渲染日 K 线。
 * viewBox 宽度取容器实际像素宽，使 1 个单位 = 1 个 CSS 像素，文字始终清晰。
 * @param {HTMLElement} host 图表容器
 * @param {Array} metrics 已补齐派生指标的记录
 * @param {Object} options { baseValue, showMA, emptyText }
 */
export function renderKLine(host, metrics, options = {}) {
  const baseValue = options.baseValue ?? 1000;
  const showMA = options.showMA ?? true;

  const state = { metrics, options, baseValue, showMA };
  host._chartState = state;

  if (!metrics.length) {
    host.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.margin = '0';
    empty.innerHTML = `<h3>暂无 K 线数据</h3><p>${options.emptyText ?? '还没有正式记录，图表不会凭空生成数据。'}</p>`;
    host.appendChild(empty);
    return;
  }

  const width = Math.max(300, Math.round(host.clientWidth || 900));
  const height = width < 560 ? 280 : 340;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const { min, max } = computeScale(metrics, baseValue);
  const x = (i) => {
    const step = plotW / metrics.length;
    return PAD.left + step * (i + 0.5);
  };
  const y = (value) => PAD.top + ((max - value) / (max - min)) * plotH;

  host.textContent = '';
  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: String(height),
    role: 'img',
    'aria-label': `日K线图，共 ${metrics.length} 条记录`,
  });

  /* ---- 网格与价格刻度 ---- */
  for (const tick of niceTicks(min, max, 5)) {
    const ty = y(tick);
    if (ty < PAD.top - 1 || ty > PAD.top + plotH + 1) continue;
    svg.appendChild(el('line', {
      x1: PAD.left, x2: width - PAD.right, y1: ty, y2: ty,
      stroke: '#28303A', 'stroke-width': 1,
    }));
    const label = el('text', {
      x: PAD.left - 8, y: ty + 4, 'text-anchor': 'end',
      fill: '#929DAA', 'font-size': 11, 'font-family': 'var(--font-mono)',
    });
    label.textContent = formatNumber(tick, tick % 1 === 0 ? 0 : 2);
    svg.appendChild(label);
  }

  /* ---- 基准参考线 ---- */
  const baseY = y(baseValue);
  svg.appendChild(el('line', {
    x1: PAD.left, x2: width - PAD.right, y1: baseY, y2: baseY,
    stroke: '#B8A77A', 'stroke-width': 1, 'stroke-dasharray': '5 4', opacity: 0.75,
  }));
  const baseLabel = el('text', {
    x: width - PAD.right, y: baseY - 6, 'text-anchor': 'end',
    fill: '#B8A77A', 'font-size': 11, 'font-family': 'var(--font-mono)',
  });
  baseLabel.textContent = `基准 ${formatNumber(baseValue)}`;
  svg.appendChild(baseLabel);

  /* ---- K 线实体与影线 ---- */
  const slot = plotW / metrics.length;
  const candleWidth = Math.max(2, Math.min(14, slot * 0.62));
  metrics.forEach((m, i) => {
    const cx = x(i);
    const rising = m.change > 0;
    const falling = m.change < 0;
    const color = rising ? '#35C99A' : falling ? '#F07878' : '#929DAA';
    const { open, high, low, close } = m.ohlc;

    // 影线
    svg.appendChild(el('line', {
      x1: cx, x2: cx, y1: y(high), y2: y(low),
      stroke: color, 'stroke-width': 1, opacity: 0.85,
    }));

    // 实体：涨为空心、跌为实心，颜色不是唯一的区分方式
    const bodyTop = y(Math.max(open, close));
    const bodyH = Math.max(1, Math.abs(y(open) - y(close)));
    svg.appendChild(el('rect', {
      x: cx - candleWidth / 2, y: bodyTop, width: candleWidth, height: bodyH,
      fill: rising ? '#11151B' : color,
      stroke: color, 'stroke-width': 1, rx: 0.5,
    }));

    // 悬停热区
    svg.appendChild(el('rect', {
      x: cx - slot / 2, y: PAD.top, width: slot, height: plotH,
      fill: 'transparent', class: 'candle-hit', 'data-index': i,
    }));
  });

  /* ---- 7 日移动平均线（基于真实记录，不补造缺失日期） ---- */
  if (showMA && metrics.length >= 7) {
    const closes = metrics.map((m) => m.ohlc.close);
    const ma = movingAverage(closes, 7);
    const points = ma
      .map((value, i) => (value === null ? null : `${x(i)},${y(value)}`))
      .filter(Boolean)
      .join(' ');
    if (points) {
      svg.appendChild(el('polyline', {
        points, fill: 'none', stroke: '#7DD9BD', 'stroke-width': 1.4, opacity: 0.9,
      }));
    }
  }

  /* ---- 日期刻度 ---- */
  const labelStep = Math.max(1, Math.ceil(metrics.length / (width < 560 ? 4 : 7)));
  metrics.forEach((m, i) => {
    if (i % labelStep !== 0 && i !== metrics.length - 1) return;
    const text = el('text', {
      x: x(i), y: height - 14, 'text-anchor': 'middle',
      fill: '#929DAA', 'font-size': 11, 'font-family': 'var(--font-mono)',
    });
    text.textContent = m.date.slice(5);
    svg.appendChild(text);
  });

  /* ---- 悬停竖线 ---- */
  const crosshair = el('line', {
    x1: 0, x2: 0, y1: PAD.top, y2: PAD.top + plotH,
    stroke: '#7DD9BD', 'stroke-width': 1, opacity: 0, 'pointer-events': 'none',
  });
  svg.appendChild(crosshair);

  host.appendChild(svg);

  /* ---- 悬停提示 ---- */
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  host.appendChild(tip);

  svg.addEventListener('pointermove', (event) => {
    const target = event.target.closest?.('.candle-hit');
    if (!target) {
      crosshair.setAttribute('opacity', '0');
      tip.hidden = true;
      return;
    }
    const index = Number(target.getAttribute('data-index'));
    const m = metrics[index];
    if (!m) return;
    crosshair.setAttribute('x1', x(index));
    crosshair.setAttribute('x2', x(index));
    crosshair.setAttribute('opacity', '0.5');
    const dir = m.change > 0 ? 'up' : m.change < 0 ? 'down' : 'flat';
    const sign = m.change > 0 ? '+' : m.change < 0 ? '−' : '';
    tip.innerHTML = `
      <div class="tip-date">${m.date}</div>
      <div class="tip-row"><span>开</span><b>${formatNumber(m.ohlc.open)}</b></div>
      <div class="tip-row"><span>高</span><b>${formatNumber(m.ohlc.high)}</b></div>
      <div class="tip-row"><span>低</span><b>${formatNumber(m.ohlc.low)}</b></div>
      <div class="tip-row"><span>收</span><b>${formatNumber(m.ohlc.close)}</b></div>
      <div class="tip-row"><span>涨跌</span><b class="${dir}">${sign}${formatNumber(Math.abs(m.change))} (${sign}${formatNumber(Math.abs(m.changePct))}%)</b></div>
      ${m.title ? `<div class="tip-title">${m.title.replace(/[<>&]/g, '')}</div>` : ''}
    `;
    tip.hidden = false;
    const hostRect = host.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const scale = svgRect.width / width;
    const left = svgRect.left - hostRect.left + x(index) * scale + 12;
    tip.style.left = `${Math.min(Math.max(left, 4), hostRect.width - 170)}px`;
    tip.style.top = '12px';
  });

  svg.addEventListener('pointerleave', () => {
    crosshair.setAttribute('opacity', '0');
    tip.hidden = true;
  });

  /* ---- 尺寸变化时重绘 ---- */
  let lastWidth = width;
  let raf = 0;
  if (!observers.has(host)) {
    const ro = new ResizeObserver(() => {
      const current = Math.max(300, Math.round(host.clientWidth || 900));
      if (Math.abs(current - lastWidth) < 8) return;
      lastWidth = current;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (host.isConnected && host._chartState) {
          renderKLine(host, host._chartState.metrics, host._chartState.options);
        }
      });
    });
    ro.observe(host);
    observers.set(host, ro);
  }
}
