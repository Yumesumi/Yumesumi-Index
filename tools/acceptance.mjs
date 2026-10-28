/* 子路径部署验收：node tools/acceptance.mjs
   用 YSI_BASE=/Yumesumi-Index/ 构建到临时目录，并在 /Yumesumi-Index/ 子路径下
   用真实浏览器验证 HTML、CSS、字体、JSON、CNAME 与哈希路由。
   不影响 dist/ 与线上部署。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP = path.join(REPO, 'tools', '.tmp-acceptance');
const PORT = 8125;
const PREFIX = '/Yumesumi-Index';
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.YSI_CHROME
  || 'C:/Users/Yumesumi/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const records = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'records.json'), 'utf-8'));

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\n[构建子路径产物]');
fs.rmSync(TEMP, { recursive: true, force: true });
const build = spawnSync(
  process.execPath,
  [path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', TEMP],
  { cwd: REPO, env: { ...process.env, YSI_BASE: `${PREFIX}/` }, encoding: 'utf-8' },
);
if (build.status !== 0) {
  console.error(build.stdout);
  console.error(build.stderr);
  process.exit(1);
}
const builtIndex = fs.readFileSync(path.join(TEMP, 'index.html'), 'utf-8');
check('产物包含 CNAME', fs.existsSync(path.join(TEMP, 'CNAME')));
check('产物包含 data/records.json', fs.existsSync(path.join(TEMP, 'data', 'records.json')));
check('产物包含字体', fs.existsSync(path.join(TEMP, 'fonts', 'fonts.css')));
check('HTML 资源带子路径前缀', builtIndex.includes(`"${PREFIX}/assets/`), builtIndex.match(/src="[^"]+"/)?.[0]);
check('HTML 公共资源带子路径前缀', builtIndex.includes(`"${PREFIX}/brand/logo.svg"`));

const server = spawn(process.execPath, [
  path.join(REPO, 'tools', 'serve.mjs'), String(PORT), `--root=${TEMP}`, '--subpath',
], { cwd: REPO, stdio: 'ignore' });

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${BASE}${PREFIX}/`);
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

let browser = null;
try {
  check('子路径预览服务器启动', await waitForServer());

  const pw = await import('playwright-core');
  const { chromium } = pw.default ?? pw;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const failed = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('requestfailed', (req) => failed.push(`${req.url()} ${req.failure()?.errorText}`));
  page.on('response', (res) => { if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`); });

  console.log('\n[子路径页面]');
  await page.goto(`${BASE}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  check('页面标题正确', (await page.title()).includes('梦澄指数'));
  check('CSS 生效', await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(5, 5, 12)');
  check('MiSans 字体生效', (await page.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('MiSans'));
  check('JSON 正常加载', (await page.locator('#side-status-text').innerText()).includes(`${records.length} 条`));
  check('K 线正常绘制', (await page.locator('#overview-chart svg').count()) === 1);
  check('无 JS 错误', errors.length === 0, errors.join(' | '));
  check('无资源加载失败', failed.length === 0, failed.join(' | '));
  const cssHref = builtIndex.match(/href="([^"]+\.css)"/)?.[1];
  check('带哈希的 CSS 可访问', cssHref ? (await page.request.get(`${BASE}${cssHref}`)).ok() : false, cssHref);

  console.log('\n[子路径哈希路由]');
  await page.goto(`${BASE}${PREFIX}/#/history`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  check('直接刷新 #/history 正常', (await page.locator('#history-chart svg').count()) === 1);
  check('行情表渲染', (await page.locator('.data-table tbody tr').count()) > 0);

  console.log('\n[自定义域名文件]');
  const cname = await page.request.get(`${BASE}${PREFIX}/CNAME`);
  check('CNAME 可访问', cname.ok());
  check('CNAME 内容正确', (await cname.text()).trim() === 'index.yumesumi.cyou');
  const data = await page.request.get(`${BASE}${PREFIX}/data/records.json`);
  check('数据文件可访问', data.ok());
  const font = await page.request.get(`${BASE}${PREFIX}/fonts/fonts.css`);
  check('字体样式可访问', font.ok());
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.rmSync(TEMP, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) process.exit(1);
