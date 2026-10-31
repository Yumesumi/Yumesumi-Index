# 梦澄指数 · Yumesumi Index

> A Journal, Expressed as an Index.
> 用指数表达日记，用记录留住时间。

一个部署在 GitHub Pages 上的个人静态网站。以日记和主观感受为内核，用模拟股票指数的视觉语言呈现——每日点位、涨跌、日 K 线与历史记录。

它不是一个真实的金融市场。点位只代表记录本身。

- 线上站点：<https://index.yumesumi.cyou/>
- 品牌主站：<https://yumesumi.cyou/>
- 本仓库：<https://github.com/Yumesumi/Yumesumi-Index>

---

## 快速开始

```bash
npm ci            # 安装构建期依赖（Vite、playwright-core）
npm run dev       # 本地开发服务器 http://127.0.0.1:8099/
npm run build     # 构建 dist/，并自动检查源数据与产物
npm run preview   # 在 8099 端口预览 dist/
```

站点使用 ES Modules 与 `fetch` 读取 JSON，**不能直接双击打开 `index.html`**。请使用 `npm run dev` 或 `npm run preview`。

运行时没有任何第三方依赖：HTML、CSS、原生 SVG、ES Modules。Vite 只负责打包、压缩与资源路径处理。

---

## 架构

```text
/
├── index.html                  # 静态外壳：环境层、侧栏、顶栏、移动端菜单
├── src/
│   ├── main.js                 # 入口：样式 + app
│   ├── app.js                  # 状态、hash 路由、模态框、编辑与导入导出
│   ├── lib/
│   │   ├── data.js             # 数据加载、校验、指标计算、CSV/JSON 序列化
│   │   ├── chart.js            # 原生 SVG 盘面（日期时间轴、缩放拖拽、MA7）
│   │   ├── richtext.js         # 日记正文的安全 Markdown 子集
│   │   ├── selectors.js        # 范围筛选、搜索、年份归档
│   │   └── ambience.js         # 星场、显现动效、滚动状态、玻璃倾斜
│   ├── components/
│   │   ├── layout.js           # 导航、标题、状态、暂存提示
│   │   ├── ui.js               # 模态框、Toast、下载、空状态
│   │   ├── entry-card.js       # 日记卡片与行情条
│   │   └── icons.js            # 内联 SVG 图标
│   ├── views/                  # overview / journal / history / methodology
│   └── styles/
│       ├── tokens.css          # 设计令牌（唯一来源）
│       ├── base.css            # reset、排版、焦点、骨架
│       ├── layout.css          # 环境层、侧栏、顶栏、移动端
│       ├── components.css      # 玻璃、按钮、表单、图表、表格
│       ├── views.css           # 四个视图的版式
│       └── motion.css          # 关键帧与减少动效
├── public/
│   ├── brand/logo.svg          # 与梦澄中心一致的品牌标记
│   ├── fonts/                  # MiSans 分片（woff2 + unicode-range）
│   └── images/journal/         # 日记封面与插图
├── data/
│   ├── index.json              # 指数元信息
│   └── records.json            # 正式记录（站点唯一数据源）
├── journal/                    # 日记源文件（人写）
├── tools/                      # 本地工具与校验脚本
├── CNAME                       # index.yumesumi.cyou
├── vite.config.js
├── package.json / package-lock.json
└── .github/workflows/deploy.yml
```

### 设计体系

与梦澄中心共用一套视觉语言：

- 近黑紫背景、低饱和薰衣草紫重点色、细描边、克制的环境光。
- MiSans 字体，按 unicode-range 分片加载；拉丁分片预加载。
- 玻璃材质分三级：主要面板（`glass`）、次级卡片（`glass-soft`）、数据面板（`panel-data`，提高不透明度保证图表可读性）。
- 动效只使用 `transform` / `opacity`；支持 `prefers-reduced-motion`；移动端关闭次级卡片的 `backdrop-filter`，减少合成开销。
- 所有颜色、字体、间距、圆角、阴影、动效参数集中在 `src/styles/tokens.css`。

K 线图使用原生 SVG，无图表库：

- 时间轴按真实记录日期排布，缺失日期会留出时间间隔，但不补造 K 线。
- 时间窗口锚定最后一条记录，提供 7 天 / 30 天 / 90 天 / 180 天 / 1 年 / 3 年 / 成立来。
- 桌面端滚轮缩放，移动端双指缩放；鼠标左键或单指拖拽平移。窗口变化后会显示「自定义」。
- Y 轴固定在左侧；纵轴跟随当前可视窗口自适应，基准线落在范围外时用边缘提示标注。
- MA7 基于全部真实记录计算，窗口边缘保持连续。
- 预设窗口、缩放 / 平移与 MA 切换都只更新盘面相关局部，不重建 Hero 或其他页面模块。

---

## 部署（GitHub Actions）

`main` 分支的推送会触发 `.github/workflows/deploy.yml`：

1. 检出代码，按 `.nvmrc` 安装 Node 22，使用 npm 缓存。
2. `npm ci` 安装锁定依赖。
3. `npm run check`：数据校验、日记同步校验、正文渲染校验、源数据检查。
4. `npm run build`：Vite 构建 `dist/`，`postbuild` 再次检查产物完整性。
5. 上传 `dist/` 为 Pages artifact。
6. 部署到 GitHub Pages。

构建或任一步校验失败时，不会上传 artifact，也不会发布新版本。并发组为 `pages`，生产发布不会被后续推送打断。

> 域名经 Cloudflare 代理时，HTML 默认缓存 10 分钟（`max-age=600`）。发布后若仍看到旧版本，purge Cloudflare 缓存或等待缓存过期。资源文件名带内容哈希，新版本上线后旧缓存不会指向不存在的脚本。

### 仓库设置

GitHub 仓库 **Settings → Pages** 中：

- **Source** 选择 **GitHub Actions**。
- Custom domain 保持 `index.yumesumi.cyou`。
- 域名 DNS / Cloudflare 配置保持不变。

仓库根目录的 `CNAME` 会被 Vite 复制进 `dist/`，确保发布产物仍带自定义域名。`https_enforced` 与证书由 GitHub Pages 管理，不要通过构建脚本覆盖。

### 自定义域名与子路径

站点部署在自定义域名根路径，`base` 为 `/`，资源与数据都从根路径加载。

如需临时部署到 `https://<user>.github.io/<repo>/`：

```bash
YSI_BASE=/Yumesumi-Index/ npm run build
```

Vite 会给 JS/CSS/字体/图片加上子路径前缀，`data.js` 通过 `import.meta.env.BASE_URL` 读取数据。`tools/acceptance.mjs` 会自动构建子路径产物并在浏览器中验证。正式发布仍建议使用自定义域名根路径。

---

## 数据规则

### `data/index.json`

```json
{
  "name": "Yumesumi Index",
  "name_zh": "梦澄指数",
  "symbol": "YSI",
  "base_value": 0,
  "base_date": "2017-11-11",
  "frequency": "weekly",
  "data_mode": "manual"
}
```

基准点位为 `0`：累计百分比没有可比基数，页面显示「—」；累计涨跌额仍然准确。

### `data/records.json`

按日期升序的数组，每个日期最多一条记录：

```json
[
  {
    "date": "2026-10-27",
    "title": "不急着给今天下结论",
    "body": "在这里写入当天真实的日记。",
    "mood": "平静 · 认真",
    "energy": 7,
    "tags": ["生活", "自我观察"],
    "cover": "images/journal/2026-10-27.webp",
    "ohlc": { "open": 1074.06, "high": 1088.20, "low": 1072.50, "close": 1086.42 }
  }
]
```

`cover` 可选；没有封面时不写这个字段。数值必须是 JSON 数字。日期使用 `YYYY-MM-DD`。

### 指数规则

```text
日涨跌额  = 当日收盘价 − 上一条有效记录的收盘价
日涨跌幅  = 日涨跌额 ÷ |上一条有效记录收盘价| × 100%
累计变化  = 最新收盘价 − 0（基准为 0，累计百分比无意义，不显示）
```

- 第一条记录以基准点位作为比较对象。
- 相邻记录可以相隔数天；中间没有记录的日期不会生成 K 线。
- 点位可以是负数；涨跌幅分母取前收绝对值，保证符号与涨跌额一致。前收为 0 时涨跌幅显示「—」。
- OHLC 必须满足 `high >= open`、`high >= close`、`low <= open`、`low <= close`，否则拒绝保存。

---

## 写日记与发布

`journal/` 是写作源目录，每篇日记一个 `YYYY-MM-DD.md` 文件。

```bash
node tools/journal.mjs new      # 新建模板（默认今天，可传日期）
node tools/journal.mjs check    # 校验全部日记并对比 records.json
node tools/journal.mjs sync     # 只合并进 data/records.json
node tools/journal.mjs commit   # 合并 + git commit + push（带代理回退）
```

写完日记后也可以直接说「提交今天的日记」，由 `ysi-journal-commit` skill 代劳。

### 文件格式

```markdown
---
title: 不急着给今天下结论
mood: 平静 · 认真
energy: 7
tags: 生活, 自我观察
cover: images/journal/2026-10-27.webp
open: 1074.06
high: 1088.20
low: 1072.50
close: 1086.42
---

正文支持一个收窄的 Markdown 子集。

## 小标题

> 引用、列表、链接、**粗体**、`行内代码` 都可以。

![傍晚的天空](images/journal/2026-10-27-sky.webp)
```

`title`、`close` 与正文必填。`open` 留空取上一条收盘价；`high` / `low` 留空取 `max(open, close)` / `min(open, close)`。日期以文件名为准。

### 插图

- 封面：frontmatter 的 `cover` 字段，站内路径建议写成 `images/journal/xxx.webp`。
- 正文插图：Markdown 图片语法，独占一行会渲染为带图注的 figure。
- 图片放在 `public/images/journal/`，构建后位于 `/images/journal/`。
- 建议 WebP、宽度 ≤1600px、单张 ≤300KB；图片懒加载，不阻塞首屏。
- 渲染器会转义原始 HTML，只允许站内相对路径与 https/http 图片。

### 两个文件的关系

| | 角色 | 谁写 |
|---|---|---|
| `journal/*.md` | 写作源文件 | 手动编辑 |
| `data/records.json` | 站点数据源 | 由 `journal.mjs` 合并生成 |

同日期重复提交是更新；缺失日期不补造；OHLC 不合法时整体拒绝且不写入文件；`records.json` 中没有对应日记文件的记录会原样保留。

### 网页保存 ≠ Git 提交

| 行为 | 发生位置 | 影响 |
|---|---|---|
| 保存记录（网页按钮） | 浏览器 `localStorage`（键 `ysi.pending.v1`） | 只在本机可见，仓库与线上站点不变 |
| `git commit & push` | 本地终端 / journal 脚本 | 真正发布，Actions 构建并更新站点 |

站点不实现 GitHub API 写入、OAuth 或 Token，也不会声称网页操作已经改动仓库。

---

## 验证

```bash
npm run check          # 数据层 72 项 + 日记流程 48 项 + 正文渲染 21 项 + 源数据检查
npm run build          # 构建并检查 dist/ 产物（CNAME、字体、数据、哈希资源）
npm run check:e2e      # 94 项桌面/移动端/空数据/减少动效/暂存流程（需 playwright-core）
npm run check:subpath  # 20 项子路径部署验收（自动构建临时产物）
npm run verify:production # 27 项线上检查（默认 https://index.yumesumi.cyou/）
```

`e2e` 与 `acceptance` 需要本机 Chromium Headless Shell；可用 `YSI_CHROME` 指定路径。`npm run check:e2e` 会自动启动 `dist/` 预览服务器。测试截图输出到 `tools/shots/`（已在 `.gitignore` 中忽略）。

`npm run verify:production` 直接访问线上域名，验证 HTML、数据、CNAME、HTTPS 跳转、字体、图表、返回主站按钮、移动端菜单焦点与哈希路由。可用 `YSI_PRODUCTION_URL` 指向其他部署地址；网络需要代理时设置 `YSI_PROXY=http://127.0.0.1:10808`。

`tools/journal-e2e.mjs` 在临时沙箱中自建 bare 远端，完整跑 `new → check → sync → commit → push`，不会触碰真实仓库或 GitHub。

---

## 代理与网络

`tools/v2ray.mjs` 管理本机 V2rayN，并在代理不可用时自动切换节点。

```bash
node tools/v2ray.mjs status              # 查看状态
node tools/v2ray.mjs nodes               # 列出节点（按延迟排序）
node tools/v2ray.mjs use <序号|名称>     # 切换节点
node tools/v2ray.mjs ensure              # 确保可用，不通则自动换节点
node tools/v2ray.mjs with-proxy <命令...> # 在代理可用时执行命令
```

设计取舍：

- **不直接写注册表。** 系统代理由 V2rayN 自己在启动时设置；脚本改配置后重启它即可。
- **切节点必须重启 V2rayN。** 核心配置由 V2rayN 生成，直接改 `config.json` 会丢配置。

`tools/journal.mjs` 的 push 已接入该工具：直连失败 → 环境代理 → SOCKS5 → 自动切换 V2rayN 节点重试。git 代理只设置 `http.proxy`，不同时设置 `https.proxy`。

> 由脚本启动的 V2rayN 会随命令结束被回收。需要代理长期常驻，请手动启动 V2rayN。

---

## 隐私提醒

GitHub Pages 上的站点是公开的，仓库里的 `data/records.json` 同样公开。

**正式发布前请确认日记内容适合公开阅读，不要把密码、账号信息、密钥或任何不希望公开的细节提交进公开仓库。** 导出 JSON 前也请自行检查一遍内容。

---

## 免责声明

YSI 不是金融资产，不构成任何投资建议。上涨与下跌的颜色只是记账符号，不表示人生价值的高低，也不用于比较任何真实市场的涨跌。
