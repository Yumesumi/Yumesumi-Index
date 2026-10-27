---
title:
mood:
energy:
tags:
open:
high:
low:
close:
---

在这里写正文。

> 必填：title、close，以及正文本身。
> 可选：mood、energy（0–10）、tags（逗号分隔）。
> open 留空则取上一条记录的收盘价；high 留空则取 max(open, close)；
> low 留空则取 min(open, close)。
>
> 日期以文件名为准。修改这个文件后运行：
>   node tools/journal.mjs check
>   node tools/journal.mjs commit
