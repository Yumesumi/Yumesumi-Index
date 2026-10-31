/* =========================================================
   chart.js — 原生 SVG 盘面
   时间轴按真实记录日期排布；滚轮 / 双指缩放，拖拽平移。
   无第三方图表库，纵轴按当前可视窗口自适应。
   ========================================================= */

import {
  dateToMs, directionClass, escapeHtml, formatDateLong, formatNumber,
  formatPct, movingAverage,
} from './data.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86400000;
const PAD = { top: 26, right: 20, bottom: 36, left: 12 };
const PAD_SM = { top: 22, right: 14, bottom: 32, left: 8 };
const MIN_SPAN = 2 * DAY_MS;
const observers = new WeakMap();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function isoFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

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

function computeScale(visible, baseValue) {
  let min = Infinity;
  let max = -Infinity;
  for (const m of visible) {
    if (Number.isFinite(m.ohlc.low)) min = Math.min(min, m.ohlc.low);
    if (Number.isFinite(m.ohlc.high)) max = Math.max(max, m.ohlc.high);
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

const STEP_DAYS = [1, 2, 3, 7, 14, 30, 60, 90, 180, 365, 730, 1825];

function tickLabel(stepDays, date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (stepDays >= 365) return String(year);
  if (stepDays >= 30) return `${String(year).slice(2)}-${month}`;
  return `${month}-${day}`;
}

/** 根据可视宽度与时间跨度生成日期刻度 */
function timeTicks(startMs, endMs, plotW) {
  const spanDays = (endMs - startMs) / DAY_MS;
  const target = Math.max(3, Math.floor(plotW / 100));
  let stepDays = STEP_DAYS[STEP_DAYS.length - 1];
  for (const step of STEP_DAYS) {
    if (spanDays / step <= target) { stepDays = step; break; }
  }

  const ticks = [];
  if (stepDays >= 365) {
    const stepYears = Math.max(1, Math.round(stepDays / 365));
    let year = new Date(startMs).getUTCFullYear();
    year = Math.ceil(year / stepYears) * stepYears;
    for (let y = year; ; y += stepYears) {
      const t = Date.UTC(y, 0, 1);
      if (t > endMs) break;
      if (t >= startMs) ticks.push({ ms: t, label: String(y) });
    }
  } else if (stepDays >= 30) {
    const stepMonths = Math.max(1, Math.round(stepDays / 30));
    const start = new Date(startMs);
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth();
    month = Math.ceil(month / stepMonths) * stepMonths;
    if (month >= 12) {
      year += Math.floor(month / 12);
      month %= 12;
    }
    for (;;) {
      const t = Date.UTC(year, month, 1);
      if (t > endMs) break;
      if (t >= startMs) ticks.push({ ms: t, label: `${String(year).slice(2)}-${String(month + 1).padStart(2, '0')}` });
      month += stepMonths;
      if (month >= 12) {
        year += Math.floor(month / 12);
        month %= 12;
      }
    }
  } else {
    const day = DAY_MS * stepDays;
    let t = Math.ceil(startMs / day) * day;
    for (; t <= endMs; t += day) {
      ticks.push({ ms: t, label: tickLabel(stepDays, new Date(t)) });
    }
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

function lowerBound(items, ms) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].ms < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 渲染盘面。
 * @param {HTMLElement} host 图表挂载点
 * @param {Array} metrics 全部记录（不只是可视窗口）
 * @param {Object} options { baseValue, showMA, window, emptyText, animate, onWindowCommit }
 */
export function renderKLine(host, metrics, options = {}) {
  const baseValue = options.baseValue ?? 1000;
  const showMA = options.showMA ?? true;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  host.textContent = '';
  if (!metrics.length) {
    const empty = div('empty chart-empty');
    empty.innerHTML = `<div class="empty-mark">YSI</div><h3>暂无 K 线数据</h3><p>${escapeHtml(options.emptyText ?? '还没有正式记录，图表不会凭空生成数据。')}</p>`;
    host.append(empty);
    return;
  }

  const all = metrics.map((m) => ({ ...m, ms: dateToMs(m.date) }));
  const maValues = showMA && all.length >= 7
    ? movingAverage(all.map((m) => m.ohlc.close), 7)
    : all.map(() => null);

  const firstMs = all[0].ms;
  const lastMs = all[all.length - 1].ms;
  const bounds = { startMs: firstMs - DAY_MS, endMs: lastMs + DAY_MS };
  const maxSpan = Math.max(MIN_SPAN, bounds.endMs - bounds.startMs);

  const normalize = (startMs, endMs) => {
    let span = clamp(endMs - startMs, MIN_SPAN, maxSpan);
    let start = startMs;
    let end = start + span;
    if (end > bounds.endMs) {
      end = bounds.endMs;
      start = end - span;
    }
    if (start < bounds.startMs) {
      start = bounds.startMs;
      end = start + span;
    }
    if (end > bounds.endMs) end = bounds.endMs;
    if (start < bounds.startMs) start = bounds.startMs;
    return { startMs: start, endMs: end };
  };

  const initialSpan = options.window
    ? options.window.endMs - options.window.startMs
    : bounds.endMs - bounds.startMs;
  let current = normalize(
    options.window?.startMs ?? bounds.startMs,
    options.window?.endMs ?? (bounds.startMs + Math.min(initialSpan, maxSpan)),
  );
  let lastCommitted = options.window ? { ...options.window } : null;

  const shell = div('chart-shell');
  const axis = div('chart-axis');
  const stage = div('chart-stage');
  const tip = div('chart-tip');
  tip.hidden = true;
  const outsideLabel = div('chart-outside-label');
  outsideLabel.hidden = true;
  stage.append(outsideLabel, tip);
  shell.append(axis, stage);
  host.append(shell);

  let svg = null;
  let crosshair = null;
  let dims = { hostWidth: 0, stageW: 0, height: 0, plotW: 0, plotH: 0, small: false, axisWidth: 0, padLeft: PAD.left };
  let visible = [];
  let tipItems = [];
  let entered = false;

  const hideTip = () => {
    if (crosshair) crosshair.classList.remove('is-visible');
    tip.hidden = true;
  };

  const showTipAt = (clientX) => {
    if (!tipItems.length) return;
    const rect = stage.getBoundingClientRect();
    const px = clientX - rect.left;
    let nearest = tipItems[0];
    let best = Math.abs(nearest.x - px);
    for (const item of tipItems) {
      const distance = Math.abs(item.x - px);
      if (distance < best) {
        best = distance;
        nearest = item;
      }
    }
    const threshold = Math.max(18, (dims.plotW / Math.max(1, tipItems.length)) * 0.8);
    if (best > threshold) { hideTip(); return; }
    if (crosshair) {
      crosshair.setAttribute('x1', nearest.x);
      crosshair.setAttribute('x2', nearest.x);
      crosshair.classList.add('is-visible');
    }
    tip.innerHTML = tooltipHtml(nearest.m);
    tip.hidden = false;
    const tipWidth = tip.offsetWidth || 190;
    let left = nearest.x + 14;
    if (left + tipWidth > dims.stageW - 8) left = nearest.x - tipWidth - 14;
    tip.style.left = `${clamp(left, 8, dims.stageW - tipWidth - 8)}px`;
    tip.style.top = '10px';
  };

  const draw = () => {
    hideTip();
    const hostWidth = Math.max(280, Math.round(host.clientWidth || 900));
    const small = hostWidth < 600;
    const pad = small ? PAD_SM : PAD;
    const axisWidth = small ? 52 : 68;
    const stageW = Math.max(180, hostWidth - axisWidth);
    const height = small ? 300 : 386;
    const plotW = Math.max(80, stageW - pad.left - pad.right);
    const plotH = Math.max(80, height - pad.top - pad.bottom);
    dims = { hostWidth, stageW, height, plotW, plotH, small, axisWidth, padLeft: pad.left };

    axis.replaceChildren();
    axis.style.width = `${axisWidth}px`;
    axis.style.height = `${height}px`;
    stage.style.height = `${height}px`;

    if (svg) svg.remove();
    svg = el('svg', {
      viewBox: `0 0 ${stageW} ${height}`,
      width: String(stageW),
      height: String(height),
      role: 'img',
    });
    stage.insertBefore(svg, stage.firstChild);

    const start = current.startMs;
    const end = current.endMs;
    const span = end - start;
    const x = (ms) => pad.left + ((ms - start) / span) * plotW;
    const visibleItems = all.filter((m) => m.ms >= start && m.ms <= end);
    visible = visibleItems;
    tipItems = visibleItems.map((m) => ({ m, x: x(m.ms) }));

    const scale = computeScale(visibleItems, baseValue);
    const { min, max } = scale;
    const y = (value) => pad.top + ((max - value) / (max - min)) * plotH;

    /* ---- 网格与固定 Y 轴 ---- */
    const yTicks = niceTicks(min, max, small ? 4 : 5);
    for (const tick of yTicks) {
      const ty = y(tick);
      if (ty < pad.top - 1 || ty > pad.top + plotH + 1) continue;
      svg.append(el('line', {
        x1: pad.left, x2: stageW - pad.right, y1: ty, y2: ty,
        class: 'chart-grid',
      }));
      const label = document.createElement('span');
      label.className = 'chart-yaxis-label';
      label.style.top = `${ty}px`;
      label.textContent = formatNumber(tick, tick % 1 === 0 ? 0 : 2);
      axis.append(label);
    }

    /* ---- 基准线 / 区间外提示 ---- */
    outsideLabel.hidden = true;
    const baseY = y(baseValue);
    if (scale.baseVisible) {
      svg.append(el('line', {
        x1: pad.left, x2: stageW - pad.right, y1: baseY, y2: baseY,
        class: 'chart-baseline',
      }));
      const label = el('text', {
        x: stageW - pad.right, y: baseY - 7, 'text-anchor': 'end',
        class: 'chart-baseline-label',
      });
      label.textContent = `基准 ${formatNumber(baseValue)}`;
      svg.append(label);
    } else {
      outsideLabel.hidden = false;
      outsideLabel.className = `chart-outside-label ${baseValue > max ? 'is-above' : 'is-below'}`;
      outsideLabel.textContent = baseValue > max
        ? `基准 ${formatNumber(baseValue)} 在区间上方 ↑`
        : `基准 ${formatNumber(baseValue)} 在区间下方 ↓`;
    }

    /* ---- 最新价参考线：仅当全局最后一条在窗口内 ---- */
    const latest = all[all.length - 1];
    if (latest.ms >= start && latest.ms <= end) {
      const lastY = y(latest.ohlc.close);
      const dir = directionClass(latest.change);
      svg.append(el('line', {
        x1: pad.left, x2: stageW - pad.right, y1: lastY, y2: lastY,
        class: `chart-lastline ${dir}`,
      }));
      const label = el('text', {
        x: stageW - pad.right, y: lastY - 7, 'text-anchor': 'end',
        class: `chart-lastline-label ${dir}`,
      });
      label.textContent = `最新 ${formatNumber(latest.ohlc.close)}`;
      svg.append(label);
    }

    /* ---- 日期刻度 ---- */
    const ticks = timeTicks(start, end, plotW);
    const latestRecord = all[all.length - 1];
    if (latestRecord.ms >= start && latestRecord.ms <= end) {
      const latestX = x(latestRecord.ms);
      const lastTickX = ticks.length ? x(ticks[ticks.length - 1].ms) : -Infinity;
      if (Math.abs(latestX - lastTickX) > 50) {
        const d = new Date(latestRecord.ms);
        ticks.push({
          ms: latestRecord.ms,
          label: `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
        });
      }
    }
    for (const tick of ticks) {
      const tx = x(tick.ms);
      if (tx < pad.left - 1 || tx > stageW - pad.right + 1) continue;
      let anchor = 'middle';
      if (tx < pad.left + 24) anchor = 'start';
      else if (tx > stageW - pad.right - 24) anchor = 'end';
      const text = el('text', {
        x: tx, y: height - 13, 'text-anchor': anchor, class: 'chart-axis-label',
      });
      text.textContent = tick.label;
      svg.append(text);
    }

    /* ---- 蜡烛 ---- */
    const slot = plotW / Math.max(1, visibleItems.length);
    const candleWidth = Math.max(2, Math.min(13, slot * 0.55));
    for (const m of visibleItems) {
      const cx = x(m.ms);
      const dir = directionClass(m.change);
      svg.append(el('line', {
        x1: cx, x2: cx, y1: y(m.ohlc.high), y2: y(m.ohlc.low),
        class: `candle-wick ${dir}`,
      }));
      const bodyTop = y(Math.max(m.ohlc.open, m.ohlc.close));
      const bodyH = Math.max(1, Math.abs(y(m.ohlc.open) - y(m.ohlc.close)));
      svg.append(el('rect', {
        x: cx - candleWidth / 2, y: bodyTop, width: candleWidth, height: bodyH,
        class: `candle-body ${dir}`, rx: 0.5,
      }));
    }

    /* ---- MA7：基于全部记录计算，窗口边缘保持连续 ---- */
    if (showMA && all.length >= 7 && visibleItems.length) {
      const lo = lowerBound(all, start);
      const hi = lowerBound(all, end + 1) - 1;
      const from = Math.max(0, lo - 1);
      const to = Math.min(all.length - 1, hi + 1);
      const points = [];
      for (let i = from; i <= to; i += 1) {
        const value = maValues[i];
        if (value === null) continue;
        points.push(`${x(all[i].ms)},${y(value)}`);
      }
      if (points.length > 1) svg.append(el('polyline', { points: points.join(' '), class: 'chart-ma' }));
    }

    if (!visibleItems.length) {
      const text = el('text', {
        x: pad.left + plotW / 2,
        y: pad.top + plotH / 2,
        'text-anchor': 'middle',
        class: 'chart-empty-text',
      });
      text.textContent = '当前窗口内没有记录';
      svg.append(text);
    }

    crosshair = el('line', {
      x1: 0, x2: 0, y1: pad.top, y2: pad.top + plotH, class: 'chart-crosshair',
    });
    svg.append(crosshair);

    svg.setAttribute('aria-label', `K 线图，${isoFromMs(start)} 至 ${isoFromMs(end)}，共 ${visibleItems.length} 条记录`);
    host.dataset.chartStart = isoFromMs(start);
    host.dataset.chartEnd = isoFromMs(end);
    host.dataset.chartVisible = String(visibleItems.length);

    if (!entered && options.animate !== false && !reduceMotion) {
      entered = true;
      stage.classList.add('is-entering');
      stage.addEventListener('animationend', () => stage.classList.remove('is-entering'), { once: true });
    }
  };

  const setWindow = (startMs, endMs, { commit = false } = {}) => {
    current = normalize(startMs, endMs);
    draw();
    if (commit) commitWindow();
  };

  let commitTimer = 0;
  const commitWindow = () => {
    clearTimeout(commitTimer);
    if (!lastCommitted) {
      lastCommitted = { ...current };
      options.onWindowCommit?.({ ...current });
      return;
    }
    if (Math.abs(lastCommitted.startMs - current.startMs) < 60000
      && Math.abs(lastCommitted.endMs - current.endMs) < 60000) return;
    lastCommitted = { ...current };
    options.onWindowCommit?.({ ...current });
  };
  const scheduleCommit = () => {
    clearTimeout(commitTimer);
    commitTimer = window.setTimeout(commitWindow, 260);
  };

  const zoomAt = (baseWindow, factor, clientX) => {
    const rect = stage.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left - dims.padLeft) / dims.plotW, 0, 1);
    const span = baseWindow.endMs - baseWindow.startMs;
    const newSpan = clamp(span * factor, MIN_SPAN, maxSpan);
    const anchor = baseWindow.startMs + ratio * span;
    setWindow(anchor - ratio * newSpan, anchor - ratio * newSpan + newSpan);
  };

  /* ---- 滚轮缩放 ---- */
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : 1;
    const delta = clamp(event.deltaY * unit, -160, 160);
    const factor = Math.exp(delta * 0.0025);
    zoomAt(current, factor, event.clientX);
    scheduleCommit();
  }, { passive: false });

  /* ---- 拖拽 / 双指缩放 ---- */
  const pointers = new Map();
  let gesture = null;

  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stage.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    hideTip();
    if (pointers.size === 1) {
      gesture = {
        type: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        moved: false,
        started: performance.now(),
      };
      stage.classList.add('is-dragging');
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = {
        type: 'pinch',
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        base: { ...current },
        anchorX: (a.x + b.x) / 2,
      };
    }
  });

  stage.addEventListener('pointermove', (event) => {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (gesture?.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      zoomAt(gesture.base, gesture.startDist / distance, gesture.anchorX);
      return;
    }
    if (gesture?.type === 'pan') {
      if (Math.abs(event.clientX - gesture.startX) > 3 || Math.abs(event.clientY - gesture.startY) > 3) {
        gesture.moved = true;
      }
      const dx = event.clientX - gesture.lastX;
      if (dx) {
        const span = current.endMs - current.startMs;
        const delta = -(dx / dims.plotW) * span;
        current = normalize(current.startMs + delta, current.endMs + delta);
        draw();
        gesture.lastX = event.clientX;
      }
      return;
    }
    if (event.pointerType !== 'touch') showTipAt(event.clientX);
  });

  const finishPointer = (event, cancelled) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      const finished = gesture;
      const wasTap = finished?.type === 'pan' && !finished.moved
        && performance.now() - finished.started < 350 && !cancelled && event.type === 'pointerup';
      gesture = null;
      stage.classList.remove('is-dragging');
      if (wasTap) showTipAt(event.clientX);
      if (finished?.moved || finished?.type === 'pinch') commitWindow();
    } else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      gesture = {
        type: 'pan',
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        moved: true,
        started: performance.now(),
      };
      stage.classList.add('is-dragging');
    }
  };

  stage.addEventListener('pointerup', (event) => finishPointer(event, false));
  stage.addEventListener('pointercancel', (event) => finishPointer(event, true));
  stage.addEventListener('pointerleave', () => { if (!pointers.size) hideTip(); });

  host._chartState = {
    redraw: draw,
    getWindow: () => ({ ...current }),
  };
  if (!observers.has(host)) {
    const ro = new ResizeObserver(() => {
      const state = host._chartState;
      if (!state || !host.isConnected) return;
      const width = Math.max(280, Math.round(host.clientWidth || 900));
      if (Math.abs(width - dims.hostWidth) < 8) return;
      state.redraw();
    });
    ro.observe(host);
    observers.set(host, ro);
  }

  draw();
}
