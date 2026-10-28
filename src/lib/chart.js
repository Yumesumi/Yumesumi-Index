/* =========================================================
   chart.js — 原生 SVG K 线
   无第三方图表库。蜡烛按记录序号等距排列（不按日历缩放），
   数据量大时横向滚动，保证每根蜡烛仍然可读。
   ========================================================= */

import {
  directionClass, escapeHtml, formatNumber, formatPct,
  formatDateLong, movingAverage,
} from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = { top: 28, right: 24, bottom: 38, left: 12 };
const PAD_SM = { top: 24, right: 16, bottom: 34, left: 8 };
const MIN_SLOT = 8;
const observers = new WeakMap();

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

function div(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function computeScale(metrics, baseValue, lastClose) {
  let min = Infinity;
  let max = -Infinity;
  for (const m of metrics) {
    if (Number.isFinite(m.ohlc.low)) min = Math.min(min, m.ohlc.low);
    if (Number.isFinite(m.ohlc.high)) max = Math.max(max, m.ohlc.high);
  }
  if (Number.isFinite(lastClose)) {
    min = Math.min(min, lastClose);
    max = Math.max(max, lastClose);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const span = Math.max(Math.abs(baseValue), 1);
    return { min: baseValue - span * 0.1, max: baseValue + span * 0.1, baseVisible: true };
  }
  if (min === max) {
    const spread = Math.max(Math.abs(min), 1) * 0.02;
    min -= spread;
    max += spread;
  }
  // 纵轴跟随当前范围，避免基准远离数据时把波动压成一条线。
  // 基准落在范围内才画线；范围外由边缘提示标注方向。
  const padding = (max - min) * 0.12;
  const scaleMin = min - padding;
  const scaleMax = max + padding;
  return {
    min: scaleMin,
    max: scaleMax,
    baseVisible: baseValue >= scaleMin && baseValue <= scaleMax,
  };
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

function tooltipHtml(m) {
  const dir = directionClass(m.change);
  const sign = m.change > 0 ? '+' : m.change < 0 ? '−' : '';
  const pct = Number.isFinite(m.changePct) ? ` <span>(${formatPct(m.changePct)})</span>` : '';
  return `
    <div class="tip-date">${formatDateLong(m.date)}</div>
    ${m.title ? `<div class="tip-title">${escapeHtml(m.title)}</div>` : ''}
    <div class="tip-grid">
      <div><span>开</span><b>${formatNumber(m.ohlc.open)}</b></div>
      <div><span>高</span><b>${formatNumber(m.ohlc.high)}</b></div>
      <div><span>低</span><b>${formatNumber(m.ohlc.low)}</b></div>
      <div><span>收</span><b>${formatNumber(m.ohlc.close)}</b></div>
    </div>
    <div class="tip-change ${dir}">${sign}${formatNumber(Math.abs(m.change))}${pct}</div>
  `;
}

/**
 * 渲染 K 线。
 * @param {HTMLElement} host 图表挂载点
 * @param {Array} metrics 已补齐派生指标的记录
 * @param {Object} options { baseValue, showMA, emptyText, animate }
 */
export function renderKLine(host, metrics, options = {}) {
  host._chartState = { metrics, options };
  const baseValue = options.baseValue ?? 1000;
  const showMA = options.showMA ?? true;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!metrics.length) {
    host.textContent = '';
    const empty = div('empty chart-empty');
    empty.innerHTML = `<div class="empty-mark">YSI</div><h3>暂无 K 线数据</h3><p>${escapeHtml(options.emptyText ?? '还没有正式记录，图表不会凭空生成数据。')}</p>`;
    host.append(empty);
    return;
  }

  const viewportWidth = Math.max(280, Math.round(host.clientWidth || 900));
  const small = viewportWidth < 600;
  const pad = small ? PAD_SM : PAD;
  const axisWidth = small ? 52 : 68;
  const available = Math.max(200, viewportWidth - axisWidth);
  const height = small ? 300 : 386;
  const n = metrics.length;
  const minSlot = small ? 10 : MIN_SLOT;
  const chartWidth = Math.max(available, pad.left + pad.right + n * minSlot);
  const plotW = chartWidth - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / n;
  const candleWidth = Math.max(2, Math.min(13, slot * 0.58));
  const last = metrics[n - 1];
  const scale = computeScale(metrics, baseValue, last.ohlc.close);
  const { min, max } = scale;

  // 数据集本身变化时重新回到最右端；仅切换 MA 或窗口尺寸则保留滚动位置
  const signature = `${n}|${metrics[0].date}|${last.date}|${baseValue}`;
  if (host._chartSignature !== signature) {
    host._chartSignature = signature;
    host._scrollTouched = false;
  }

  const x = (i) => pad.left + slot * (i + 0.5);
  const y = (value) => pad.top + ((max - value) / (max - min)) * plotH;

  host.textContent = '';
  const shell = div('chart-shell');
  const axis = div('chart-axis');
  axis.style.width = `${axisWidth}px`;
  axis.style.height = `${height}px`;
  axis.setAttribute('aria-hidden', 'true');
  const plot = div('chart-plot');
  const viewport = div('chart-viewport');
  const stage = div('chart-stage');
  stage.style.width = `${chartWidth}px`;
  stage.style.height = `${height}px`;

  const svg = el('svg', {
    viewBox: `0 0 ${chartWidth} ${height}`,
    width: String(chartWidth),
    height: String(height),
    role: 'img',
    'aria-label': `K 线图，共 ${n} 条记录，最新收盘 ${formatNumber(last.ohlc.close)}`,
  });

  /* ---- 网格与价格刻度（Y 轴固定在视口左侧，不随 K 线滚动） ---- */
  for (const tick of niceTicks(min, max, 5)) {
    const ty = y(tick);
    if (ty < pad.top - 1 || ty > pad.top + plotH + 1) continue;
    svg.append(el('line', {
      x1: pad.left, x2: chartWidth - pad.right, y1: ty, y2: ty,
      class: 'chart-grid',
    }));
    const label = document.createElement('span');
    label.className = 'chart-yaxis-label';
    label.style.top = `${ty}px`;
    label.textContent = formatNumber(tick, tick % 1 === 0 ? 0 : 2);
    axis.append(label);
  }

  /* ---- 基准参考线：在可视范围内时绘制，否则用边缘提示 ---- */
  const baseY = scale.baseVisible ? y(baseValue) : null;
  let outsideLabel = null;
  if (scale.baseVisible) {
    svg.append(el('line', {
      x1: pad.left, x2: chartWidth - pad.right, y1: baseY, y2: baseY,
      class: 'chart-baseline',
    }));
    const baseLabel = el('text', {
      x: chartWidth - pad.right, y: baseY - 7, 'text-anchor': 'end',
      class: 'chart-baseline-label',
    });
    baseLabel.textContent = `基准 ${formatNumber(baseValue)}`;
    svg.append(baseLabel);
  } else {
    outsideLabel = div(`chart-outside-label ${baseValue > max ? 'is-above' : 'is-below'}`);
    outsideLabel.textContent = baseValue > max
      ? `基准 ${formatNumber(baseValue)} 在区间上方 ↑`
      : `基准 ${formatNumber(baseValue)} 在区间下方 ↓`;
  }

  /* ---- 最新价参考线 ---- */
  const lastY = y(last.ohlc.close);
  const lastDir = directionClass(last.change);
  if (baseY === null || Math.abs(lastY - baseY) > 16) {
    svg.append(el('line', {
      x1: pad.left, x2: chartWidth - pad.right, y1: lastY, y2: lastY,
      class: `chart-lastline ${lastDir}`,
    }));
    const lastLabel = el('text', {
      x: chartWidth - pad.right, y: lastY - 7, 'text-anchor': 'end',
      class: `chart-lastline-label ${lastDir}`,
    });
    lastLabel.textContent = `最新 ${formatNumber(last.ohlc.close)}`;
    svg.append(lastLabel);
  }

  /* ---- K 线实体与影线 ---- */
  const candleLayer = el('g', { class: 'chart-candles' });
  metrics.forEach((m, i) => {
    const cx = x(i);
    const dir = directionClass(m.change);
    const { open, high, low, close } = m.ohlc;
    candleLayer.append(el('line', {
      x1: cx, x2: cx, y1: y(high), y2: y(low),
      class: `candle-wick ${dir}`,
    }));
    const bodyTop = y(Math.max(open, close));
    const bodyH = Math.max(1, Math.abs(y(open) - y(close)));
    candleLayer.append(el('rect', {
      x: cx - candleWidth / 2, y: bodyTop, width: candleWidth, height: bodyH,
      class: `candle-body ${dir}`, rx: 0.5,
    }));
  });
  svg.append(candleLayer);

  /* ---- MA7 ---- */
  if (showMA && n >= 7) {
    const closes = metrics.map((m) => m.ohlc.close);
    const ma = movingAverage(closes, 7);
    const points = ma
      .map((value, i) => (value === null ? null : `${x(i)},${y(value)}`))
      .filter(Boolean)
      .join(' ');
    if (points) svg.append(el('polyline', { points, class: 'chart-ma' }));
  }

  /* ---- 日期刻度 ---- */
  const labelStep = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(chartWidth / 92))));
  metrics.forEach((m, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return;
    const text = el('text', {
      x: x(i), y: height - 13, 'text-anchor': 'middle', class: 'chart-axis-label',
    });
    text.textContent = m.date.slice(5);
    svg.append(text);
  });

  /* ---- 悬停热区 ---- */
  const hitLayer = el('g', { class: 'chart-hits' });
  metrics.forEach((m, i) => {
    hitLayer.append(el('rect', {
      x: x(i) - slot / 2, y: pad.top, width: Math.max(slot, MIN_SLOT), height: plotH,
      class: 'candle-hit', 'data-index': i,
    }));
  });
  svg.append(hitLayer);

  const crosshair = el('line', {
    x1: 0, x2: 0, y1: pad.top, y2: pad.top + plotH,
    class: 'chart-crosshair',
  });
  svg.append(crosshair);

  const tip = div('chart-tip');
  tip.hidden = true;
  stage.append(svg, tip);
  viewport.append(stage);

  const fadeLeft = div('chart-fade chart-fade--left');
  const fadeRight = div('chart-fade chart-fade--right');
  const hint = div('chart-scroll-hint');
  hint.textContent = `← 拖动查看更早 · ${n} 条记录`;
  plot.append(viewport, fadeLeft, fadeRight, hint);
  if (outsideLabel) plot.append(outsideLabel);
  shell.append(axis, plot);
  host.append(shell);

  if (!reduceMotion && options.animate !== false) {
    stage.classList.add('is-entering');
    stage.addEventListener('animationend', () => stage.classList.remove('is-entering'), { once: true });
  }

  const syncScrollState = () => {
    const maxScroll = viewport.scrollWidth - viewport.clientWidth;
    const scrollable = maxScroll > 4;
    shell.classList.toggle('is-scrollable', scrollable);
    shell.classList.toggle('at-start', viewport.scrollLeft <= 4);
    shell.classList.toggle('at-end', viewport.scrollLeft >= maxScroll - 4);
  };

  requestAnimationFrame(() => {
    // 首次渲染优先显示最新一根 K 线；用户已经手动滚动过则保留位置
    if (!host._scrollTouched) viewport.scrollLeft = viewport.scrollWidth;
    syncScrollState();
  });
  viewport.addEventListener('scroll', () => {
    host._scrollTouched = true;
    syncScrollState();
  }, { passive: true });

  /* ---- 悬停提示 ---- */
  let hideTimer = 0;
  const showTip = (index, clientX) => {
    const m = metrics[index];
    if (!m) return;
    const cx = x(index);
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    crosshair.classList.add('is-visible');
    tip.innerHTML = tooltipHtml(m);
    tip.hidden = false;
    const tipWidth = tip.offsetWidth || 190;
    const stageX = clientX - stage.getBoundingClientRect().left;
    let left = stageX + 16;
    if (left + tipWidth > chartWidth - 8) left = stageX - tipWidth - 16;
    tip.style.left = `${Math.max(8, Math.min(left, chartWidth - tipWidth - 8))}px`;
    tip.style.top = '10px';
    clearTimeout(hideTimer);
  };
  const hideTip = () => {
    hideTimer = window.setTimeout(() => {
      crosshair.classList.remove('is-visible');
      tip.hidden = true;
    }, 60);
  };

  svg.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const target = event.target.closest?.('.candle-hit');
    if (!target) { hideTip(); return; }
    showTip(Number(target.getAttribute('data-index')), event.clientX);
  });
  svg.addEventListener('pointerleave', hideTip);
  svg.addEventListener('click', (event) => {
    const target = event.target.closest?.('.candle-hit');
    if (!target) return;
    showTip(Number(target.getAttribute('data-index')), event.clientX);
  });

  /* ---- 尺寸变化时重绘 ---- */
  let lastWidth = viewportWidth;
  if (!observers.has(host)) {
    const ro = new ResizeObserver(() => {
      const current = Math.max(280, Math.round(host.clientWidth || 900));
      if (Math.abs(current - lastWidth) < 8) return;
      lastWidth = current;
      const state = host._chartState;
      if (state?.metrics?.length && host.isConnected) {
        const atEnd = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 8;
        host._scrollTouched = !atEnd;
        renderKLine(host, state.metrics, state.options);
      }
    });
    ro.observe(host);
    observers.set(host, ro);
  }
}
