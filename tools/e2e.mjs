/* 端到端页面验证：node tools/e2e.mjs
   需要 playwright-core。若未安装在当前目录，可用环境变量指定：
     set PW_PATH=C:/path/to/playwright-core/index.js  (Windows)
   或先执行：npm i -D playwright-core                     */
// Windows 绝对路径需转成 file:// URL 才能被 ESM 加载
const pwPath = process.env.PW_PATH;
const pw = await import(pwPath ? `file:///${pwPath.replace(/\\/g, '/')}` : 'playwright-core');
const { chromium } = pw.default ?? pw;
const BASE = process.env.YSI_BASE || 'http://127.0.0.1:8099';
const OUT = 'C:/Users/Yumesumi/CodeProjects/Yumesumi-Index/tools/shots';
const CHROME = process.env.YSI_CHROME
  || 'C:/Users/Yumesumi/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} ${extra}`); }
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

console.log('\n[空数据状态]');
// 用路由拦截模拟空数据，让本段断言与仓库当前是否有数据无关
await page.route('**/data/records.json', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: '[]',
}));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('页面标题正确', (await page.title()).includes('Yumesumi Index'));
check('无 JS 报错', errors.length === 0, errors.join(' | '));
check('显示空状态而非假行情', (await page.locator('.empty').count()) > 0);
const emptyStat = await page.locator('.stat-value').first().textContent();
check('空状态指数显示为 —', emptyStat.trim() === '—', `实际="${emptyStat}"`);
check('图表区域提示无数据', (await page.locator('#overview-chart .empty').count()) === 1);
check('侧栏显示 0 条正式记录', (await page.locator('#side-status-text').textContent()).includes('0 条'));
await page.screenshot({ path: `${OUT}/01-empty-overview.png`, fullPage: true });
// 解除拦截，后续测试使用仓库真实数据
await page.unroute('**/data/records.json');

console.log('\n[写入演示数据]');
const sample = await page.evaluate(async () => {
  const res = await fetch('./samples/records.sample.json');
  return res.json();
});
// 直接落到仓库数据文件，模拟"用户已有真实记录"的状态
await page.evaluate(async (records) => {
  const res = await fetch('./data/records.json');
  const cur = await res.json();
  const merged = [...cur, ...records];
  // 用示例文件里的 records 数组
}, sample.records);

console.log('\n[加载演示数据后]');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('无 JS 报错（有数据时）', errors.length === 0, errors.join(' | '));
// 侧栏条数应与仓库数据文件的实际条数一致（不写死数字）
const repoCount = await page.evaluate(async () => {
  const res = await fetch('./data/records.json');
  return (await res.json()).length;
});
const sidebarText = await page.locator('#side-status-text').textContent();
check('侧栏条数与仓库数据一致', sidebarText.includes(`${repoCount} 条`), `仓库=${repoCount} 侧栏="${sidebarText}"`);

// 后续各段都依赖这些日期：仓库已有日期 + 本次导入的日期
const repoDates = await page.evaluate(async () => {
  const res = await fetch('./data/records.json');
  return (await res.json()).map((r) => r.date);
});
const importedDates = [...sample.records.map((r) => r.date), '2026-12-01', '2026-12-02'];
const uniqueDateCount = new Set([...repoDates, ...importedDates]).size;

console.log('\n[通过导入功能载入演示数据]');
await page.goto(`${BASE}/#/methodology`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.click('[data-action="import-json"]');
await page.waitForTimeout(500);
check('弹出导入对话框', (await page.locator('.modal-head h2').textContent()).includes('导入 JSON'));
check('导入说明强调不覆盖现有数据', (await page.locator('.modal').textContent()).includes('现有数据不会被动到'));
await page.setInputFiles('#import-pick', {
  name: 'records.sample.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(sample.records), 'utf-8'),
});
await page.waitForTimeout(800);
check('弹出导入确认框', (await page.locator('.modal-head h2').textContent()).includes('导入确认'));
check('导入确认说明含"暂存区"', (await page.locator('.modal').textContent()).includes('暂存区'));
await page.click('#do-import');
await page.waitForTimeout(600);
check('导入后出现待发布提示条', (await page.locator('#pending-bar').isVisible()));
const barText = await page.locator('#pending-bar').textContent();
check('提示条明确说明未写入仓库', barText.includes('尚未写入仓库'), barText);
check('提示条区分 git commit', barText.includes('git commit'), barText);

console.log('\n[概览页数据渲染]');
await page.goto(`${BASE}/#/overview`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const idxVal = await page.locator('.stat-value.lg').first().textContent();
check('当前指数渲染为数值', /\d/.test(idxVal), `实际="${idxVal}"`);
check('K线图已绘制 SVG', (await page.locator('#overview-chart svg').count()) === 1);
const candleCount = await page.locator('#overview-chart rect').count();
check('绘制出 K 线实体', candleCount > 0, `rect 数量=${candleCount}`);
check('基准参考线存在', (await page.locator('#overview-chart line[stroke="#B8A77A"]').count()) >= 1);
check('最近日记显示条目', (await page.locator('.entry').count()) >= 3);
await page.screenshot({ path: `${OUT}/02-overview-with-data.png`, fullPage: true });

console.log('\n[负数点位：图表与指标渲染]');
{
  // 导入一份含负数点位的记录，验证站点能正确渲染与计算
  const negRecords = [
    {
      date: '2026-12-01', title: '负数点位测试', body: '正文', mood: '测试', energy: 5, tags: [],
      ohlc: { open: 1000, high: 1000, low: -200, close: -200 },
    },
    {
      date: '2026-12-02', title: '负数区间上涨', body: '正文', mood: '测试', energy: 5, tags: [],
      ohlc: { open: -200, high: -100, low: -250, close: -100 },
    },
  ];
  await page.goto(`${BASE}/#/methodology`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('[data-action="import-json"]');
  await page.waitForTimeout(500);
  await page.setInputFiles('#import-pick', {
    name: 'negative.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(negRecords), 'utf-8'),
  });
  await page.waitForTimeout(800);
  await page.click('#do-import');
  await page.waitForTimeout(600);

  await page.goto(`${BASE}/#/overview`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  check('负数场景无 JS 报错', errors.length === 0, errors.join(' | '));

  // 最新一条收盘 -100，应显示为负数
  const negIdx = await page.locator('.stat-value.lg').first().textContent();
  check('首页指数显示负数', negIdx.includes('-') || negIdx.includes('−'), `实际="${negIdx.trim()}"`);

  // K 线数量 = 去重后的总记录数（同日期只算一根）
  const negCandles = await page.evaluate(() => [...document.querySelectorAll('#overview-chart rect')]
    .filter((r) => r.getAttribute('fill') !== 'transparent').length);
  const uniqueDates = uniqueDateCount;
  check('负数场景 K 线数量正确', negCandles === uniqueDates, `期望=${uniqueDates} 实际=${negCandles}`);

  // 坐标轴刻度应包含 0（负数区间）
  const axisTexts = await page.locator('#overview-chart text').allTextContents();
  check('坐标轴包含 0 刻度', axisTexts.some((t) => t.trim() === '0'), axisTexts.join(','));

  // Y 轴不应出现 NaN / Infinity
  check('坐标轴无 NaN/Infinity', !axisTexts.some((t) => /NaN|Infinity/i.test(t)), axisTexts.join(','));

  // 基准线仍应可见
  check('负数场景基准线仍存在', (await page.locator('#overview-chart line[stroke="#B8A77A"]').count()) >= 1);

  // 负数区间上涨的记录，涨跌幅应为正（在日记页查看条目）
  await page.goto(`${BASE}/#/journal`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const negPctCells = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#journal-list .entry')];
    const target = rows.find((r) => r.textContent.includes('负数区间上涨'));
    if (!target) return null;
    const m = target.textContent.match(/([+−-][\d.,]+)\s*\(([+−-][\d.,]+)%\)/);
    return m ? { change: m[1], pct: m[2] } : null;
  });
  check('负数区间上涨显示为正涨跌幅', negPctCells !== null && negPctCells.pct.startsWith('+'),
    JSON.stringify(negPctCells));

  await page.goto(`${BASE}/#/overview`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/11-negative-values.png`, fullPage: true });
}

console.log('\n[历史页与表格]');
await page.goto(`${BASE}/#/history`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const rows = await page.locator('table.data tbody tr').count();
// 表格行数 = 仓库条数 + 导入的 5 条演示 + 2 条负数，但同日期是「更新」而非新增
const expectedRows = uniqueDateCount;
check('行情表行数与数据总量一致', rows === expectedRows, `期望=${expectedRows} 实际=${rows}`);
const headers = await page.locator('table.data thead th').allTextContents();
check('表头包含日期/开盘/最高/最低/收盘/日变化',
  ['日期', '开盘', '最高', '最低', '收盘', '日变化'].every((h) => headers.includes(h)),
  headers.join('|'));
check('历史页也有 K 线', (await page.locator('#history-chart svg').count()) === 1);
await page.screenshot({ path: `${OUT}/03-history.png`, fullPage: true });

console.log('\n[日记页搜索]');
await page.goto(`${BASE}/#/journal`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const allEntries = await page.locator('.entry').count();
await page.fill('#journal-search', '回落');
await page.waitForTimeout(400);
const filtered = await page.locator('.entry').count();
check('搜索后条目数减少', filtered < allEntries && filtered > 0, `全部=${allEntries} 过滤后=${filtered}`);
check('搜索输入框保持焦点', await page.evaluate(() => document.activeElement?.id === 'journal-search'));
await page.fill('#journal-search', '不存在的关键词xyz');
await page.waitForTimeout(400);
check('无结果时显示空状态', (await page.locator('#journal-list .empty').count()) === 1);
await page.fill('#journal-search', '');
await page.waitForTimeout(400);
check('清空搜索后恢复', (await page.locator('.entry').count()) === allEntries);
await page.screenshot({ path: `${OUT}/04-journal.png`, fullPage: true });

console.log('\n[表单校验]');
await page.click('[data-action="new"]');
await page.waitForTimeout(500);
check('弹出编辑框', (await page.locator('#record-form').count()) === 1);
const btnText = await page.locator('#record-form button[type=submit]').textContent();
check('提交按钮不叫"提交到Git"', !btnText.includes('Git'), `实际="${btnText}"`);
check('提交按钮明确为浏览器暂存区', btnText.includes('浏览器暂存区'), `实际="${btnText}"`);
const modalText = await page.locator('.modal').textContent();
check('表单内说明不会写入仓库', modalText.includes('不会') && modalText.includes('GitHub'));
// 构造非法 OHLC：最高价低于收盘价
await page.fill('#f-date', '2026-11-01');
await page.fill('#f-title', '测试记录');
await page.fill('#f-body', '这是正文');
await page.fill('#f-open', '1000');
await page.fill('#f-high', '1010');
await page.fill('#f-low', '990');
await page.fill('#f-close', '1020');
await page.dispatchEvent('#f-close', 'input');
await page.waitForTimeout(300);
await page.click('#record-form button[type=submit]');
await page.waitForTimeout(400);
check('非法 OHLC 被拒绝', (await page.locator('#form-error').isVisible()));
const errText = await page.locator('#form-error').textContent();
check('错误提示提到最高价', errText.includes('最高价'), errText);
check('错误提示提到收盘价', errText.includes('收盘价'), errText);
await page.screenshot({ path: `${OUT}/05-form-validation.png` });

console.log('\n[合法保存]');
await page.fill('#f-high', '1030');
await page.dispatchEvent('#f-high', 'input');
await page.waitForTimeout(200);
await page.click('#record-form button[type=submit]');
await page.waitForTimeout(600);
check('保存后弹窗关闭', (await page.locator('#record-form').count()) === 0);
check('出现 toast 提示', (await page.locator('#toast').isVisible()));
const toastText = await page.locator('#toast').textContent();
check('toast 明确未写入仓库', toastText.includes('未写入仓库'), toastText);

console.log('\n[同日期更新而非重复]');
await page.goto(`${BASE}/#/journal`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const beforeCount = await page.locator('.entry').count();
await page.click('[data-action="new"]');
await page.waitForTimeout(400);
await page.fill('#f-date', '2026-11-01');
await page.dispatchEvent('#f-date', 'change');
await page.waitForTimeout(300);
const hint = await page.locator('#date-hint').textContent();
check('提示该日期已有记录将更新', hint.includes('已有记录'), hint);
await page.fill('#f-title', '测试记录（改）');
await page.fill('#f-body', '这是正文');
await page.fill('#f-open', '1000');
await page.fill('#f-high', '1030');
await page.fill('#f-low', '990');
await page.fill('#f-close', '1020');
await page.dispatchEvent('#f-close', 'input');
await page.waitForTimeout(200);
await page.click('#record-form button[type=submit]');
await page.waitForTimeout(600);
await page.goto(`${BASE}/#/journal`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const afterCount = await page.locator('.entry').count();
check('同日期更新后条目数不变', afterCount === beforeCount, `之前=${beforeCount} 之后=${afterCount}`);
// 按日期定位目标条目，不依赖排序位置
const updatedTitle = await page.evaluate(() => {
  const entry = [...document.querySelectorAll('.entry')]
    .find((e) => e.querySelector('.entry-date')?.textContent.includes('2026-11-01'));
  return entry?.querySelector('.entry-title')?.textContent || '';
});
check('标题已更新', updatedTitle.includes('改'), `实际="${updatedTitle}"`);

console.log('\n[导出对话框]');
await page.click('[data-action="export-json"]');
await page.waitForTimeout(500);
check('导出对话框打开', (await page.locator('.modal-head h2').textContent()).includes('导出 JSON'));
const exportText = await page.locator('.modal').textContent();
check('导出说明含 git commit', exportText.includes('git commit'));
check('导出说明强调网页不会提交', exportText.includes('网页不会替你提交'));
await page.click('#do-export-json');
await page.waitForTimeout(500);
const dl = await page.evaluate(() => document.querySelector('#toast')?.textContent || '');
check('导出后提示下一步 git 操作', dl.includes('git commit'), dl);

console.log('\n[CSV 导出]');
const csv = await page.evaluate(async () => {
  // 直接调用模块逻辑验证 CSV 内容
  const mod = await import('./assets/js/data.js');
  return mod.toCSV([
    { date: '2026-10-20', title: '含"引号",逗号', body: 'b', mood: '平静', energy: 6, tags: ['x'],
      ohlc: { open: 1000, high: 1010, low: 990, close: 1005 } },
  ], 1000);
});
check('CSV 含 BOM', csv.charCodeAt(0) === 0xFEFF);
check('CSV 转义引号与逗号', csv.includes('"含""引号"",逗号"'), csv.slice(0, 200));

console.log('\n[响应式]');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/#/overview`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const navScroll = await page.evaluate(() => {
  const nav = document.querySelector('.nav');
  return { overflow: getComputedStyle(nav).overflowX, flexDir: getComputedStyle(document.querySelector('.app')).flexDirection };
});
check('移动端导航横向滚动', navScroll.overflow === 'auto', JSON.stringify(navScroll));
check('移动端纵向布局', navScroll.flexDir === 'column');
const svgWidth = await page.evaluate(() => {
  const s = document.querySelector('#overview-chart svg');
  return s ? s.getBoundingClientRect().width : 0;
});
const bodyWidth = await page.evaluate(() => document.body.getBoundingClientRect().width);
check('图表不超出屏幕宽度', svgWidth <= bodyWidth + 2, `svg=${svgWidth} body=${bodyWidth}`);
check('无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2));
await page.screenshot({ path: `${OUT}/06-mobile-overview.png`, fullPage: true });

await page.goto(`${BASE}/#/history`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('移动端表格横向滚动', await page.evaluate(() => {
  const w = document.querySelector('.table-wrap');
  return w ? getComputedStyle(w).overflowX === 'auto' : false;
}));
await page.screenshot({ path: `${OUT}/07-mobile-history.png`, fullPage: true });

console.log('\n[说明页]');
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/#/methodology`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const prose = await page.locator('.prose').textContent();
check('说明页含基准点位', prose.includes('基准点位'));
check('说明页区分网页保存与 Git 提交', prose.includes('Git 提交'));
check('说明页含隐私提醒', prose.includes('隐私'));
check('说明页声明非金融资产', prose.includes('不是金融资产'));
check('说明页有导入按钮', (await page.locator('[data-action="import-json"]').count()) === 1);
await page.screenshot({ path: `${OUT}/08-methodology.png`, fullPage: true });

console.log(`\n最终：${pass} 通过，${fail} 失败`);
if (errors.length) console.log('控制台错误:', errors.join('\n'));
await browser.close();
process.exit(fail ? 1 : 0);
