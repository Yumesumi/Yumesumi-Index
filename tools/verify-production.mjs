/* 线上部署验收：node tools/verify-production.mjs
   默认检查 https://index.yumesumi.cyou/，可用 YSI_PRODUCTION_URL 覆盖。
   使用真实浏览器验证线上 HTML、资源、字体、数据、图表、返回主站按钮与移动端菜单。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'tools', 'shots');
const URL_BASE = process.env.YSI_PRODUCTION_URL || 'https://index.yumesumi.cyou/';
const CHROME = process.env.YSI_CHROME
  || 'C:/Users/Yumesumi/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};

fs.mkdirSync(OUT, { recursive: true });
const cacheBust = `?v=${Date.now()}`;
const liveUrl = new URL(URL_BASE);
const pageUrl = `${liveUrl.origin}${liveUrl.pathname}${cacheBust}`;

async function fetchRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  throw lastError;
}

console.log(`\n[线上静态资源] ${liveUrl.origin}`);
const htmlRes = await fetchRetry(pageUrl, { headers: { 'cache-control': 'no-cache' } });
const html = await htmlRes.text();
check('HTML 返回 200', htmlRes.ok, String(htmlRes.status));
check('HTML 为新构建入口', /\/assets\/[^"]+\.js/.test(html) && !html.includes('/src/main.js'));
check('HTML 含返回主站按钮', html.includes('返回主站'));
check('HTML 含环境星场', html.includes('id="ambience-stars"'));

const records = await (await fetchRetry(`${liveUrl.origin}/data/records.json${cacheBust}`, { headers: { 'cache-control': 'no-cache' } })).json();
check('线上数据可读取', Array.isArray(records) && records.length > 0, String(records.length));
const cname = await (await fetchRetry(`${liveUrl.origin}/CNAME${cacheBust}`)).text();
check('线上 CNAME 正确', cname.trim() === 'index.yumesumi.cyou', cname.trim());

const httpUrl = `http://${liveUrl.host}/`;
const httpRes = await fetchRetry(httpUrl, { redirect: 'manual' });
check('HTTP 跳转到 HTTPS', [301, 302, 307, 308].includes(httpRes.status) && (httpRes.headers.get('location') || '').startsWith('https://'), `${httpRes.status} ${httpRes.headers.get('location')}`);

const pw = await import('playwright-core');
const { chromium } = pw.default ?? pw;
const proxy = process.env.YSI_PROXY || process.env.HTTPS_PROXY;
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', ...(proxy ? [`--proxy-server=${proxy}`] : [])],
});
const errors = [];
const failed = [];

try {
  console.log('\n[桌面线上页面]');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('requestfailed', (req) => failed.push(`${req.url()} ${req.failure()?.errorText}`));
  page.on('response', (res) => { if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`); });

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#overview-chart .chart-stage', { timeout: 30000 });
  await page.waitForTimeout(900);
  check('页面标题正确', (await page.title()).includes('梦澄指数'));
  check('最新点位已渲染', (await page.locator('.hero-value').innerText()).includes(Number(records.at(-1).ohlc.close).toLocaleString('zh-CN', { minimumFractionDigits: 2 })));
  check('记录数与线上数据一致', (await page.locator('#side-status-text').innerText()).includes(`${records.length} 条`));
  check('K 线已绘制', (await page.locator('#overview-chart .candle-body').count()) > 0);
  check('MiSans 已加载', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px MiSans'); }));
  check('返回主站按钮可用', (await page.locator('.site-return').getAttribute('href')) === 'https://yumesumi.cyou/');
  const liveChart = page.locator('#overview-chart');
  await liveChart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const liveStage = await page.locator('#overview-chart .chart-stage').boundingBox();
  await page.mouse.move(liveStage.x + liveStage.width - 30, liveStage.y + liveStage.height / 2);
  await page.waitForTimeout(200);
  check('图表悬停提示正常', await page.locator('#overview-chart .chart-tip').isVisible());
  await page.evaluate(() => { window.__liveHero = document.querySelector('.hero-panel'); });
  const spanBefore = Date.parse(await liveChart.getAttribute('data-chart-end')) - Date.parse(await liveChart.getAttribute('data-chart-start'));
  await page.mouse.move(liveStage.x + liveStage.width / 2, liveStage.y + liveStage.height / 2);
  await page.mouse.wheel(0, -320);
  await page.waitForTimeout(700);
  const spanAfter = Date.parse(await liveChart.getAttribute('data-chart-end')) - Date.parse(await liveChart.getAttribute('data-chart-start'));
  check('线上图表支持滚轮缩放', spanAfter < spanBefore, `${spanAfter / 86400000}d / ${spanBefore / 86400000}d`);
  check('线上缩放切换为自定义窗口', (await page.locator('.seg-btn.is-active').innerText()).includes('自定义'));
  check('线上缩放不会重建整页', await page.evaluate(() => window.__liveHero?.isConnected && window.__liveHero === document.querySelector('.hero-panel')));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  check('桌面端无 JS 错误', errors.length === 0, errors.join(' | '));
  check('桌面端无资源 404', failed.length === 0, failed.join(' | '));
  await page.screenshot({ path: path.join(OUT, 'production-desktop.png') });

  console.log('\n[移动端线上页面]');
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mobile = await mobileContext.newPage();
  const mobileErrors = [];
  mobile.on('pageerror', (err) => mobileErrors.push(err.message));
  mobile.on('console', (msg) => { if (msg.type() === 'error') mobileErrors.push(msg.text()); });
  await mobile.goto(`${pageUrl}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mobile.waitForSelector('.hero-value', { timeout: 30000 });
  await mobile.waitForTimeout(700);
  check('移动端无横向溢出', await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await mobile.click('.menu-btn');
  await mobile.waitForTimeout(300);
  check('移动端菜单打开', await mobile.locator('#mobile-nav').isVisible());
  check('菜单焦点停留在菜单内', await mobile.evaluate(() => document.querySelector('#mobile-nav').contains(document.activeElement)));
  await mobile.keyboard.press('Shift+Tab');
  check('Shift+Tab 焦点循环仍留在菜单内', await mobile.evaluate(() => document.querySelector('#mobile-nav').contains(document.activeElement)));
  await mobile.keyboard.press('Escape');
  await mobile.waitForTimeout(350);
  check('Esc 关闭移动端菜单', await mobile.locator('#mobile-nav').isHidden());
  check('移动端无 JS 错误', mobileErrors.length === 0, mobileErrors.join(' | '));
  await mobile.screenshot({ path: path.join(OUT, 'production-mobile.png') });

  console.log('\n[线上哈希路由]');
  await page.goto(`${pageUrl}/#/history`.replace(`${cacheBust}/`, `${cacheBust}`), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#history-chart .chart-stage', { timeout: 30000 });
  await page.waitForTimeout(700);
  check('直接访问 #/history 正常', (await page.locator('#history-chart svg').count()) === 1);
  check('行情表有数据', (await page.locator('.data-table tbody tr').count()) > 0);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) process.exit(1);
