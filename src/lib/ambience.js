/* =========================================================
   ambience.js — 背景星场、显现动效、滚动状态与玻璃卡片倾斜
   所有动效都尊重 prefers-reduced-motion。
   ========================================================= */

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 确定性伪随机：同一台设备每次刷新星图一致，避免闪烁重排 */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initStarField() {
  const layer = document.getElementById('ambience-stars');
  if (!layer || layer.dataset.ready) return;
  layer.dataset.ready = 'true';

  const mobile = window.matchMedia?.('(max-width: 720px)').matches;
  const rand = makeRandom(20261028);
  const stars = Array.from({ length: mobile ? 16 : 30 }, () => {
    const size = 5 + rand() * 14;
    const peak = 0.16 + rand() * 0.3;
    return {
      type: 'star',
      x: rand() * 100,
      y: rand() * 100,
      size,
      dur: 7 + rand() * 13,
      delay: -rand() * 20,
      peak,
      floor: peak * (0.3 + rand() * 0.25),
      dx: (rand() * 2 - 1) * 4,
      dy: (rand() * 2 - 1) * 4,
      ddur: 40 + rand() * 55,
      ddelay: -rand() * 70,
    };
  });
  const dust = Array.from({ length: mobile ? 10 : 34 }, () => {
    const peak = 0.08 + rand() * 0.16;
    return {
      type: 'dust',
      x: rand() * 100,
      y: rand() * 100,
      size: 1 + rand() * 2,
      dur: 9 + rand() * 15,
      delay: -rand() * 24,
      peak,
      floor: peak * 0.4,
      dx: (rand() * 2 - 1) * 3,
      dy: (rand() * 2 - 1) * 3,
      ddur: 45 + rand() * 50,
      ddelay: -rand() * 60,
    };
  });

  const frag = document.createDocumentFragment();
  for (const p of [...stars, ...dust]) {
    const node = document.createElement('span');
    node.className = `amb-star ${p.type}`;
    node.style.cssText = [
      `--x:${p.x.toFixed(2)}%`,
      `--y:${p.y.toFixed(2)}%`,
      `--size:${p.size.toFixed(2)}px`,
      `--dur:${p.dur.toFixed(2)}s`,
      `--delay:${p.delay.toFixed(2)}s`,
      `--peak:${p.peak.toFixed(3)}`,
      `--floor:${p.floor.toFixed(3)}`,
      `--dx:${p.dx.toFixed(2)}px`,
      `--dy:${p.dy.toFixed(2)}px`,
      `--ddur:${p.ddur.toFixed(2)}s`,
      `--ddelay:${p.ddelay.toFixed(2)}s`,
    ].join(';');
    frag.append(node);
  }

  if (!mobile) {
    for (const s of [
      { x: 12, y: 18, delay: 6, dur: 24 },
      { x: 68, y: 9, delay: 17, dur: 31 },
    ]) {
      const node = document.createElement('span');
      node.className = 'amb-shooting';
      node.style.cssText = `--x:${s.x}vw;--y:${s.y}vh;--delay:${s.delay}s;--dur:${s.dur}s`;
      frag.append(node);
    }
  }

  layer.append(frag);
}

/** 首次进入视口时渐进显现；同一元素只触发一次 */
export function initReveal(root = document) {
  const items = root.querySelectorAll('.reveal:not(.is-in)');
  if (!items.length) return;
  if (reduceMotion() || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  items.forEach((item) => observer.observe(item));
}

export function initScrollState() {
  const update = () => {
    document.documentElement.classList.toggle('is-scrolled', window.scrollY > 6);
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
}

/** 玻璃卡片的轻微 3D 倾斜；触屏与减少动效环境直接跳过 */
export function initTilt() {
  if (reduceMotion() || !window.matchMedia?.('(pointer: fine)').matches) return;

  let active = null;
  let frame = 0;
  let lastEvent = null;

  const reset = (node) => {
    if (!node) return;
    node.style.setProperty('--rx', '0deg');
    node.style.setProperty('--ry', '0deg');
    node.style.setProperty('--mx', '50%');
    node.style.setProperty('--my', '40%');
  };

  const apply = () => {
    frame = 0;
    if (!active || !lastEvent) return;
    const rect = active.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = Math.min(1, Math.max(0, (lastEvent.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (lastEvent.clientY - rect.top) / rect.height));
    active.style.setProperty('--ry', `${((px - 0.5) * 3).toFixed(2)}deg`);
    active.style.setProperty('--rx', `${((0.5 - py) * 2.4).toFixed(2)}deg`);
    active.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    active.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  };

  document.addEventListener('pointermove', (event) => {
    const node = event.target.closest?.('[data-tilt]') ?? null;
    if (node !== active) {
      reset(active);
      active = node;
    }
    if (!active) return;
    lastEvent = event;
    if (!frame) frame = requestAnimationFrame(apply);
  }, { passive: true });

  const clear = () => {
    reset(active);
    active = null;
    lastEvent = null;
  };
  document.addEventListener('pointerleave', clear, { passive: true });
  window.addEventListener('scroll', clear, { passive: true });
}

export function refreshEnhancements(root) {
  initReveal(root);
}
