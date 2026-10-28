/* 日记正文渲染单元验证：node tools/richtext-verify.mjs */
import { renderInline, renderJournalBody } from '../src/lib/richtext.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('\n[段落与换行]');
const para = renderJournalBody('第一行\n第二行\n\n第二段');
check('空行分段', (para.match(/<p>/g) || []).length === 2, para);
check('单换行保留为 <br>', para.includes('第一行<br>第二行'));
check('空正文有占位', renderJournalBody('').includes('正文为空'));

console.log('\n[HTML 转义]');
const xss = renderJournalBody('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
check('原始 script 被转义', !xss.includes('<script>') && xss.includes('&lt;script&gt;'), xss);
check('原始 img 被转义', !xss.includes('<img src=x'), xss);

console.log('\n[行内标记]');
check('粗体', renderInline('**重点**') === '<strong>重点</strong>', renderInline('**重点**'));
check('行内代码', renderInline('`node tools/journal.mjs`').includes('<code>node tools/journal.mjs</code>'));
check('安全链接', renderInline('[主站](https://yumesumi.cyou/)').includes('href="https://yumesumi.cyou/"'));
check('站内链接补 base', renderInline('[说明](methodology)').includes('href="/methodology"'), renderInline('[说明](methodology)'));
check('javascript 链接不转换', !renderInline('[x](javascript:alert(1))').includes('<a '), renderInline('[x](javascript:alert(1))'));

console.log('\n[图片]');
const safeImg = renderInline('![天空](images/journal/sky.webp)');
check('安全图片渲染', safeImg.includes('<img src="/images/journal/sky.webp"') && safeImg.includes('loading="lazy"'), safeImg);
const extImg = renderInline('![外链](https://example.com/a.png)');
check('https 图片允许', extImg.includes('src="https://example.com/a.png"'), extImg);
const unsafeImg = renderInline('![x](javascript:alert(1))');
check('javascript 图片被拒绝', !unsafeImg.includes('<img'), unsafeImg);
const dataImg = renderInline('![x](data:image/png;base64,AAAA)');
check('data 图片被拒绝', !dataImg.includes('<img'), dataImg);
const fig = renderJournalBody('![傍晚的天空](images/journal/sky.webp)');
check('独占一行图片渲染为 figure', fig.includes('<figure class="journal-figure">') && fig.includes('<figcaption>傍晚的天空</figcaption>'), fig);

console.log('\n[块级结构]');
check('标题', renderJournalBody('## 小节').includes('<h4>小节</h4>'));
check('引用', renderJournalBody('> 引用一行\n> 第二行').includes('<blockquote>'));
check('无序列表', renderJournalBody('- 一\n- 二').includes('<ul><li>一</li><li>二</li></ul>'));
check('有序列表', renderJournalBody('1. 一\n2. 二').includes('<ol><li>一</li><li>二</li></ol>'));
check('分割线', renderJournalBody('---').includes('<hr>'));
const fence = renderJournalBody('```\n<b>code</b>\n```');
check('代码块转义', fence.includes('<pre><code>&lt;b&gt;code&lt;/b&gt;</code></pre>'), fence);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) process.exit(1);
