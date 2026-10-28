/* 端到端页面验证：node tools/e2e.mjs
   自动启动 dist 预览服务器，使用 playwright-core + 本机 Chrome Headless Shell。
   可用 YSI_CHROME 指定浏览器，YSI_BASE 指定已运行的服务地址。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'tools', 'shots');
const PORT = 8123;
const BASE = process.env.YSI_BASE || `http://127.0.0.1:${PORT}`;
const CHROME = process.env.YSI_CHROME
  || 'C:/Users/Yumesumi/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';

fs.mkdirSync(OUT, { recursive: true });

const records = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'records.json'), 'utf-8'));
const last = records[records.length - 1];
const years = new Set(records.map((r) => r.date.slice(0, 4)));

const pw = await import('playwright-core');
const { chromium } = pw.default ?? pw;

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

async function waitForServer(url, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

let server = null;
if (!process.env.YSI_BASE) {
  server = spawn(process.execPath, [path.join(REPO, 'tools', 'serve.mjs'), String(PORT), '--dist'], {
    cwd: REPO,
    stdio: 'ignore',
  });
  const ready = await waitForServer(`${BASE}/`);
  if (!ready) {
    console.error('预览服务器启动失败');
    server.kill();
    process.exit(1);
  }
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

function watch(page) {
  const errors = [];
  const failed = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => failed.push(`${req.url()} ${req.failure()?.errorText}`));
  page.on('response', (res) => { if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`); });
  return { errors, failed };
}

async function goto(page, hash = '', { wait = 700 } = {}) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
}

/** 逐段滚动触发 IntersectionObserver，再回到顶部截完整页面 */
async function capture(page, file) {
  await page.evaluate(async () => {
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    const step = Math.max(300, Math.round(window.innerHeight * 0.7));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    window.scrollTo(0, 0);
    html.style.scrollBehavior = previous;
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
}

try {
  /* ================= 桌面 · 概览 ================= */
  console.log('\n[桌面 · 概览]');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const watchPage = watch(page);
  await goto(page);

  check('页面标题正确', (await page.title()).includes('梦澄指数'));
  check('Hero 当前点位与最新收盘一致', (await page.locator('.hero-value').innerText()).includes('12,000.00'));
  check('侧栏记录数与数据一致', (await page.locator('#side-status-text').innerText()).includes(`${records.length} 条`));
  check('顶栏返回主站按钮可见', await page.locator('.site-return').isVisible());
  check('返回主站地址正确', (await page.locator('.site-return').getAttribute('href')) === 'https://yumesumi.cyou/');
  check('侧栏返回主站按钮可见', await page.locator('.sidebar-return').isVisible());
  check('默认范围为 1 年', (await page.locator('.seg-btn[data-range="365"]').getAttribute('class')).includes('is-active'));
  check('K 线 SVG 已绘制', (await page.locator('#overview-chart svg').count()) === 1);
  check('K 线已渲染', (await page.locator('#overview-chart .candle-body').count()) > 0);
  check('MA7 已绘制', (await page.locator('#overview-chart .chart-ma').count()) === 1);
  check('Y 轴标签固定在图表左侧', (await page.locator('#overview-chart .chart-yaxis-label').count()) >= 3);
  check('MiSans 字体已加载', await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px MiSans');
  }));
  check('玻璃面板使用 backdrop-filter', await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.hero-panel'));
    return /blur/.test(style.backdropFilter || style.webkitBackdropFilter || '');
  }));
  check('桌面端无 JS 错误', watchPage.errors.length === 0, watchPage.errors.join(' | '));
  check('桌面端无资源加载失败', watchPage.failed.length === 0, watchPage.failed.join(' | '));
  await capture(page, 'desktop-overview.png');

  console.log('\n[概览 · 范围与指标]');
  await page.click('.seg-btn[data-range="all"]');
  await page.waitForTimeout(700);
  check('全部范围渲染完整记录', (await page.locator('#overview-chart .candle-body').count()) === records.length);
  check('全部范围可横向滚动', (await page.locator('#overview-chart .chart-shell.is-scrollable').count()) === 1);
  check('图表初始定位到最新一根', await page.evaluate(() => {
    const vp = document.querySelector('#overview-chart .chart-viewport');
    return vp.scrollLeft + vp.clientWidth >= vp.scrollWidth - 4;
  }));
  await page.locator('#overview-chart .candle-hit').last().hover({ force: true });
  await page.waitForTimeout(200);
  check('K 线悬停提示可见', await page.locator('#overview-chart .chart-tip').isVisible());
  check('悬停提示含 OHLC', (await page.locator('#overview-chart .chart-tip').innerText()).includes('开'));
  await page.mouse.move(0, 0);
  await page.click('.seg-btn[data-range="90"]');
  await page.waitForTimeout(500);
  check('90 天档位被选中', (await page.locator('.seg-btn[data-range="90"]').getAttribute('class')).includes('is-active'));
  const candles90 = await page.locator('#overview-chart .candle-body').count();
  check('90 天范围只保留近期记录', candles90 > 0 && candles90 < 30, String(candles90));
  await page.click('[data-action="toggle-ma"]');
  await page.waitForTimeout(400);
  check('关闭 MA7 后均线消失', (await page.locator('#overview-chart .chart-ma').count()) === 0);
  await page.click('[data-action="toggle-ma"]');
  await page.waitForTimeout(300);

  /* ================= 日记 ================= */
  console.log('\n[桌面 · 日记]');
  await goto(page, '#/journal');
  check('日记首屏分批渲染', (await page.locator('.entry').count()) === 24);
  check('搜索框铺满工具栏', await page.locator('.search-field').evaluate((el) => el.getBoundingClientRect().width > 500));
  check('年份归档完整', (await page.locator('.chip').count()) === years.size + 1,
    `${await page.locator('.chip').count()} / ${years.size + 1}`);
  await page.fill('#journal-search', '水下');
  await page.waitForTimeout(250);
  const waterEntries = await page.locator('.entry').count();
  check('全文搜索命中', waterEntries > 0, String(waterEntries));
  await page.fill('#journal-search', '');
  await page.waitForTimeout(200);
  await page.click('.chip[data-year="2026"]');
  await page.waitForTimeout(250);
  const yearDates = await page.locator('.entry-date time').allTextContents();
  check('年份筛选只显示 2026', yearDates.length > 0 && yearDates.every((d) => d.startsWith('2026')));
  const beforeMore = await page.locator('.entry').count();
  const moreBtn = page.locator('.load-more');
  if (await moreBtn.count()) {
    await moreBtn.first().click();
    await page.waitForTimeout(300);
  }
  check('加载更多增加条目', (await page.locator('.entry').count()) >= beforeMore);
  await page.click('.chip[data-year="all"]');
  await page.waitForTimeout(250);
  await page.locator('.entry-title button').first().click();
  await page.waitForTimeout(350);
  check('阅读弹窗打开', await page.locator('.modal-reading').isVisible());
  check('阅读弹窗含正文', (await page.locator('.journal-body').innerText()).length > 10);
  check('阅读弹窗含行情条', (await page.locator('.quote-strip b').count()) >= 4);
  const quoteText = await page.locator('.quote-strip').innerText();
  check('阅读弹窗行情指标已计算', quoteText.includes('日变化') && !/日变化\s*—/.test(quoteText), quoteText.replace(/\n/g, ' '));
  await page.screenshot({ path: path.join(OUT, 'desktop-journal-modal.png') });
  await page.locator('.modal-close').click();
  await page.waitForTimeout(250);
  await capture(page, 'desktop-journal.png');

  /* ================= 历史 ================= */
  console.log('\n[桌面 · 历史]');
  await goto(page, '#/history');
  await page.click('.seg-btn[data-range="all"]');
  await page.waitForTimeout(600);
  check('历史图表已绘制', (await page.locator('#history-chart svg').count()) === 1);
  check('行情表首屏 120 行', (await page.locator('.data-table tbody tr').count()) === 120,
    String(await page.locator('.data-table tbody tr').count()));
  const firstRow = await page.locator('.data-table tbody tr').first().locator('td').allTextContents();
  check('行情表首行是最新日期', firstRow[0].includes(last.date), firstRow[0]);
  check('行情表首行收盘正确', firstRow[4].replaceAll(',', '') === Number(last.ohlc.close).toFixed(2),
    `${firstRow[4]} / ${last.ohlc.close}`);
  await page.click('[data-action="load-more-history"]');
  await page.waitForTimeout(400);
  check('行情表加载更多', (await page.locator('.data-table tbody tr').count()) === 240);
  await capture(page, 'desktop-history.png');

  /* ================= 说明 + 导出 ================= */
  console.log('\n[桌面 · 说明与导出]');
  await goto(page, '#/methodology');
  check('说明页含基准规则', (await page.locator('.method-grid').innerText()).includes('基准点位'));
  check('说明页含发布流程', (await page.locator('.method-grid').innerText()).includes('GitHub Actions'));
  await page.click('.topbar [data-action="export-json"]');
  await page.waitForTimeout(300);
  check('导出弹窗打开', await page.locator('.modal').innerText().then((t) => t.includes('导出 JSON')));
  check('导出数量与合并记录一致', (await page.locator('.modal').innerText()).includes(`全部 ${records.length} 条记录`));
  await page.locator('.modal-close').click();

  /* ================= 新建 / 暂存 ================= */
  console.log('\n[桌面 · 新建与浏览器暂存]');
  await page.evaluate(() => localStorage.removeItem('ysi.pending.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.topbar [data-action="new"]');
  await page.waitForTimeout(300);
  await page.fill('#f-date', '2026-12-31');
  await page.fill('#f-title', '端到端测试记录');
  await page.fill('#f-body', '这是端到端测试正文。\n\n![logo](brand/logo.svg)');
  await page.fill('#f-open', '-12000');
  await page.fill('#f-high', '-12200');
  await page.fill('#f-low', '-12300');
  await page.fill('#f-close', '-12050');
  await page.click('[form="record-form"]');
  await page.waitForTimeout(300);
  check('非法 OHLC 被表单拒绝', await page.locator('#form-error').isVisible());
  await page.fill('#f-high', '-11900');
  await page.click('[form="record-form"]');
  await page.waitForTimeout(450);
  check('保存后出现暂存提示条', await page.locator('#pending-bar').isVisible());
  check('暂存提示强调未写入仓库', (await page.locator('#pending-bar').innerText()).includes('尚未写入仓库'));
  await goto(page, '#/journal');
  await page.fill('#journal-search', '端到端测试记录');
  await page.waitForTimeout(300);
  check('暂存记录出现在日记列表', (await page.locator('.entry').count()) === 1);
  check('暂存记录带待发布标记', (await page.locator('.entry .badge-warn').count()) === 1);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check('刷新后暂存仍存在', await page.locator('#pending-bar').isVisible());
  await page.evaluate(() => localStorage.removeItem('ysi.pending.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  /* ================= 封面 / 插图 ================= */
  console.log('\n[日记 · 封面与插图]');
  await page.evaluate(() => {
    localStorage.setItem('ysi.pending.v1', JSON.stringify({
      '2026-12-30': {
        mode: 'upsert',
        record: {
          date: '2026-12-30', title: '封面与插图测试', body: '正文第一段。\n\n![品牌标记](brand/logo.svg)', mood: '测试',
          energy: 5, tags: ['测试'], cover: 'brand/logo.svg',
          ohlc: { open: -12000, high: -11900, low: -12100, close: -12050 },
        },
      },
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.fill('#journal-search', '封面与插图测试');
  await page.waitForTimeout(350);
  check('列表渲染封面图', await page.locator('.entry-cover img').evaluate((img) => img.complete && img.naturalWidth > 0));
  await page.locator('.entry-title button').first().click();
  await page.waitForTimeout(400);
  check('阅读页渲染封面', await page.locator('.detail-cover img').evaluate((img) => img.complete && img.naturalWidth > 0));
  check('正文 Markdown 图片被渲染', await page.locator('.journal-body img').count() === 1);
  await page.locator('.modal-close').click();
  await page.evaluate(() => localStorage.removeItem('ysi.pending.v1'));

  /* ================= 空数据 ================= */
  console.log('\n[空数据状态]');
  const emptyPage = await context.newPage();
  const watchEmpty = watch(emptyPage);
  await emptyPage.route('**/data/records.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: '[]',
  }));
  await goto(emptyPage);
  check('空数据不崩溃', (await emptyPage.locator('.hero-value.is-empty').count()) === 1);
  check('空数据图表显示空状态', (await emptyPage.locator('.chart-empty').count()) === 1);
  check('空数据无假行情', (await emptyPage.locator('.hero-value').innerText()).trim() === '—');
  check('空数据无 JS 错误', watchEmpty.errors.length === 0, watchEmpty.errors.join(' | '));
  await emptyPage.close();

  /* ================= 移动端 ================= */
  console.log('\n[移动端 390×844]');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  const watchMobile = watch(mobile);
  await goto(mobile);
  check('移动端无横向溢出', await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await mobile.evaluate(() => `${document.documentElement.scrollWidth} / ${window.innerWidth}`));
  check('移动端菜单按钮可见', await mobile.locator('.menu-btn').isVisible());
  check('移动端指数概览可见', await mobile.locator('.hero-value').isVisible());
  await capture(mobile, 'mobile-overview.png');
  await mobile.click('.menu-btn');
  await mobile.waitForTimeout(300);
  check('移动端菜单打开', await mobile.locator('#mobile-nav').isVisible());
  check('移动端菜单返回主站按钮可见', await mobile.locator('.mobile-center-btn').isVisible());
  await mobile.click('.mobile-nav-link[data-nav="journal"]');
  await mobile.waitForTimeout(600);
  check('移动端菜单导航生效', (await mobile.locator('#page-title').innerText()) === '日记归档');
  check('移动端日记无横向溢出', await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await capture(mobile, 'mobile-journal.png');
  check('移动端无 JS 错误', watchMobile.errors.length === 0, watchMobile.errors.join(' | '));

  /* ================= 平板 ================= */
  console.log('\n[平板 834×1112]');
  const tabletContext = await browser.newContext({ viewport: { width: 834, height: 1112 }, deviceScaleFactor: 1 });
  const tablet = await tabletContext.newPage();
  const watchTablet = watch(tablet);
  await goto(tablet);
  check('平板无横向溢出', await tablet.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await tablet.evaluate(() => `${document.documentElement.scrollWidth} / ${window.innerWidth}`));
  check('平板使用移动端导航', await tablet.locator('.menu-btn').isVisible());
  check('平板 K 线正常绘制', (await tablet.locator('#overview-chart svg').count()) === 1);
  check('平板四张指标卡可见', (await tablet.locator('.stat').count()) === 4);
  check('平板无 JS 错误', watchTablet.errors.length === 0, watchTablet.errors.join(' | '));
  await capture(tablet, 'tablet-overview.png');

  /* ================= 减少动效 ================= */
  console.log('\n[prefers-reduced-motion]');
  const reduceContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const reducePage = await reduceContext.newPage();
  const watchReduce = watch(reducePage);
  await goto(reducePage);
  check('减少动效时内容直接可见', await reducePage.locator('.view-head').evaluate((el) => getComputedStyle(el).opacity === '1'));
  check('减少动效时星点静止', await reducePage.locator('.amb-star').first().evaluate((el) => getComputedStyle(el).animationName === 'none'));
  check('减少动效无 JS 错误', watchReduce.errors.length === 0, watchReduce.errors.join(' | '));

  /* ================= 站内资源 ================= */
  console.log('\n[资源与路由]');
  await goto(page, '#/history');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check('直接刷新哈希路由正常', (await page.locator('#history-chart svg').count()) === 1);
  const fontRes = await page.request.get(`${BASE}/fonts/fonts.css`);
  check('字体样式可访问', fontRes.ok());
  const dataRes = await page.request.get(`${BASE}/data/records.json`);
  check('数据文件可访问', dataRes.ok());
  const cnameRes = await page.request.get(`${BASE}/CNAME`);
  check('产物包含 CNAME', cnameRes.ok());

  await context.close();
  await mobileContext.close();
  await tabletContext.close();
  await reduceContext.close();
} finally {
  await browser.close();
  if (server) server.kill();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) process.exit(1);
