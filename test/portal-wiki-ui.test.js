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
  for (const k of ['usage', 'harness']) assert.deepEqual(plain(R.parseHash('#' + k)), { kind: k, id: '' });
  for (const h of ['#diagrams', '#/diagrams']) assert.deepEqual(plain(R.parseHash(h)), { kind: 'harness', id: '' }, h); // the removed Diagrams page redirects
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
  '/api/settings': { installed: true, current: { persona: 'gentleman', review_mode: 'off', telemetry: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } }, allowed: {}, undo: { available: false } },
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

test('unknown routes render a designed placeholder and the settings route renders the editor', async () => {
  let { env } = await boot('#/bogus/1');
  assert.match(view(env).textContent, /not a wiki page/i);
  ({ env } = await boot('#/settings'));
  assert.match(view(env).textContent, /Settings/);
  assert.match(view(env).textContent, /Preview changes/);
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
  let { env } = await boot('#/skill', { '/api/skills': { total: 1, groups: [{ source: 'user', label: 'Your skills', items: [{ id: 'work-unit-commits', source: 'user', description: null, trigger: null, uses: 1, sessions: 1, last_used: 'x' }] }] } });
  const usageLinks = hrefs(view(env));
  assert.ok(usageLinks.includes('#/skill/work-unit-commits'), usageLinks.join(' '));
  ({ env } = await boot('#/feature'));
  assert.ok(hrefs(view(env)).includes('#/feature/r%2Ffeat'), 'feature links are project-qualified');
  ({ env } = await boot('#/usage'));
  assert.match(view(env).textContent, /No usage data yet/);  // the old overview stays reachable under #/usage
});

test('the sidebar lists every section, marks the current page and shows recent changes as links', async () => {
  const { env } = await boot('#/memory');
  const nav = env.document.getElementById('nav');
  const links = tree(nav).filter((e) => e.tagName === 'a');
  const byHref = Object.fromEntries(links.map((a) => [a.getAttribute('href'), a]));
  for (const h of ['#/home', '#/memory', '#/skill', '#/tool', '#/mcp', '#/session', '#/feature', '#/node', '#/harness', '#/usage', '#/settings']) assert.ok(byHref[h], h);
  assert.equal(byHref['#/diagrams'], undefined, 'no Diagrams entry in the sidebar');
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

test('a skill page draws usage over time as bars with a text summary, or says nothing was recorded', async () => {
  const daily = Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, value: i === 29 ? 3 : 0 }));
  let { env } = await boot('#/skill/work-unit-commits', { '/api/wiki/page': { ...PAGE, kind: 'skill', id: 'work-unit-commits', usage: { daily, days: 30 } } });
  const v = view(env);
  assert.ok(tree(v).some((e) => e.tagName === 'h2' && e.textContent === 'Usage over time'));
  assert.match(v.textContent, /3 calls in the 30 days up to 2026-09-30/);
  const rects = tree(v).filter((e) => e.tagName === 'rect');
  assert.equal(rects.length, 30);
  assert.ok(rects.every((r) => Number.isFinite(Number(r.getAttribute('height')))));
  const svgEl = tree(v).find((e) => e.tagName === 'svg');
  assert.match(svgEl.getAttribute('aria-label'), /Calls per day/);
  ({ env } = await boot('#/skill/idle', { '/api/wiki/page': { ...PAGE, kind: 'skill', id: 'idle', usage: { daily: [], days: 30 } } }));
  assert.match(view(env).textContent, /No calls recorded yet/);
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'rect').length, 0);
});

test('a feature page shows progress with a bar, a count and shape-labelled chips, and only resolved commits', async () => {
  const pg = { ...PAGE, sections: [], kind: 'feature', id: 'feat', title: 'Feature', body_md: 'text', progress: { done: 2, total: 3, percent: 67 },
    commits: [{ hash: '15fd38b', full: 'x'.repeat(40), subject: XSS, date: '2026-10-16T12:00:00+00:00' }] };
  const { env } = await boot('#/feature/feat', { '/api/wiki/page': pg });
  const v = view(env);
  const bar = tree(v).find((e) => e.tagName === 'progress');
  assert.equal(bar.getAttribute('value'), '2');
  assert.equal(bar.getAttribute('max'), '3');
  assert.match(v.textContent, /2 of 3 done \(67%\)/);
  const chips = tree(v).filter((e) => /chip/.test(cls(e)) && /^[●○]/.test(e.textContent));
  assert.deepEqual(chips.map((c) => c.textContent), ['● done', '○ pending']);
  assert.ok(tree(v).some((e) => e.tagName === 'h2' && e.textContent === 'Commits'));
  assert.ok(tree(v).some((e) => e.tagName === 'code' && e.textContent === '15fd38b'));
  assert.ok(v.textContent.includes(XSS));
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0);
});

test('a feature page draws the task grid once and notes a capped document; a node page keeps its own diagram', async () => {
  const pg = { ...PAGE, sections: [], kind: 'feature', id: 'feat', title: 'Feature', body_md: 'text', progress: { done: 1, total: 90, percent: 1 }, commits: [],
    diagram: { source: 'flowchart TB\n  s0(["x"])', tasks: 90, shown: 60 } };
  let { env } = await boot('#/feature/feat', { '/api/wiki/page': pg });
  const v = view(env);
  assert.ok(tree(v).some((e) => e.tagName === 'h2' && e.textContent === 'Task grid'));
  assert.equal(tree(v).filter((e) => /diagram/.test(cls(e))).length, 1);
  assert.match(v.textContent, /Showing the first 60 of 90 tasks/);
  assert.ok(!tree(v).some((e) => e.tagName === 'h2' && e.textContent === 'Neighborhood'));
  ({ env } = await boot('#/feature/feat', { '/api/wiki/page': { ...pg, diagram: null } }));
  assert.ok(!tree(view(env)).some((e) => e.tagName === 'h2' && e.textContent === 'Task grid'));
});

test('the Harness page embeds archify in a sandboxed iframe on its own route, and falls back to Mermaid with the reason', async () => {
  const url = '/archify/' + 'a'.repeat(64) + '.html';
  const harness = { '/api/harness': { installed: true, version: '1', hooks: [], mcp_servers: [], components: [], managed_files: 0, telemetry: false, rdd_mode: 'on', persona: 'neutral' } };
  let { env } = await boot('#/harness', { ...harness, '/api/archify': { installed: true, available: true, url, components: 12, fallback: 'flowchart LR\n  n0["A"]' } });
  let frames = tree(view(env)).filter((e) => e.tagName === 'iframe');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].getAttribute('src'), url);
  assert.equal(frames[0].getAttribute('sandbox'), 'allow-scripts'); // never allow-same-origin
  assert.match(view(env).textContent, /12 components drawn by archify/);
  assert.equal(tree(view(env)).filter((e) => /diagram/.test(cls(e))).length, 0);
  ({ env } = await boot('#/harness', { ...harness, '/api/archify': { installed: true, available: true, url: 'https://evil.example/x.html', components: 1, fallback: 'flowchart LR\n  n0["A"]' } }));
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'iframe').length, 0, 'only our own route is ever framed');
  ({ env } = await boot('#/harness', { ...harness, '/api/archify': { installed: true, available: false, reason: XSS, fallback: 'flowchart LR\n  n0["A"]' } }));
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'iframe').length, 0);
  assert.equal(tree(view(env)).filter((e) => /diagram/.test(cls(e))).length, 1);
  assert.ok(view(env).textContent.includes(XSS));
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'img').length, 0);
});

test('a feature without commits or progress adds neither block; an empty task list does not divide by zero', async () => {
  let { env } = await boot('#/feature/feat', { '/api/wiki/page': { ...PAGE, kind: 'feature', progress: { done: 0, total: 0, percent: 0 }, commits: [] } });
  assert.ok(!tree(view(env)).some((e) => e.tagName === 'h2' && e.textContent === 'Commits'));
  assert.match(view(env).textContent, /0 of 0 done \(0%\)/);
  ({ env } = await boot('#/memory/7'));
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'progress').length, 0);
});

test('a graph node page draws its neighborhood diagram lazily and notes truncation', async () => {
  const pg = { ...PAGE, kind: 'node', id: 'repo::a', diagram: { source: 'flowchart LR\n  a --> b', nodes: 45, edges: 60, truncated: true } };
  const { env } = await boot('#/node/repo%3A%3Aa', { '/api/wiki/page': pg });
  const v = view(env);
  assert.ok(tree(v).some((e) => e.tagName === 'h2' && e.textContent === 'Neighborhood'));
  assert.ok(tree(v).some((e) => /diagram/.test(cls(e))));
  assert.match(v.textContent, /nearest 30 of 45 nodes/);
  const none = await boot('#/node/repo%3A%3Aa', { '/api/wiki/page': { ...PAGE, kind: 'node', diagram: { source: null, nodes: 0, edges: 0, truncated: false } } });
  assert.ok(!tree(view(none.env)).some((e) => e.tagName === 'h2' && e.textContent === 'Neighborhood'));
});

const HOME = {
  activity: [{ day: '2026-10-02', items: [{ kind: 'memory', id: '7', title: XSS, ts: '2026-10-02T10:00:00Z', what: 'memory saved' }, { kind: 'session', id: 's1', title: 'alpha · Fix it · 2026-10-02', ts: '2026-10-02T09:00:00Z', what: 'session, 2 messages' }] },
    { day: '2026-10-01', items: [{ kind: 'feature', id: 'feat', title: 'feat', ts: '2026-10-01T08:00:00Z', what: 'ODD document updated' }] }],
  spending: { available: true, windows: [{ days: 7, input: 160, output: 85, cache_read: 900, cache_write: 150 }, { days: 30, input: 1600, output: 850, cache_read: 9000, cache_write: 1500 }], cache_hit_ratio: 0.75, top_models: [{ model: XSS, tokens: 12000 }] },
  health: { installed: true, version: '0.1.0', hooks: 3, mcp_servers: 2, skills: 12, agents: 4, telemetry: true },
};

test('home: recent activity grouped by day is the main column; spending and health sit in the rail without metric tiles', async () => {
  const { env } = await boot('#/home', { '/api/wiki/home': HOME });
  const v = view(env);
  assert.ok(env.calls.some((c) => c.url === '/api/wiki/home'));
  assert.deepEqual(tree(v).filter((e) => e.tagName === 'h2' && /^\d{4}-/.test(e.textContent)).map((e) => e.textContent), ['2026-10-02', '2026-10-01']);
  const links = hrefs(v);
  for (const h of ['#/memory/7', '#/session/s1', '#/feature/feat', '#/usage', '#/harness']) assert.ok(links.includes(h), h);
  assert.ok(v.textContent.includes(XSS));
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(!tree(v).some((e) => /\bcard\b|\bgrid\b/.test(cls(e))), 'no hero-metric tiles');
  const rail = tree(v).find((e) => e.tagName === 'aside');
  assert.match(rail.textContent, /Spending/);
  assert.match(rail.textContent, /7 days/);
  assert.match(rail.textContent, /30 days/);
  assert.match(rail.textContent, /75\.0%/);
  assert.match(rail.textContent, /Harness health/);
  assert.match(rail.textContent, /Hooks/);
  assert.ok(!tree(rail).some((e) => e.tagName === 'h2' && /^\d{4}-/.test(e.textContent)), 'activity is not in the rail');
  assert.equal(env.document.getElementById('filters').hidden, true);
});

test('home teaches when there is no activity, no usage data and no install', async () => {
  const empty = { activity: [], spending: { available: false, windows: [], cache_hit_ratio: null, top_models: [] }, health: { installed: false } };
  const { env } = await boot('#/home', { '/api/wiki/home': empty });
  const t = view(env).textContent;
  assert.match(t, /appear here/);
  assert.match(t, /Refresh usage/);
  assert.match(t, /not installed/);
});

// ---- skill impact (W22) ------------------------------------------------------------------------------------
test('impact helpers: shape plus words for direction, never color alone; units per metric', () => {
  assert.deepEqual(plain(R.deltaMark({ suppressed: true, delta: null, verdict: null })), { mark: '–', text: 'not enough data', name: 'na' });
  assert.deepEqual(plain(R.deltaMark({ suppressed: false, delta: -0.2, verdict: 'better' })), { mark: '▼', text: 'lower, better', name: 'better' });
  assert.deepEqual(plain(R.deltaMark({ suppressed: false, delta: 0.2, verdict: 'worse' })), { mark: '▲', text: 'higher, worse', name: 'worse' });
  assert.deepEqual(plain(R.deltaMark({ suppressed: false, delta: 0.001, verdict: 'no clear difference' })), { mark: '■', text: 'no clear difference', name: 'flat' });
  assert.equal(R.fmtMetric('error_rate', 0.125), '12.5%');
  assert.equal(R.fmtMetric('tokens_per_turn', 123.4), '123 tokens');
  assert.equal(R.fmtMetric('error_rate', null), 'n/a');
  assert.equal(R.fmtDelta('error_rate', 0.15), '+15.0 pp');
  assert.equal(R.fmtDelta('error_rate', -0.0333), '-3.3 pp');
  assert.equal(R.fmtDelta('tokens_per_turn', -40.2), '-40 tokens');
  assert.equal(R.fmtDelta('error_rate', null), '');
});

const mk = (label, e, b, extra = {}) => ({ label, kind: 'rate', suppressed: false, reason: null, exposed: { value: e, n: 25, sessions: 5 }, baseline: { value: b, n: 30, sessions: 6 }, delta: e - b, verdict: e < b ? 'better' : 'worse', ...extra });
const IMPACT = {
  available: true, days: 30, outcomes_recorded: true, note: 'Correlation, not causation: sessions that load a skill differ in other ways too.', min_sessions: 5,
  exposed_sessions: 5, control_sessions: 6, control_scope: 'same-project',
  metrics: {
    error_rate: mk('Tool error rate after load', 0.04, 0.2), retry_rate: mk('Retry proxy after an error', 0.5, 0.1),
    tokens_per_turn: { ...mk('Output tokens per assistant turn', 100, 100), kind: 'mean', verdict: 'no clear difference', delta: 0 },
    test_failure_rate: { ...mk('Test-command failure rate', null, null), suppressed: true, reason: 'no data on one side', delta: null, verdict: null, exposed: { value: null, n: 0, sessions: 0 }, baseline: { value: null, n: 3, sessions: 2 } },
    unused_after_load: { label: 'Loaded but unused', kind: 'rate', suppressed: false, reason: null, unused: 1, n: 5, value: 0.2 },
  },
  changes: {
    versions: [{ hash: 'b'.repeat(12), first_seen: '2026-10-05T00:00:00Z', current: true }, { hash: 'a'.repeat(12), first_seen: '2026-10-01T00:00:00Z', current: false }],
    commits: [{ hash: 'abc1234', date: '2026-10-03T12:00:00+00:00', subject: XSS }],
    changes: [
      { kind: 'installed', ts: '2026-10-05T00:00:00', when: '2026-10-05T00:00:00Z', label: 'b'.repeat(12), before_sessions: 5, after_sessions: 6, suppressed: false, reason: null,
        metrics: { error_rate: { label: 'Tool error rate after load', before: 0.3, after: 0.1, n_before: 20, n_after: 30, delta: -0.2, verdict: 'better' } } },
      { kind: 'commit', ts: '2026-10-03T12:00:00', when: '2026-10-03T12:00:00+00:00', label: `abc1234 ${XSS}`, before_sessions: 2, after_sessions: 9, suppressed: true, reason: 'fewer than 5 loaded sessions before or after',
        metrics: { error_rate: { label: 'Tool error rate after load', before: null, after: null, n_before: 8, n_after: 40, delta: null, verdict: null } } },
    ],
  },
};
const impactHeading = (v) => tree(v).find((e) => e.tagName === 'h2' && e.textContent === 'Impact (comparative)');

test('a skill page shows the comparative impact table with n, text+shape verdicts, the change log and the correlation note', async () => {
  const { env } = await boot('#/skill/work-unit-commits', { '/api/wiki/page': { ...PAGE, kind: 'skill', id: 'work-unit-commits', usage: { daily: [], days: 30 }, impact: IMPACT } });
  const v = view(env);
  assert.ok(impactHeading(v));
  const t = v.textContent;
  assert.match(t, /Correlation, not causation: sessions that load a skill differ in other ways too\./);
  assert.match(t, /5 sessions loaded this skill in the last 30 days; 6 sessions without it .*same project/);
  const rows = tree(v).filter((e) => e.tagName === 'tr');
  const text = rows.map((r) => r.textContent);
  const errRow = text.find((x) => /Tool error rate after load/.test(x));
  assert.match(errRow, /4\.0%/); assert.match(errRow, /20\.0%/); assert.match(errRow, /▼ lower, better/); assert.match(errRow, /25/); assert.match(errRow, /30/);
  assert.match(text.find((x) => /Retry proxy/.test(x)), /▲ higher, worse/);
  assert.match(text.find((x) => /Output tokens/.test(x)), /■ no clear difference/);
  const supp = text.find((x) => /Test-command failure rate/.test(x));
  assert.match(supp, /– not enough data/); assert.match(supp, /no data on one side/);
  assert.match(t, /Loaded but unused: 1 of 5 loaded sessions \(20\.0%\)/);
  assert.ok(tree(v).some((e) => e.tagName === 'h3' && e.textContent === 'Change log'));
  assert.match(t, /Installed version bbbbbbbbbbbb/);
  assert.match(t, /Tool error rate after load: 30\.0% to 10\.0%/);
  assert.match(t, /fewer than 5 loaded sessions before or after/);
  assert.ok(t.includes(XSS), 'untrusted subjects are shown as text');
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(!tree(v).some((e) => /\bcard\b/.test(cls(e))), 'no hero tiles');
});

test('a skill page says outcomes are not recorded yet, or that the skill was not loaded in the window, instead of showing empty numbers', async () => {
  let { env } = await boot('#/skill/s', { '/api/wiki/page': { ...PAGE, kind: 'skill', id: 's', impact: { ...IMPACT, outcomes_recorded: false } } });
  assert.match(view(env).textContent, /Tool outcomes are not recorded yet/);
  ({ env } = await boot('#/skill/s', { '/api/wiki/page': { ...PAGE, kind: 'skill', id: 's', impact: { ...IMPACT, exposed_sessions: 0, control_sessions: 4 } } }));
  assert.match(view(env).textContent, /not loaded in the last 30 days/);
  assert.ok(!tree(view(env)).some((e) => e.tagName === 'table' && /after load/.test(e.textContent)));
  ({ env } = await boot('#/skill/s', { '/api/wiki/page': { ...PAGE, kind: 'skill', id: 's', impact: { available: false, reason: 'no usage data yet', note: IMPACT.note } } }));
  assert.match(view(env).textContent, /no usage data yet/);
  ({ env } = await boot('#/tool/Bash', { '/api/wiki/page': { ...PAGE, kind: 'tool', id: 'Bash' } }));
  assert.ok(!impactHeading(view(env)));
});

const RANK = { available: true, days: 30, min_sessions: 5, tracked: 7, ranked: 3, note: IMPACT.note,
  best: [{ skill: 'good-skill', delta: -0.16, exposed: 0.04, baseline: 0.2, n: 25, sessions: 5, verdict: 'better' }],
  worst: [{ skill: XSS, delta: 0.3, exposed: 0.5, baseline: 0.2, n: 40, sessions: 8, verdict: 'worse' }] };

test('home rail ranks skills by error-rate delta with n, linking to skill pages, shapes plus words, correlation note, no tiles', async () => {
  const { env } = await boot('#/home', { '/api/wiki/home': { ...HOME, impact: RANK } });
  const rail = tree(view(env)).find((e) => e.tagName === 'aside');
  assert.match(rail.textContent, /Skill impact/);
  assert.match(rail.textContent, /▼ good-skill/); assert.match(rail.textContent, /-16\.0 pp/); assert.match(rail.textContent, /25 calls, 5 sessions/);
  assert.ok(rail.textContent.includes(`▲ ${XSS}`));
  assert.match(rail.textContent, /3 of 7 skills have enough sessions/);
  assert.match(rail.textContent, /Correlation, not causation/);
  assert.ok(hrefs(rail).includes('#/skill/good-skill'));
  assert.ok(hrefs(rail).includes(R.formatHash('skill', XSS)));
  assert.ok(!tree(view(env)).some((e) => /\bcard\b/.test(cls(e))));
});

test('home rail explains an empty ranking and tolerates an older server without impact', async () => {
  let { env } = await boot('#/home', { '/api/wiki/home': { ...HOME, impact: { ...RANK, best: [], worst: [], ranked: 0 } } });
  assert.match(tree(view(env)).find((e) => e.tagName === 'aside').textContent, /No skill has 5 or more sessions with and without it yet/);
  ({ env } = await boot('#/home', { '/api/wiki/home': { ...HOME, impact: { available: false, note: RANK.note } } }));
  assert.ok(!/Skill impact/.test(tree(view(env)).find((e) => e.tagName === 'aside').textContent));
  ({ env } = await boot('#/home', { '/api/wiki/home': HOME }));
  assert.ok(!/Skill impact/.test(tree(view(env)).find((e) => e.tagName === 'aside').textContent));
});
