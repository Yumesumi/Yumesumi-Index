# journal/ — 日记源文件

这里是**你手写日记的地方**。每个文件是一天的记录，文件名即日期。

```
journal/
├── TEMPLATE.md          # 模板，新建时复制它
├── 2026-10-27.md
└── 2026-10-29.md
```

## 快速开始

```bash
# 1. 新建今天的日记（自动带上上一条收盘价作为开盘价默认值）
node tools/journal.mjs new

# 2. 编辑 journal/YYYY-MM-DD.md，写标题、正文、心境和 OHLC

# 3. 校验（不会修改任何文件）
node tools/journal.mjs check

# 4. 合并进 data/records.json 并发布到 GitHub
node tools/journal.mjs commit
```

也可以直接说「提交今天的日记」，由 `ysi-journal-commit` skill 代劳。

## 文件格式

```markdown
---
title: 不急着给今天下结论
mood: 平静 · 认真
energy: 7
tags: 生活, 自我观察
cover: images/journal/2026-10-29.webp
open: 1074.06
high: 1088.20
low: 1072.50
close: 1086.42
---

这里是正文。

![傍晚的天空](images/journal/2026-10-29-sky.webp)
```

`---` 包裹的是头部字段，之后是正文。头部可以整段省略——那样只有正文，标题和 OHLC 就会缺失并在校验时报错。

### 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是 | 标题 |
| `close` | 是 | 收盘价，站点以它计算涨跌 |
| `body` | 是 | 正文，即 `---` 之后的内容 |
| `mood` | 否 | 心境 |
| `energy` | 否 | 能量，0–10 |
| `tags` | 否 | 标签，逗号分隔 |
| `cover` | 否 | 封面图片路径，例如 `images/journal/2026-10-29.webp` |
| `open` | 否 | 开盘价，缺省取**上一条**记录的收盘价 |
| `high` | 否 | 最高价，缺省取 `max(open, close)` |
| `low` | 否 | 最低价，缺省取 `min(open, close)` |
| `date` | 否 | 冗余字段，与文件名不一致时以文件名为准 |

## 规则

- **日期以文件名为准**，文件名必须是 `YYYY-MM-DD.md`。
- **同日期只有一个文件**。重复保存同一天是**更新**那条记录，不会产生第二条。
- **OHLC 必须满足** `high >= open`、`high >= close`、`low <= open`、`low <= close`。不满足会被拒绝，且不会写入任何文件。
- **缺失日期不补造记录**。10-27 和 10-29 可以并存，中间那天就是没有 K 线。
- `data/records.json` 里没有对应日记文件的记录会被**原样保留**，不会被脚本删除。

## 插图与封面

图片放在仓库的 `public/images/journal/`，构建后会出现在站点的 `/images/journal/`。

- 封面：frontmatter 的 `cover` 字段，建议用相对路径 `images/journal/xxx.webp`。
- 正文图片：Markdown 语法 `![说明](images/journal/xxx.webp)`；独占一行会渲染成带图注的 figure。
- 建议 WebP、宽度 ≤1600px、单张 ≤300KB。图片懒加载，不会阻塞首屏。
- 原始 HTML 会被转义；图片和链接只允许站内相对路径与 https/http 协议。

正文还支持段落、标题（`##`）、引用（`>`）、无序/有序列表、链接、粗体、斜体与行内代码。单换行会保留为换行。

## 两个文件的关系

| | 角色 | 谁写 |
|---|---|---|
| `journal/*.md` | 写作源文件 | 你手动编辑 |
| `data/records.json` | 站点数据源 | 由脚本从 journal/ 合并生成 |

网站只读 `data/records.json`。Vite 构建时会把 `data/` 复制进 `dist/`，GitHub Actions 再发布 `dist/`。`journal/` 让写作这件事保持轻便，脚本保证两者同步。

## ⚠️ 隐私

这个目录里的内容**会随仓库一起公开**（GitHub Pages 站点是公开的）。写之前确认内容适合公开阅读，不要把密码、账号、密钥或个人秘密写进日记。
