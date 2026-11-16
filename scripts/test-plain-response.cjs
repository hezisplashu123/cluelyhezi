const test=require('node:test');const assert=require('node:assert/strict');
const {parts,plainProse,toHtml,toText}=require('../lib/plain-response');

test('Markdown emphasis, headings and bullet prefixes display as ordinary text',()=>{
  const answer='## Recommendation\n\n**Choose B.**\n- Lower latency.\n* Clear tradeoff.\n1. Measure results.\n\n---\nKeep follow-up answers short.';
  const result=toText(answer);
  assert.match(result,/Recommendation\n\nChoose B\.\nLower latency\.\nClear tradeoff\.\nMeasure results\./);
  assert.doesNotMatch(result,/\*\*|^\s*[-*#]\s|^\s*\d+\.\s|---/m);
});

test('negative values, subtraction, hyphenated words, multiplication and exponentiation survive',()=>{
  const text='Profit = -5; contribution = 8 - 3. End-to-end ownership.\n- 5 + 2 = -3\n- 5%\n- x + y\n2**3 = 8; a * b; a ** b ** c.';
  assert.equal(plainProse(text),text);
});

test('closed and pending code blocks retain their exact contents while prose is cleaned',()=>{
  const code='const result = 2 ** 3;\nconst value = -5;\n// **literal**\n';
  const input='**Fix:**\n\n```js\n'+code+'```\n\n- Test it.';
  const parsed=parts(input);assert.equal(parsed[1].kind,'code');assert.equal(parsed[1].content,code);
  assert.equal(parsed[0].content,'Fix:\n\n');assert.match(parsed[2].content,/Test it\./);
  const pending=parts('**Fix:**\n```js\n'+code);
  assert.equal(pending.at(-1).kind,'code');assert.equal(pending.at(-1).content,code);
  assert.equal(parts('~~~python\na = 2 ** 3\n~~~~\n').find(p=>p.kind==='code').content,'a = 2 ** 3\n');
});

test('inline code stays literal, including Markdown-like symbols',()=>{
  assert.equal(plainProse('Use `__init__`, `2**3`, and `*ptr` with **care**.'),'Use __init__, 2**3, and *ptr with care.');
  assert.equal(plainProse('`- literal bullet` and `**literal**`'),'- literal bullet and **literal**');
});

test('incremental streaming hides unfinished bold markers without modifying source',()=>{
  for(const input of ['**','**Answer','**Answer:**','**Answer:**\n- Start small'])assert.doesNotMatch(toText(input),/\*\*/);
  assert.equal(toText('**Answer:**\n- Start small'),'Answer:\nStart small');
  assert.equal(parts('```java')[0].kind,'code');
});

test('user-entered text can retain its formatting while code remains separate',()=>{
  const input='**My text**\n- My list\n```js\na *= 2;\n```';
  const result=parts(input,{plain:false});assert.equal(result[0].content,'**My text**\n- My list\n');
  assert.equal(result[1].content,'a *= 2;\n');
});

test('desktop HTML remains plain and escapes potentially unsafe input and code',()=>{
  const html=toHtml('**Answer:**\n- <img src=x onerror=alert(1)>\n\n```html\n<script>alert(1)</script>\n```');
  assert.ok(html.startsWith('<p>Answer:<br>'));
  assert.doesNotMatch(html,/<strong>|<ul>|<img|<script/);
  assert.match(html,/&lt;img/);assert.match(html,/<pre><code class="language-html">&lt;script&gt;/);
});
