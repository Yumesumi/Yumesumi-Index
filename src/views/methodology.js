/* 说明：指数定义、计算规则、数据格式与发布流程 */

import { formatNumber } from '../lib/data.js';
import { FREQUENCY_LABEL } from '../lib/selectors.js';
import { icon } from '../components/icons.js';

export function renderMethodology(host, state) {
  const meta = state.meta;
  const base = meta.base_value;
  const freq = FREQUENCY_LABEL[meta.frequency] ?? meta.frequency;
  const cumulativeRule = base === 0
    ? '累计变化 = 最新收盘 − 0。基准为 0 时没有可比基数，不计算累计百分比，页面显示「—」。'
    : `累计变化 = (最新收盘 − ${formatNumber(base)}) ÷ ${formatNumber(base)} × 100%。`;

  host.innerHTML = `
    <section class="view-head reveal">
      <p class="eyebrow">METHODOLOGY · 规则</p>
      <div class="view-head-row">
        <h2>指数如何成立。</h2>
        <p class="lede">YSI 不是金融资产。这里写清楚每一条数字从哪里来、如何计算，以及网页保存与 Git 发布的边界。</p>
      </div>
    </section>

    <div class="method-grid">
      <section class="panel glass-soft prose-card reveal">
        <p class="eyebrow">DEFINITION</p>
        <h3>YSI 是什么</h3>
        <p><strong>梦澄指数 / Yumesumi Index（YSI）</strong> 是一个以记录为内核、以指数为外壳的个人档案站。每一条记录对应一根 K 线，记录当期的数字与文字。</p>
        <p>它借用了金融指数终端的视觉语言，但这里没有交易、没有资产、没有市场。点位只代表记录本身，不能换算成任何东西。</p>
        <dl class="kv">
          <div><dt>基准点位</dt><dd>${formatNumber(base)}</dd></div>
          <div><dt>基准日期</dt><dd>${meta.base_date || '—'}</dd></div>
          <div><dt>频率</dt><dd>${freq}</dd></div>
          <div><dt>数据模式</dt><dd>手动记录，不自动生成</dd></div>
          <div><dt>当前记录</dt><dd>${state.published.length} 条</dd></div>
        </dl>
        <a class="text-btn" href="https://yumesumi.cyou/" target="_blank" rel="noopener noreferrer">梦澄中心 ${icon('external', 13)}</a>
      </section>

      <section class="panel glass-soft prose-card reveal">
        <p class="eyebrow">CALCULATION</p>
        <h3>涨跌如何计算</h3>
        <div class="formula-list">
          <code>日涨跌额 = 当日收盘 − 上一条有效记录收盘</code>
          <code>日涨跌幅 = 日涨跌额 ÷ |上一条收盘| × 100%</code>
          <code>${cumulativeRule}</code>
        </div>
        <p>第一条记录没有前一条收盘价，统一以基准点位 ${formatNumber(base)} 作为比较对象。页面上的所有涨跌都由数据计算，不单独硬编码。</p>
        <h4>点位可以是负数</h4>
        <p>涨跌幅的分母取前收的<strong>绝对值</strong>，保证涨跌额与涨跌幅的符号始终一致——从 −200 涨到 −100 记作 +50%，而不会被除法翻转成负数。前收为 0 时没有可比基数，涨跌幅显示「—」，涨跌额仍然准确。</p>
      </section>

      <section class="panel glass-soft prose-card reveal">
        <p class="eyebrow">OHLC</p>
        <h3>一根 K 线的四个数</h3>
        <ul class="rule-list">
          <li><b>开盘 open</b>：默认取上一条有效记录的收盘价，可手动调整。</li>
          <li><b>最高 high</b>：必须 ≥ open 且 ≥ close。</li>
          <li><b>最低 low</b>：必须 ≤ open 且 ≤ close。</li>
          <li><b>收盘 close</b>：落笔时的状态，必填。</li>
        </ul>
        <p>不满足关系的输入会被表单当场拒绝，不会被静默接受或悄悄改写。</p>
        <h4>缺失日期</h4>
        <p>相邻两条记录可以相隔好几天。没有记录的日期不会生成 K 线，日变化的比较对象是上一条真实记录。同一日期再次保存是<strong>更新</strong>，不是新增。</p>
        <p>盘面时间轴按真实填写日期排布，没有记录的日期会留出时间间隔。可以用滚轮或双指缩放、拖拽平移，并在 7 天、30 天、90 天、180 天、1 年、3 年和成立来之间切换窗口。</p>
      </section>

      <section class="panel glass-soft prose-card reveal">
        <p class="eyebrow">DATA</p>
        <h3>数据保存在哪里</h3>
        <ul class="rule-list">
          <li><b>正式数据</b>：仓库里的 <code>data/records.json</code>，也是站点唯一的数据源。</li>
          <li><b>指数元信息</b>：<code>data/index.json</code>。</li>
          <li><b>浏览器暂存</b>：<code>localStorage</code> 键 <code>ysi.pending.v1</code>，只存在于当前设备。</li>
          <li><b>写作源文件</b>：<code>journal/YYYY-MM-DD.md</code>，由脚本合并进 JSON。</li>
        </ul>
        <p>日记正文支持一个收窄的 Markdown 子集：段落、标题、引用、列表、链接、图片。原始 HTML 会被转义，图片地址经过协议白名单。</p>
        <div class="inline-actions">
          <button type="button" class="btn" data-action="import-json">${icon('upload', 14)}<span>导入 JSON</span></button>
          <button type="button" class="btn" data-action="export-json">${icon('download', 14)}<span>导出 JSON</span></button>
          <button type="button" class="btn" data-action="export-csv">${icon('table', 14)}<span>导出 CSV</span></button>
        </div>
      </section>

      <section class="panel glass-soft prose-card reveal">
        <p class="eyebrow">PUBLISH</p>
        <h3>网页保存与 Git 发布</h3>
        <div class="compare-table">
          <div class="compare-row">
            <b>保存记录</b>
            <span>浏览器 localStorage 暂存区。刷新仍在，但仓库与线上站点没有变化。</span>
          </div>
          <div class="compare-row">
            <b>git commit &amp; push</b>
            <span>真正写入 GitHub 仓库，GitHub Actions 构建并发布新版本。</span>
          </div>
        </div>
        <p>换句话说：网页里的「保存」是写日记，Git 提交才是发布日记。本站不实现 GitHub API 写入、OAuth 或 Token，也不会谎称已经改动了仓库。</p>
        <h4>推荐流程</h4>
        <pre class="code-block"><code>node tools/journal.mjs new      # 新建今天的日记模板
node tools/journal.mjs check    # 校验，不改任何文件
node tools/journal.mjs commit   # 合并 + commit + push</code></pre>
        <p>推送后 GitHub Actions 会安装依赖、运行校验、构建 <code>dist/</code> 并部署到 GitHub Pages。构建失败不会发布新版本。</p>
      </section>

      <section class="panel glass-soft prose-card reveal">
        <p class="eyebrow">IMAGES</p>
        <h3>插图与封面</h3>
        <p>封面是可选的 <code>cover</code> 字段；正文中的图片使用 Markdown 语法，单独成行时会渲染为图注段落。</p>
        <pre class="code-block"><code>---
title: 今天的标题
cover: images/journal/2026-10-29.webp
---

![傍晚的天空](images/journal/2026-10-29-sky.webp)</code></pre>
        <p>图片放在 <code>public/images/journal/</code>，建议宽度不超过 1600px、使用 WebP、单张控制在 300KB 以内。图片按需懒加载，不会阻塞首屏。</p>
      </section>

      <section class="panel glass-soft prose-card reveal">
        <p class="eyebrow">PRIVACY</p>
        <h3>公开与免责</h3>
        <p>GitHub Pages 上的站点是公开的，仓库里的 <code>data/records.json</code> 同样公开。发布前请确认日记内容适合公开阅读，<strong>不要把密码、账号、密钥或任何不希望公开的细节提交进仓库</strong>。</p>
        <p>YSI 不是金融资产，不构成任何投资建议。上涨与下跌的颜色只是记账符号，不表示人生价值的高低，也不用于比较任何真实市场的涨跌。</p>
        <p class="muted">A Journal, Expressed as an Index. · <a class="inline-link" href="https://github.com/Yumesumi/Yumesumi-Index" target="_blank" rel="noopener noreferrer">源码</a></p>
      </section>
    </div>`;
}
