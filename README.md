# 梦澄指数 · Yumesumi Index

> A Journal, Expressed as an Index.
> 用指数表达日记，用记录留住时间。

一个部署在 GitHub Pages 上的个人静态网站。以日记和主观感受为内核，用模拟股票指数的视觉语言呈现——每日点位、涨跌、日 K 线与历史记录。

它不是一个真实的金融市场。点位只代表记录本身。

---

## 快速开始

### 本地预览

因为使用了 ES Modules 和 `fetch` 读取 JSON，**不能直接双击打开 `index.html`**（浏览器会因安全策略拦截）。需要一个静态服务器：

```bash
# 方式一：Node（无需安装任何依赖）
node tools/serve.mjs 8099
# 打开 http://127.0.0.1:8099/

# 方式二：Python
python -m http.server 8099

# 方式三：npx
npx serve .
```

### 部署到 GitHub Pages

1. 把仓库推到 GitHub（默认分支 `main`）。
2. 仓库 **Settings → Pages**：
   - Source 选择 **Deploy from a branch**
   - Branch 选择 **main**，目录选择 **/ (root)**
3. 保存，等待构建完成，访问 `https://<用户名>.github.io/<仓库名>/`。

站点使用全部相对路径（`./assets/...`、`./data/...`），部署在子路径下也能正常加载。仓库已包含 `.nojekyll`，跳过 Jekyll 处理。

---

## 核心概念：网页保存 ≠ Git 提交

这是本项目最容易混淆的一点，界面里也专门写明了。

| 行为 | 在哪儿发生 | 影响 |
|---|---|---|
| **保存记录**（网页按钮） | 浏览器 | 只写入 `localStorage` 暂存区（键 `ysi.pending.v1`）。刷新后仍在，但**仓库和线上站点毫无变化**。 |
| **git commit & push**（命令行） | 本地终端 | 真正把 JSON 写进 GitHub 仓库，Pages 随后重新构建并发布。 |

换句话说：**网页里的「提交记录」是写日记，Git commit 才是发布日记。**

本站不实现 GitHub API 写入、OAuth 或 Personal Access Token，也不会谎称已经改动了仓库。

### 日常记录流程

推荐用 **`journal/` 目录 + 脚本**（见下文「写日记与发布」），一步到位：

```bash
node tools/journal.mjs new      # 新建今天的日记模板
# 编辑 journal/YYYY-MM-DD.md
node tools/journal.mjs commit   # 合并 + commit + push
```

也可以在网页里写，然后手动搬运：

```
填写日记和指数数据 → 网页预览 → 导出 JSON → 写入仓库 → 验证数据 → git commit & push
```

1. 在「日记」页点「新建记录」，填写日期、标题、正文、心境、能量、标签与 OHLC。
2. 点「保存到浏览器暂存区」。记录进入本机暂存区，顶部会出现提示条。
3. 点顶部「导出 JSON」，得到 `records.json`（格式与仓库文件完全一致，导出前会先确认清单）。
4. 用导出的文件替换仓库里的 `data/records.json`。
5. 检查 JSON 内容与日期无误后，执行：

   ```bash
   git add data/records.json
   git commit -m "记录 2026-10-27"
   git push
   ```

6. GitHub Pages 自动重新构建，站点更新。

---

## 写日记与发布

`journal/` 目录是**写日记的地方**。每篇日记是一个以日期命名的 Markdown 文件，脚本负责把它合并进 `data/records.json` 并发布。

```bash
node tools/journal.mjs new      # 新建模板（journal/YYYY-MM-DD.md）
node tools/journal.mjs check    # 校验，不改任何文件
node tools/journal.mjs sync     # 只合并，不提交
node tools/journal.mjs commit   # 合并 + git commit + push
```

写完日记后也可以直接说「**提交今天的日记**」，由 `ysi-journal-commit` skill 代劳。

### 文件格式

```markdown
---
title: 不急着给今天下结论
mood: 平静 · 认真
energy: 7
tags: 生活, 自我观察
open: 1074.06
high: 1088.20
low: 1072.50
close: 1086.42
---

正文在这里。
```

`title` 与 `close` 必填，正文必填。`open` 留空则取上一条记录的收盘价，`high` 留空取 `max(open, close)`，`low` 留空取 `min(open, close)`。

完整说明见 [`journal/README.md`](journal/README.md)。

### 两个文件的关系

| | 角色 | 谁写 |
|---|---|---|
| `journal/*.md` | 写作源文件 | 你手动编辑 |
| `data/records.json` | 站点数据源 | 由脚本从 journal/ 合并生成 |

网站只读 `data/records.json`。`journal/` 让写作保持轻便，脚本保证两者同步：

- 同日期重复提交是**更新**那条记录，不会产生重复。
- 缺失日期**不补造**记录。
- OHLC 关系不合法时**拒绝提交**，且不修改任何文件、不产生提交。
- `data/records.json` 中没有对应日记文件的记录会被**原样保留**，绝不删除。

---

## 数据说明

### 文件结构

```text
/
├── index.html              # 单页应用，四个视图由 hash 路由切换
├── assets/
│   ├── css/style.css       # 主题变量与全部样式
│   └── js/
│       ├── app.js          # 界面渲染、路由、表单、导入导出
│       ├── data.js         # 数据加载、校验、指标计算、序列化
│       └── chart.js        # 原生 SVG 日 K 线绘制
├── data/
│   ├── index.json          # 指数元信息
│   └── records.json        # 正式记录（站点唯一数据源）
├── journal/                # 日记源文件（你手动编辑）
│   ├── TEMPLATE.md         # 模板
│   ├── README.md           # 格式说明
│   └── YYYY-MM-DD.md       # 一篇日记
├── samples/
│   └── records.sample.json # 演示数据，明确标记，非真实记录
├── tools/                  # 本地预览与验证脚本（不影响站点运行）
│   ├── serve.mjs           # 本地静态服务器
│   ├── journal.mjs         # 日记合并与发布
│   ├── verify.mjs          # 数据层单元校验
│   ├── e2e.mjs             # 页面端到端校验
│   ├── acceptance.mjs      # 验收测试
│   ├── journal-verify.mjs  # 日记流程单元校验
│   └── journal-e2e.mjs     # 日记流程端到端校验
├── README.md
└── .nojekyll
```

### `data/index.json`

```json
{
  "name": "Yumesumi Index",
  "name_zh": "梦澄指数",
  "symbol": "YSI",
  "base_value": 1000,
  "base_date": "2026-10-27",
  "frequency": "daily",
  "data_mode": "manual"
}
```

基准日期只是指数的设定信息，**不代表系统为该日期自动生成了一条正式记录**。

### `data/records.json`

按日期排列的 JSON 数组，**每个日期最多一条记录**：

```json
[
  {
    "date": "2026-10-27",
    "title": "不急着给今天下结论",
    "body": "在这里写入当天真实的日记。",
    "mood": "平静 · 认真",
    "energy": 7,
    "tags": ["生活", "自我观察"],
    "ohlc": {
      "open": 1074.06,
      "high": 1088.20,
      "low": 1072.50,
      "close": 1086.42
    }
  }
]
```

格式要求：

- 日期使用 `YYYY-MM-DD`。
- 数值必须是 JSON 数字，不能写成带逗号的字符串。
- 展示格式、涨跌额和涨跌幅一律由代码计算，不手工维护。
- 缺失日期不创建占位记录。
- 原始正文完整保留，摘要只是展示层的截断。

### 指数规则

基准点位 `1000.00`。

```
日涨跌额  = 当日收盘价 − 上一条有效记录的收盘价
日涨跌幅  = 日涨跌额 ÷ |上一条有效记录收盘价| × 100%
累计变化  = (最新收盘价 − 1000) ÷ 1000 × 100%
```

第一条记录没有前一条收盘价，统一以基准点位作为比较对象。相邻两条记录可以相隔数天——日变化的比较对象是**上一条真实记录**，中间没有记录的日期不会生成 K 线，也不会被补造成行情。

**点位可以是负数。** 涨跌幅的分母取前收的绝对值，保证涨跌额与涨跌幅的符号始终一致：从 −200 涨到 −100 记作 +50%，而不会被除法翻转成负数。前收为 0 时没有可比基数，涨跌幅记为 0，涨跌额仍然准确。

### OHLC 约束

- `high >= open` 且 `high >= close`
- `low <= open` 且 `low <= close`

不满足的输入会被表单当场拒绝，不会被静默接受。新建记录时开盘价默认取上一条有效收盘价，最高/最低价默认跟随开盘收盘，都可以手动调整。

---

## 功能

- **概览**：当前点位、最近日涨跌、相对基准的累计变化、已记录日期数、最近心境；日 K 线图；最近 5 条日记；指数理念；发布流程说明。
- **日记**：按日期排序，按标题、正文、标签、心境全文搜索，查看完整记录，新建与修改（同日期为更新而非重复新增）。
- **历史**：历史 K 线与行情表（日期/开盘/最高/最低/收盘/日变化/涨跌幅），30 天 / 90 天 / 全部范围切换，导出 CSV。
- **说明**：指数含义、基准、OHLC 规则、缺失日期规则、数据保存与发布流程、隐私提醒、免责声明。

导出：JSON（与仓库格式一致）、CSV（正确处理逗号、引号、中文、换行，带 UTF-8 BOM）。
导入：先完整校验结构、日期与 OHLC 关系，任何一处不合法就整体拒绝，绝不覆盖现有数据。

---

## 技术约束

刻意保持为零依赖：

- 原生 HTML5 + CSS3（CSS Variables 管理主题）+ JavaScript ES Modules
- 原生 SVG 绘制 K 线，无图表库
- JSON 作为数据格式
- 无框架、无构建步骤、无 npm 依赖、无后端、无数据库

所有资源通过相对路径加载，部署在 `https://<用户名>.github.io/<仓库名>/` 下正常工作。正式运行时只读取必要的静态数据，不依赖任何第三方在线服务。

---

## 验证

```bash
node tools/verify.mjs         # 数据层：67 项单元校验
node tools/e2e.mjs            # 端到端：63 项页面校验（需 playwright-core）
node tools/journal-verify.mjs # 日记流程：47 项单元校验
node tools/journal-e2e.mjs    # 日记流程：46 项端到端（含本地 bare 远端 push）
node tools/acceptance.mjs     # 验收：23 项（需 playwright-core）
```

`tools/e2e.mjs` 与 `tools/acceptance.mjs` 需要 `playwright-core`。若未安装在当前目录，用环境变量指定：

```bash
# Windows
set PW_PATH=C:/path/to/playwright-core/index.mjs
node tools/e2e.mjs
```

脚本默认访问 `http://127.0.0.1:8099`，可用 `YSI_BASE` 覆盖；需先运行 `node tools/serve.mjs 8099`。

`tools/journal-e2e.mjs` 在临时沙箱中自建 bare 仓库跑完整 push 流程，不会触碰真实仓库或 GitHub。

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

设计上的两个取舍：

- **不直接写注册表。** 系统代理由 V2rayN 自己在启动时设置——这是它的官方行为（每次启动/重启时强制应用）。脚本改配置后重启它即可，无需触碰注册表。
- **切节点必须重启 V2rayN。** 核心配置（路由规则、出站参数）由 V2rayN 生成，直接改 `config.json` 会丢配置。

`tools/journal.mjs` 的 push 已接入该工具：直连失败 → 环境代理 → SOCKS5 → 自动切换 V2rayN 节点重试。

> 由脚本启动的 V2rayN 会随命令结束被回收。需要代理长期常驻，请手动启动 V2rayN；`with-proxy` 已覆盖「一次命令内完成网络操作」的场景。

---

## 隐私提醒

GitHub Pages 上的站点是公开的，仓库里的 `data/records.json` 同样公开。

**正式发布前请确认日记内容适合公开阅读，不要把密码、账号信息、密钥或任何不希望公开的细节提交进公开仓库。** 导出 JSON 前也请自行检查一遍内容。

---

## 免责声明

YSI 不是金融资产，不构成任何投资建议。上涨与下跌的颜色只是记账符号，不表示人生价值的高低。
