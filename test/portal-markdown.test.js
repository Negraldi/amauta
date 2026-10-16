import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEnv } from './helpers/fakedom.js';

const STATIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'python', 'amauta', 'portal', 'static');
const ctx = {};
vm.runInNewContext(await readFile(path.join(STATIC, 'markdown.js'), 'utf8'), ctx);
const MD = ctx.AmautaMarkdown;
// The module runs in its own realm: round-trip through JSON so deepEqual compares plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const parse = (s) => plain(MD.parse(s));
const inline = (s) => plain(MD.parseInline(s));
const dom = (s, opts) => MD.toDom(MD.parse(s), makeEnv({}).document, opts);
const all = (nodes) => { const out = []; for (const n of nodes) n.walk((e) => out.push(e)); return out; };
const html = (nodes) => { const f = (e) => (e.nodeType === 3 ? e.data : `<${e.tagName}${Object.entries(e.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${e.children.map(f).join('')}</${e.tagName}>`); return nodes.map(f).join(''); };

test('headings, paragraphs and soft line breaks', () => {
  assert.deepEqual(parse('# Title\n\nline one\nline two\n\n###### deep'), [
    { type: 'heading', level: 1, children: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', children: [{ type: 'text', text: 'line one line two' }] },
    { type: 'heading', level: 6, children: [{ type: 'text', text: 'deep' }] },
  ]);
  assert.equal(html(dom('# Hi')), '<h2>Hi</h2>'); // page title is the h1, content starts at h2
  assert.equal(html(dom('###### x')), '<h6>x</h6>');
  assert.equal(html(dom('# Hi', { headingOffset: 0 })), '<h1>Hi</h1>');
});

test('emphasis, strong, inline code and escapes', () => {
  assert.deepEqual(inline('a *b* **c** `d` _e_ __f__ \\*g\\*'), [
    { type: 'text', text: 'a ' }, { type: 'em', children: [{ type: 'text', text: 'b' }] }, { type: 'text', text: ' ' },
    { type: 'strong', children: [{ type: 'text', text: 'c' }] }, { type: 'text', text: ' ' }, { type: 'code', text: 'd' }, { type: 'text', text: ' ' },
    { type: 'em', children: [{ type: 'text', text: 'e' }] }, { type: 'text', text: ' ' }, { type: 'strong', children: [{ type: 'text', text: 'f' }] },
    { type: 'text', text: ' *g*' }]);
  assert.deepEqual(inline('snake_case_name and 2 * 3 * 4'), [{ type: 'text', text: 'snake_case_name and 2 * 3 * 4' }]);
  assert.deepEqual(inline('**bold with *em* inside**')[0].children.map((c) => c.type), ['text', 'em', 'text']);
  assert.deepEqual(inline('``a ` b``'), [{ type: 'code', text: 'a ` b' }]);
  assert.deepEqual(inline('unclosed `tick and *star'), [{ type: 'text', text: 'unclosed `tick and *star' }]);
});

test('fenced code keeps its text verbatim; mermaid fences are separate nodes; unclosed fences run to the end', () => {
  assert.deepEqual(parse('```js\nconst a = "<b>";\n# not a heading\n```\n\n~~~\nplain\n~~~'), [
    { type: 'code', lang: 'js', text: 'const a = "<b>";\n# not a heading' }, { type: 'code', lang: null, text: 'plain' }]);
  assert.deepEqual(parse('```mermaid\nA-->B\n```'), [{ type: 'mermaid', text: 'A-->B' }]);
  assert.deepEqual(parse('```mermaid\nnever closed\nstill code'), [{ type: 'mermaid', text: 'never closed\nstill code' }]);
  assert.equal(html(dom('```js\n<img onerror=x>\n```')), '<pre class="code"><code class="lang-js"><img onerror=x></code></pre>');
  const mermaidNodes = dom('```mermaid\nA-->B\n```', { mermaid: (src) => { const d = makeEnv({}).document.createElement('div'); d.setAttribute('data-src', src); return d; } });
  assert.equal(mermaidNodes[0].getAttribute('data-src'), 'A-->B');
});

test('lists: bullet, ordered, one nested level, continuation lines', () => {
  const t = parse('- one\n- two\n  - nested a\n  - nested b\n- three\n  continued');
  assert.equal(t[0].type, 'list');
  assert.equal(t[0].ordered, false);
  assert.equal(t[0].items.length, 3);
  assert.equal(t[0].items[1].sub.items.length, 2);
  assert.equal(t[0].items[2].children[0].text, 'three continued');
  const o = parse('1. a\n2. b\n   - x');
  assert.equal(o[0].ordered, true);
  assert.equal(o[0].items[1].sub.ordered, false);
  assert.equal(html(dom('- a\n  - b')), '<ul><li>a<ul><li>b</li></ul></li></ul>');
  assert.deepEqual(parse('- a\n\ntext').map((b) => b.type), ['list', 'paragraph']);
  assert.deepEqual(parse('text\n- a\n- b').map((b) => b.type), ['paragraph', 'list']);
  assert.deepEqual(parse('* * *').map((b) => b.type), ['hr']);
});

test('tables with alignment, escaped pipes and ragged rows', () => {
  const t = parse('| Name | Count |\n|:--|--:|\n| a \\| b | 1 |\n| short |');
  assert.equal(t[0].type, 'table');
  assert.deepEqual(t[0].align, ['left', 'right']);
  assert.equal(t[0].rows[0][0][0].text, 'a | b');
  assert.equal(t[0].rows[1].length, 2);
  const h = html(dom('a | b\n--|--\n1 | 2'));
  assert.match(h, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.deepEqual(parse('just | a pipe in text').map((b) => b.type), ['paragraph']);
});

test('blockquotes nest and hold blocks', () => {
  const t = parse('> quote **b**\n> - item\n>\n> > inner');
  assert.equal(t[0].type, 'quote');
  assert.deepEqual(t[0].children.map((b) => b.type), ['paragraph', 'list', 'quote']);
});

test('links: only http, https, mailto and wiki routes survive; everything else is literal text', () => {
  const ok = ['https://example.com/a?b=1', 'http://example.com', 'mailto:me@example.com', '#/memory/12', '#/node/repo%3A%3Aa'];
  for (const u of ok) assert.deepEqual(inline(`[x](${u})`), [{ type: 'link', href: u, children: [{ type: 'text', text: 'x' }] }], u);
  const bad = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd',
    '//evil.example/x', '/api/overview', 'relative/path', '#frag', 'ftp://x', 'https://', 'mailto:', 'https://a b', 'http://x"onmouseover="y'];
  for (const u of bad) {
    const out = inline(`[x](${u})`);
    assert.ok(out.every((n) => n.type === 'text'), `${u} became ${JSON.stringify(out)}`);
    assert.equal(out.map((n) => n.text).join(''), `[x](${u})`);
  }
  assert.equal(MD.safeHref('https://x.example'), 'https://x.example');
  assert.equal(MD.safeHref('javascript:1'), null);
  assert.equal(MD.safeHref(null), null);
  const a = dom('[ext](https://example.com) and [in](#/skill/x)');
  const [ext, inn] = all(a).filter((e) => e.tagName === 'a');
  assert.equal(ext.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(ext.getAttribute('class'), 'external');
  assert.equal(inn.getAttribute('rel'), undefined);
  assert.deepEqual(inline('[a [nested] label](https://x.example)')[0].children.map((c) => c.text).join(''), 'a [nested] label');
  assert.deepEqual(inline('[x](https://x.example/a_(b))')[0].href, 'https://x.example/a_(b)');
});

test('wikilinks: [[slug]] and [[kind:id|label]] become wiki routes; missing targets are styled as missing', () => {
  assert.deepEqual(inline('[[arch/widgets]]'), [{ type: 'wikilink', kind: 'memory', id: 'arch/widgets', label: 'arch/widgets' }]);
  assert.deepEqual(inline('[[skill:work-unit-commits|commits]]'), [{ type: 'wikilink', kind: 'skill', id: 'work-unit-commits', label: 'commits' }]);
  assert.deepEqual(inline('[[node:repo::a]]'), [{ type: 'wikilink', kind: 'node', id: 'repo::a', label: 'repo::a' }]);
  assert.deepEqual(inline('[[unknownkind:x]]'), [{ type: 'wikilink', kind: 'memory', id: 'unknownkind:x', label: 'unknownkind:x' }]);
  assert.deepEqual(plain(MD.wikilinks(MD.parse('- [[a]] and **[[tool:Bash]]**\n\n> [[session:s1|s]]'))), [{ kind: 'memory', id: 'a' }, { kind: 'tool', id: 'Bash' }, { kind: 'session', id: 's1' }]);
  const known = (k, id) => id !== 'gone';
  assert.equal(html(dom('[[a b]] [[skill:s/1|S]]', { known })), '<p><a class="wikilink" href="#/memory/a%20b">a b</a> <a class="wikilink" href="#/skill/s%2F1">S</a></p>');
  assert.match(html(dom('[[gone]]', { known })), /<span class="wikilink missing" title="No page yet for memory: gone">gone<\/span>/);
  for (const bad of ['[[]]', '[[ ]]', '[[a\nb]]', '[[a[b]]', '[[unclosed']) assert.ok(inline(bad).every((n) => n.type === 'text' || n.type === 'link'), bad);
});

test('XSS payloads stay inert text: no element is ever created from source markup', () => {
  const payloads = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '<a href="javascript:alert(1)">x</a>', '<svg onload=alert(1)>', '"><img src=x onerror=alert(1)>',
    '[<img src=x onerror=alert(1)>](https://x.example)', '[x](https://x.example "<img onerror=1>")', '**<img src=x onerror=alert(1)>**', '`<img src=x onerror=alert(1)>`',
    '[[<img src=x onerror=alert(1)>]]', '| <img src=x onerror=1> |\n|--|\n| <script> |', '> <iframe src=javascript:1>', '- <img src=x onerror=1>', '# <img src=x onerror=1>',
    '[x](javascript&#58;alert(1))', '[x](&#x6A;avascript:alert(1))', '![img](https://x.example/a.png)', '<div style="x" onclick="y">z</div>'];
  const allowed = new Set(['p', 'h2', 'a', 'span', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div']);
  for (const p of payloads) {
    const nodes = dom(p);
    for (const e of all(nodes)) {
      assert.ok(allowed.has(e.tagName), `${p} produced <${e.tagName}>`);
      for (const [k, v] of Object.entries(e.attrs)) {
        assert.ok(!k.startsWith('on'), `${p} produced attribute ${k}`);
        if (k === 'href') assert.ok(MD.safeHref(v), `${p} produced href ${v}`);
        assert.ok(!/javascript:/i.test(v), `${p} produced ${k}=${v}`);
      }
    }
  }
  const text = nodeText(dom('<img src=x onerror=alert(1)>'));
  assert.equal(text, '<img src=x onerror=alert(1)>');
});
function nodeText(nodes) { return nodes.map((n) => n.textContent).join(''); }

test('the adapter never touches innerHTML-style sinks', async () => {
  const src = await readFile(path.join(STATIC, 'markdown.js'), 'utf8');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'DOMParser']) assert.ok(!src.includes(sink), sink);
  assert.doesNotMatch(src, /https?:\/\/[a-z]/);
});

test('adversarial inputs finish quickly and never throw', () => {
  const started = Date.now();
  const inputs = ['*a '.repeat(30000), '[a](' .repeat(8000), '`'.repeat(50000), '[['.repeat(20000), '> '.repeat(5000) + 'x', '- '.repeat(20000), '| a |\n|--|\n'.repeat(5000),
    '_a_'.repeat(30000), '['.repeat(30000), '(' .repeat(30000), '**'.repeat(30000), '\u0000\u0001�', ''.padEnd(300000, 'x'), '- a\n'.repeat(1) + '  '.repeat(100000) + '- b'];
  for (const s of inputs) { const tree = MD.parse(s); assert.ok(Array.isArray(tree)); dom(s); }
  assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
  assert.deepEqual(parse(null), []);
  assert.deepEqual(parse(undefined), []);
  assert.deepEqual(parse(''), []);
});

test('a realistic memory document renders every construct together', () => {
  const doc = '# Decision\n\nWe chose **teal**. See [[arch/widgets]] and [docs](https://example.com).\n\n| a | b |\n|--|--|\n| 1 | 2 |\n\n- x\n  - y\n\n```mermaid\nA-->B\n```\n\n> note\n';
  assert.deepEqual(parse(doc).map((b) => b.type), ['heading', 'paragraph', 'table', 'list', 'mermaid', 'quote']);
});
