import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const XSS = '<img src=x onerror=alert(1)>';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const plain = (x) => JSON.parse(JSON.stringify(x));
const cls = (e) => e.className || e.attrs.class || '';

// ---- routing helpers (pure) --------------------------------------------------------------------------------
const rctx = {};
vm.runInNewContext(await read('wikiroute.js'), rctx);
const R = rctx.AmautaRoute;

test('parseHash and formatHash round-trip every id shape', () => {
  for (const [kind, id] of [['memory', 'arch/widgets'], ['node', 'repo::a'], ['skill', 'work-unit-commits'], ['session', 'abc-123'], ['memory', 'a b#c?d%e'], ['tool', 'mcp__engram__mem_save'], ['feature', XSS]]) {
    const hash = R.formatHash(kind, id);
    assert.match(hash, /^#\/[a-z]+\/[^/]+$/, hash); // ids never add path segments
    assert.deepEqual(plain(R.parseHash(hash)), { kind, id });
  }
  assert.equal(R.formatHash('memory', ''), '#/memory');
  assert.equal(R.formatHash('home', ''), '#/home');
});

test('parseHash: home by default, legacy tab hashes, raw slashes, bad encodings and unknown kinds', () => {
  for (const h of ['', '#', '#/', '#/home']) assert.deepEqual(plain(R.parseHash(h)), { kind: 'home', id: '' }, h);
  assert.deepEqual(plain(R.parseHash('#overview')), { kind: 'home', id: '' });
  assert.deepEqual(plain(R.parseHash('#sessions')), { kind: 'session', id: '' });
  assert.deepEqual(plain(R.parseHash('#memories')), { kind: 'memory', id: '' });
  for (const k of ['usage', 'harness', 'diagrams']) assert.deepEqual(plain(R.parseHash('#' + k)), { kind: k, id: '' });
  assert.deepEqual(plain(R.parseHash('#/memory/arch/widgets')), { kind: 'memory', id: 'arch/widgets' });
  assert.deepEqual(plain(R.parseHash('#/memory/%E0%A4%A')), { kind: 'memory', id: '%E0%A4%A' }); // malformed percent-encoding is kept as is
  assert.equal(R.parseHash('#/nope/1').kind, 'unknown');
  assert.equal(R.parseHash('#/__proto__/1').kind, 'unknown');
  assert.equal(R.parseHash('#/constructor').kind, 'unknown');
  assert.equal(R.parseHash('#whatever').kind, 'unknown');
  assert.equal(R.parseHash(undefined).kind, 'home');
  for (const k of ['home', 'memory', 'skill', 'tool', 'mcp', 'session', 'feature', 'node', 'harness', 'usage', 'settings']) assert.ok(R.KINDS[k], k);
});

test('palette list helpers: flatten groups in keyboard order and wrap the selection', () => {
  const flat = plain(R.flattenResults([{ kind: 'skill', count: 1, items: [{ kind: 'skill', id: 's', title: 'S', snippet: '1 calls' }] }, { kind: 'task', count: 1, items: [{ kind: 'feature', id: 'f', title: 'T' }] }]));
  assert.deepEqual(flat.map((i) => [i.group, i.kind, i.id]), [['skill', 'skill', 's'], ['task', 'feature', 'f']]);
  assert.deepEqual(plain(R.flattenResults(undefined)), []);
  assert.equal(R.moveIndex(-1, 1, 3), 0);
  assert.equal(R.moveIndex(-1, -1, 3), 2);
  assert.equal(R.moveIndex(2, 1, 3), 0);
  assert.equal(R.moveIndex(0, -1, 3), 2);
  assert.equal(R.moveIndex(0, 1, 0), -1);
});

// ---- shell -------------------------------------------------------------------------------------------------
const PAGE = {
  kind: 'memory', id: '7', title: XSS, body_md: `# Heading\n\nSee [[arch/widgets]], [[gone]] and [bad](javascript:alert(1)).\n\n${XSS}\n\n\`\`\`mermaid\nA-->B\n\`\`\`\n`,
  meta: [{ label: 'Type', value: 'decision' }, { label: 'Project', value: XSS }],
  links: [{ kind: 'memory', id: '1', title: XSS }, { kind: 'skill', id: 'work-unit-commits', title: 'work-unit-commits' }],
  backlinks: [{ kind: 'session', id: 's1', title: 'alpha · s1' }],
  sections: [{ heading: 'Revisions', items: [{ label: '#7 revision 2', value: '2026-10-01', kind: 'memory', id: '7' }] }, { heading: 'Tasks', items: [{ label: 'T1', value: 'done', kind: null, id: null }, { label: 'T2', value: 'pending', kind: null, id: null }] }],
  missing: [{ kind: 'memory', id: 'gone' }],
};
const routes = () => ({
  '/api/wiki/page': PAGE,
  '/api/wiki/recent': { items: [{ kind: 'memory', id: '7', title: XSS, ts: '2026-10-02T10:00:00Z', what: 'memory saved' }, { kind: 'session', id: 's1', title: 'alpha · s1', ts: '2026-10-01T10:00:00Z', what: 'session, 2 messages' }] },
  '/api/wiki/search': { q: 'x', groups: [
    { kind: 'skill', count: 1, items: [{ kind: 'skill', id: 'work-unit-commits', title: 'work-unit-commits', snippet: '1 calls' }] },
    { kind: 'memory', count: 2, items: [{ kind: 'memory', id: '7', title: XSS, snippet: XSS }, { kind: 'memory', id: '8', title: 'Other', snippet: null }] }] },
  '/api/overview': { available: false }, '/api/costs': { enabled: false, models: [] }, '/api/odd': { repos: [{ repo: 'r', documents: [{ name: 'feat.md', done: 1, total: 2, tasks: [] }] }] },
  '/api/tools': { available: true, tools: [{ name: 'Bash', count: 1, sessions: 1, last_used: 'x' }], skills: [{ name: 'work-unit-commits', count: 1, sessions: 1, last_used: 'x' }], subagents: [], mcp_servers: [], mcp_tools: [] },
});

async function boot(hash, over = {}) {
  const env = makeEnv({ ...routes(), ...over });
  env.location.hash = hash;
  const opened = [];
  const palette = env.document.getElementById('palette');
  palette.showModal = () => opened.push('open');
  palette.close = () => opened.push('close');
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return { env, opened };
}
const view = (env) => env.document.getElementById('view');
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));
const key = (env, init) => { let prevented = false; for (const fn of env.docListeners.keydown ?? []) fn({ preventDefault: () => { prevented = true; }, target: { tagName: 'body' }, ...init }); return prevented; };

test('a wiki page asks /api/wiki/page for the route, shows title, kind label, metadata and linked pages', async () => {
  const { env } = await boot('#/memory/7');
  const call = env.calls.find((c) => String(c.url).startsWith('/api/wiki/page'));
  assert.equal(call.url, '/api/wiki/page?kind=memory&id=7');
  const v = view(env);
  const h1 = tree(v).filter((e) => e.tagName === 'h1');
  assert.equal(h1.length, 1);
  assert.equal(h1[0].textContent, XSS); // hostile title is text
  assert.match(v.textContent, /Memory/);
  assert.match(v.textContent, /Type/);
  assert.match(v.textContent, /decision/);
  const links = hrefs(v);
  assert.ok(links.includes('#/skill/work-unit-commits'));
  assert.ok(links.includes('#/session/s1'));
  assert.ok(links.includes('#/memory/1'));
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(tree(v).every((e) => Object.keys(e.attrs).every((k) => !k.startsWith('on'))));
  assert.equal(env.document.title, `${XSS} - amauta`);
});

test('the markdown body is rendered with wikilinks, missing targets, unsafe links as text, and mermaid through the lazy path', async () => {
  const { env } = await boot('#/memory/7');
  const v = view(env);
  assert.ok(tree(v).some((e) => e.tagName === 'h2' && e.textContent === 'Heading'));
  assert.ok(hrefs(v).includes('#/memory/arch%2Fwidgets'));
  const missing = tree(v).find((e) => /wikilink/.test(cls(e)) && /missing/.test(cls(e)));
  assert.ok(missing, 'missing wikilink is styled as missing');
  assert.equal(missing.tagName, 'span');
  assert.ok(!hrefs(v).some((h) => /javascript/i.test(h)));
  assert.match(v.textContent, /\[bad\]\(javascript:alert\(1\)\)/);
  assert.ok(tree(v).some((e) => /diagram/.test(cls(e))), 'mermaid fence got a diagram box');
});

test('sections render as lists with links, and task status uses a label plus a shape', async () => {
  const { env } = await boot('#/memory/7');
  const v = view(env);
  assert.match(v.textContent, /Revisions/);
  assert.match(v.textContent, /#7 revision 2/);
  const chips = tree(v).filter((e) => /chip/.test(cls(e)));
  assert.deepEqual(chips.map((c) => c.textContent.replace(/^\S+\s/, '')), ['done', 'pending']);
  assert.notEqual(chips[0].textContent, chips[1].textContent);
  assert.ok(chips.every((c) => /^[●○▲]/.test(c.textContent)));
});

test('an unknown page shows a teaching not-found state, not an error panel', async () => {
  const { env } = await boot('#/skill/ghost', { '/api/wiki/page': undefined });
  const v = view(env);
  assert.match(v.textContent, /No skill page/);
  assert.match(v.textContent, /ghost/);
  assert.ok(hrefs(v).includes('#/home'));
  assert.ok(!/^Error/.test(v.textContent));
});

test('unknown routes and not-yet-built pages render designed placeholders', async () => {
  let { env } = await boot('#/bogus/1');
  assert.match(view(env).textContent, /not a wiki page/i);
  ({ env } = await boot('#/settings'));
  assert.match(view(env).textContent, /Settings/);
  assert.match(view(env).textContent, /preview/i);
  assert.equal(env.calls.filter((c) => String(c.url).startsWith('/api/wiki/page')).length, 0);
});

test('hash changes navigate (back and forward re-render from the hash) and deep links work on first load', async () => {
  const { env } = await boot('#/session/s1');
  assert.ok(env.calls.some((c) => c.url === '/api/wiki/page?kind=session&id=s1'));
  env.location.hash = '#/node/repo%3A%3Aa';
  env.listeners.hashchange();
  await tick();
  assert.ok(env.calls.some((c) => c.url === '/api/wiki/page?kind=node&id=repo%3A%3Aa'), env.calls.map((c) => c.url).join('\n'));
  env.location.hash = '#/settings';
  env.listeners.hashchange();
  await tick();
  assert.match(view(env).textContent, /Settings/);
});

test('existing views stay reachable as pages: legacy hashes, list routes and usage links', async () => {
  let { env } = await boot('#/skill');
  const usageLinks = hrefs(view(env));
  assert.ok(usageLinks.includes('#/skill/work-unit-commits'), usageLinks.join(' '));
  ({ env } = await boot('#/feature'));
  assert.ok(hrefs(view(env)).includes('#/feature/feat'));
  ({ env } = await boot('#/home'));
  assert.match(view(env).textContent, /No usage data yet/);
});

test('the sidebar lists every section, marks the current page and shows recent changes as links', async () => {
  const { env } = await boot('#/memory');
  const nav = env.document.getElementById('nav');
  const links = tree(nav).filter((e) => e.tagName === 'a');
  const byHref = Object.fromEntries(links.map((a) => [a.getAttribute('href'), a]));
  for (const h of ['#/home', '#/memory', '#/skill', '#/tool', '#/mcp', '#/session', '#/feature', '#/node', '#/harness', '#/usage', '#/diagrams', '#/settings']) assert.ok(byHref[h], h);
  assert.equal(byHref['#/memory'].getAttribute('aria-current'), 'page');
  assert.equal(byHref['#/home'].getAttribute('aria-current'), undefined);
  const recent = env.document.getElementById('recent');
  assert.ok(hrefs(recent).includes('#/memory/7'));
  assert.ok(hrefs(recent).includes('#/session/s1'));
  assert.match(recent.textContent, /memory saved/);
  assert.equal(tree(recent).filter((e) => e.tagName === 'img').length, 0);
});

test('recent changes degrade to a teaching message, never to an error or an unhandled rejection', async () => {
  const seen = [];
  const on = (r) => seen.push(r);
  process.on('unhandledRejection', on);
  try {
    let { env } = await boot('#/settings', { '/api/wiki/recent': undefined });
    assert.match(env.document.getElementById('recent').textContent, /unavailable/);
    ({ env } = await boot('#/settings', { '/api/wiki/recent': { items: [] } }));
    assert.match(env.document.getElementById('recent').textContent, /appear here/);
  } finally { process.off('unhandledRejection', on); }
  assert.deepEqual(seen, []);
});

test('Ctrl+K and / open the search palette; / is ignored while typing in a field', async () => {
  const { env, opened } = await boot('#/settings');
  assert.equal(key(env, { key: 'k', ctrlKey: true }), true);
  assert.equal(key(env, { key: 'K', metaKey: true }), true);
  assert.equal(key(env, { key: '/' }), true);
  assert.deepEqual(opened, ['open', 'open', 'open']);
  assert.equal(key(env, { key: '/', target: { tagName: 'input' } }), false);
  assert.equal(key(env, { key: '/', target: { tagName: 'select' } }), false);
  assert.equal(key(env, { key: '/', ctrlKey: true }), false);
  assert.equal(key(env, { key: 'a' }), false);
  env.document.getElementById('search-open').click();
  assert.equal(opened.length, 4);
});

async function type(env, text) {
  const input = env.document.getElementById('palette-input');
  input.value = text;
  for (const fn of input.listeners.input ?? []) fn({ target: input });
  await tick(250);
  return input;
}
const press = (input, k) => { let prevented = false; for (const fn of input.listeners.keydown ?? []) fn({ key: k, preventDefault: () => { prevented = true; } }); return prevented; };

test('typing searches (debounced), shows grouped results with text kind labels and counts, all hostile data as text', async () => {
  const { env } = await boot('#/settings');
  env.calls.length = 0;
  await type(env, 'wid');
  const searches = env.calls.filter((c) => String(c.url).startsWith('/api/wiki/search'));
  assert.equal(searches.length, 1);
  assert.equal(searches[0].url, '/api/wiki/search?q=wid');
  const results = env.document.getElementById('palette-results');
  const text = results.textContent;
  assert.match(text, /skill \(1\)/);
  assert.match(text, /memory \(2\)/);
  assert.ok(text.includes(XSS));
  const options = tree(results).filter((e) => e.attrs.role === 'option');
  assert.equal(options.length, 3);
  assert.ok(options.every((o) => /^(skill|memory)/.test(o.children[0].textContent)), 'each option starts with its kind label');
  assert.equal(tree(results).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(tree(results).every((e) => Object.keys(e.attrs).every((k) => !k.startsWith('on'))));
});

test('arrow keys move the selection (wrapping) and Enter opens the selected page', async () => {
  const { env, opened } = await boot('#/settings');
  const input = await type(env, 'wid');
  const options = () => tree(env.document.getElementById('palette-results')).filter((e) => e.attrs.role === 'option');
  assert.equal(options()[0].getAttribute('aria-selected'), 'true');
  assert.equal(press(input, 'ArrowDown'), true);
  assert.equal(options()[1].getAttribute('aria-selected'), 'true');
  assert.equal(options()[0].getAttribute('aria-selected'), 'false');
  assert.equal(input.getAttribute('aria-activedescendant'), options()[1].id ?? options()[1].getAttribute('id'));
  press(input, 'ArrowUp');
  press(input, 'ArrowUp');
  assert.equal(options()[2].getAttribute('aria-selected'), 'true'); // wrapped to the last
  press(input, 'Enter');
  assert.equal(env.location.hash, '#/memory/8');
  assert.ok(opened.includes('close'));
});

test('clicking a result navigates; stale responses and empty or failing searches are handled inline', async () => {
  const { env } = await boot('#/settings');
  await type(env, 'wid');
  const first = tree(env.document.getElementById('palette-results')).find((e) => e.attrs.role === 'option');
  first.click();
  assert.equal(env.location.hash, '#/skill/work-unit-commits');
  const results = env.document.getElementById('palette-results');
  await type(env, '   ');
  assert.match(results.textContent, /Type to search/);
  const { env: e2 } = await boot('#/settings', { '/api/wiki/search': { q: 'zzz', groups: [] } });
  await type(e2, 'zzz');
  assert.match(e2.document.getElementById('palette-results').textContent, /No results for/);
  const { env: e3 } = await boot('#/settings', { '/api/wiki/search': undefined });
  await type(e3, 'boom');
  assert.match(e3.document.getElementById('palette-results').textContent, /Search failed/);
  assert.equal(press(e3.document.getElementById('palette-input'), 'Enter'), false);
});

test('static: dialog, scripts in order, fonts, tokens, reduced motion, and none of the banned patterns', async () => {
  const html = await read('index.html');
  const css = await read('style.css');
  assert.match(html, /<dialog id="palette"/);
  const order = [...html.matchAll(/<script src="\/static\/([\w.]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['markdown.js', 'wikiroute.js', 'app.js']);
  assert.match(html, /<main id="view"/);
  assert.match(html, /<nav class="sidebar"[^>]*aria-label/);
  assert.match(css, /@font-face\s*{[^}]*Source Serif 4[^}]*\/static\/fonts\/source-serif-4-latin-400-normal\.woff2/);
  assert.equal([...css.matchAll(/@font-face/g)].length, 3);
  for (const token of ['--bg', '--surface', '--sidebar', '--ink', '--ink-muted', '--line', '--accent', '--accent-soft', '--warn', '--ok', '--c-input', '--c-output', '--c-cache-read', '--c-cache-write']) assert.match(css, new RegExp(`${token}:\\s*oklch\\(`), token);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /cubic-bezier\(0\.25,\s*1,\s*0\.5,\s*1\)/);
  assert.match(css, /:focus-visible\s*{[^}]*outline:\s*2px solid var\(--accent\)[^}]*outline-offset:\s*2px/);
  assert.match(css, /max-width:\s*68ch/);
  assert.match(css, /\.skeleton|\.sk\b/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  for (const [name, pattern] of [['gradient', /gradient\(/], ['gradient text', /background-clip:\s*text/], ['side stripe', /border-(left|right):\s*[2-9]\d*px\s+solid/], ['uppercase eyebrow', /text-transform:\s*uppercase/]]) assert.doesNotMatch(css, pattern, name);
  assert.doesNotMatch(css, /#f7f7f5|cream|beige/i);
  for (const z of ['10', '20', '30', '40', '50', '60']) assert.match(css, new RegExp(`z-index:\\s*(var\\(--z-\\w+\\)|${z})`));
});

// ---- entity pages (W6-W11) ---------------------------------------------------------------------------------
test('diffRow, progress and dailyBars are pure and tolerate junk', () => {
  assert.deepEqual(plain(R.diffRow({ op: '+', text: 'x' })), { mark: '+ ', name: 'add', text: 'x' });
  assert.deepEqual(plain(R.diffRow({ op: '-', text: 'y' })), { mark: '- ', name: 'del', text: 'y' });
  assert.equal(R.diffRow({ op: '=', text: '4 unchanged lines' }).name, 'gap');
  assert.deepEqual(plain(R.diffRow({ op: '?', text: 1 })), { mark: '  ', name: 'same', text: '1' });
  assert.deepEqual(plain(R.diffRow(null)), { mark: '  ', name: 'same', text: '' });
  assert.deepEqual(plain(R.progress(2, 3)), { percent: 67, label: '2 of 3 done' });
  assert.deepEqual(plain(R.progress(0, 0)), { percent: 0, label: '0 of 0 done' });
  assert.equal(R.progress(9, 3).percent, 100);
  assert.equal(R.progress('x', -1).label, '0 of 0 done');
  const bars = plain(R.dailyBars([{ day: 'a', value: 0 }, { day: 'b', value: 5 }, { day: 'c', value: 10 }], 30, 20));
  assert.deepEqual(bars.map((b) => b.height), [0, 10, 20]);
  assert.equal(bars[2].y, 0);
  assert.ok(bars.every((b) => b.x >= 0 && b.x + b.width <= 30));
  assert.equal(R.dailyBars([{ day: 'a', value: 1 }, { day: 'b', value: 1000000 }], 10, 10)[0].height, 1);
  assert.deepEqual(plain(R.dailyBars(undefined, 10, 10)), []);
});

test('a memory page shows the revision-history note when the store keeps only the latest revision', async () => {
  const { env } = await boot('#/memory/7', { '/api/wiki/page': { ...PAGE, history: { available: false, note: 'This store keeps the latest revision only: overwritten.', revisions: [], diffs: [] } } });
  const v = view(env);
  assert.ok(tree(v).some((e) => e.tagName === 'h2' && e.textContent === 'Revision history'));
  assert.match(v.textContent, /latest revision only/);
  assert.equal(tree(v).filter((e) => /diff-line/.test(cls(e))).length, 0);
});

test('revision history renders the list and diff lines with marks, hostile text stays text', async () => {
  const history = { available: true, note: '2 earlier revision(s)', revisions: [{ revision: 1, title: 'v1', updated_at: 'a' }, { revision: 2, title: XSS, updated_at: 'b' }],
    diffs: [{ from: 1, to: 2, lines: [{ op: ' ', text: 'one' }, { op: '-', text: 'two' }, { op: '+', text: XSS }, { op: '=', text: '4 unchanged lines' }] }] };
  const { env } = await boot('#/memory/7', { '/api/wiki/page': { ...PAGE, history } });
  const v = view(env);
  const lines = tree(v).filter((e) => /diff-line/.test(cls(e)));
  assert.deepEqual(lines.map((l) => l.textContent), ['  one', '- two', `+ ${XSS}`, '... 4 unchanged lines']);
  assert.deepEqual(lines.map((l) => cls(l).replace('diff-line ', '')), ['diff-same', 'diff-del', 'diff-add', 'diff-gap']);
  assert.match(v.textContent, /Revision 1 to 2/);
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0);
});
