// T15 W3b group B (layout residuals): wide guide blocks, a node page that uses its width, a sessions list that fits, toggled tables re-measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';
import { boot, page, tree, view, text, tick } from './helpers/t15w3.js';

const css = async (f) => readFile(path.join(STATIC, f), 'utf8');
const rule = (src, selector) => { const m = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(src); return m ? m[1] : null; };

test('(a) a guide page is as wide as the content area; only its prose keeps the reading measure', async () => {
  const src = await css('style-pages.css');
  assert.match(rule(src, '.guide-page') ?? '', /max-inline-size:\s*none/);
  const prose = /\.guide-page > :where\(([^)]*)\)\s*\{[^}]*max-inline-size:\s*var\(--measure\)/.exec(src);
  assert.ok(prose, 'prose children keep the measure');
  for (const tag of ['p', 'ul', 'ol', 'h2']) assert.match(prose[1], new RegExp(`\\b${tag}\\b`));
  assert.doesNotMatch(prose[1], /diagram|scroll|table/);
});

const node = page('node', { id: 'r::n1', title: 'n1', meta: [], diagram: { source: 'flowchart LR\n  n0["a"]', nodes: 1, edges: 0 } });
test('(b) a node page lets its column take the free width', async () => {
  const env = await boot('#/node/r%3A%3An1', { '/api/wiki/page': node });
  const wrap = tree(view(env)).find((e) => /\bpage\b/.test(e.className));
  assert.match(wrap.className, /page-wide/);
  const src = await css('style.css');
  assert.match(rule(src, '.page.page-wide') ?? '', /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--rail-w\)/);
  const other = await boot('#/memory/7', { '/api/wiki/page': page('memory', { id: '7' }) });
  assert.doesNotMatch(tree(view(other)).find((e) => /\bpage\b/.test(e.className)).className, /page-wide/);
});

const T = (x) => ({ messages: 1, input: 1, output: 1, cache_read: 0, cache_write: 0, last_ts: '2026-11-10T08:00:00Z', first_ts: '2026-11-09T08:00:00Z', ...x });
const SESSIONS = { available: true, projects: [], sessions: [T({ session_id: 'aaaaaaaa1', runtime: 'codex', project: 'amauta', model: 'gpt-6', models: 1, title: 'Fix the portal' })] };
test('(c) the sessions list stacks runtime and model under the title: fewer columns, nothing hidden', async () => {
  const env = await boot('#/session', { '/api/sessions': SESSIONS });
  const heads = tree(view(env)).filter((e) => e.tagName === 'th').map((e) => e.textContent.replace(/ [▲▼]$/, ''));
  assert.ok(!heads.includes('Runtime') && !heads.includes('Model'), heads.join(','));
  assert.equal(heads.length, 8);
  const first = tree(view(env)).find((e) => e.tagName === 'td');
  assert.match(first.textContent, /Fix the portal/);
  assert.match(first.textContent, /Codex/);
  assert.match(first.textContent, /gpt-6/);
  assert.match(first.textContent, /started 2026-11-09/);
});

test('(d) a table inside a <details> is measured again when the details opens', async () => {
  const env = await boot('#/', {});
  const ctx = env.__ctx;
  const listeners = {};
  const box = { className: 'scroll', scrollWidth: 900, clientWidth: 0, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, nextElementSibling: null, after() {} };
  const root = { addEventListener: (t, fn, cap) => { listeners[t] = { fn, cap }; }, querySelectorAll: (sel) => (/scroll/.test(sel) ? [box] : []) };
  ctx.watchOverflow(root);
  assert.ok(listeners.toggle, 'listens to toggle');
  assert.equal(listeners.toggle.cap, true, 'toggle does not bubble: captured');
  box.clientWidth = 400; // laid out now that the details is open
  listeners.toggle.fn();
  await tick(60);
  assert.equal(box.attrs.tabindex, '0');
});
