// Knowledge pages (portal redesign T4): memory tabs (Memories, Memory files, Quality) and the single Graph explorer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const view = (env) => env.document.getElementById('view');
const plain = (x) => JSON.parse(JSON.stringify(x));
const ctx = {};
vm.runInNewContext(await readFile(path.join(STATIC, 'wikiroute.js'), 'utf8'), ctx);
const R = ctx.AmautaRoute;

const OWN = { source: 'own', available: true, items: [{ id: 1, title: 'Own one', type: 'note', project: 'p', topic_key: 'k', revision: 1, updated_at: '2026-10-01T10:00:00Z' }], facets: { types: ['note'] } };
const ENGRAM = { source: 'engram', available: true, items: [{ id: 5, title: 'Engram one', type: 'bugfix', project: 'p', topic_key: 't', revision: 3, updated_at: '2026-09-02T00:00:00Z' }], facets: { types: [] } };
const FILES = { items: [{ id: 'a/memory/n.md', name: 'n.md', project: 'a', size: 3, mtime: '2026-10-01T10:00:00Z' }] };
const GRAPH = { repos: [
  { name: 'one', path: '/r/one', available: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z', graph_mtime: '2026-10-13T00:00:00Z' },
  { name: 'two', path: '/r/two', available: true, nodes: 2, edges: 1, synced_at: '2026-10-14T00:00:00Z', graph_mtime: '2026-10-13T00:00:00Z' },
  { name: 'three', path: '/r/three', available: false, reason: 'not mirrored yet' }] };
async function boot(hash, over = {}) {
  const env = makeEnv({
    '/api/memories': (opts, url) => (String(url).includes('source=engram') ? ENGRAM : OWN), '/api/memory-files': FILES, '/api/graphify': GRAPH,
    '/api/graph/nodes': (opts, url) => ({ available: true, items: [{ id: 'a', label: String(url).includes('two') ? 'TwoNode' : 'OneNode', kind: 'code', file: 'f' }] }),
    '/api/projects': { projects: [] }, '/api/wiki/lint': { scanned: { memories: 3 }, categories: [] }, '/api/sessions': { available: false }, ...over,
  });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}
const go = async (env, hash) => { env.location.hash = hash; env.listeners.hashchange(); await tick(); };
const calls = (env, p) => env.calls.filter((c) => String(c.url).startsWith(p));

test('the memory source lives in the URL: ?source=engram reads Engram and the switch is a pair of links', async () => {
  const env = await boot('#/memory?source=engram');
  assert.match(view(env).textContent, /Engram one/);
  assert.ok(calls(env, '/api/memories').every((c) => /source=engram/.test(c.url)));
  const sw = tree(view(env)).filter((e) => e.tagName === 'a' && e.getAttribute('aria-current') === 'true');
  assert.deepEqual(sw.map((a) => a.getAttribute('href')), ['#/memory?source=engram']);
  assert.ok(tree(view(env)).some((e) => e.tagName === 'a' && e.getAttribute('href') === '#/memory' && e.getAttribute('aria-current') == null));
  await go(env, '#/memory');
  assert.match(view(env).textContent, /Own one/);
});

test('memory search filters as you type (debounced), Enter searches at once, and there is no Search button', async () => {
  const env = await boot('#/memory');
  assert.ok(!tree(view(env)).some((e) => e.tagName === 'button' && e.textContent === 'Search'), 'no Search button');
  const q = tree(view(env)).find((e) => e.tagName === 'input' && e.attrs.type === 'search');
  env.calls.length = 0;
  q.value = 'ab';
  for (const fn of q.listeners.input ?? []) fn({ target: q });
  q.value = 'abc';
  for (const fn of q.listeners.input ?? []) fn({ target: q });
  await tick(60);
  assert.equal(calls(env, '/api/memories').length, 0, 'waits for a pause in typing');
  await tick(250);
  assert.deepEqual(calls(env, '/api/memories').map((c) => /q=abc/.test(c.url)), [true], 'one request with the last text');
  env.calls.length = 0;
  q.value = 'x';
  for (const fn of q.listeners.keydown ?? []) fn({ key: 'Enter', preventDefault() {} });
  await tick();
  assert.equal(calls(env, '/api/memories').length, 1);
});

test('the Memories tab shows only memories: no graph panel and no memory-files table', async () => {
  const env = await boot('#/memory');
  assert.equal(calls(env, '/api/graphify').length, 0);
  assert.equal(calls(env, '/api/memory-files').length, 0);
  assert.doesNotMatch(view(env).textContent, /Graph memory|n\.md/);
});

test('with no memories and no query the Memories tab teaches how memories are saved', async () => {
  const env = await boot('#/memory', { '/api/memories': { source: 'own', available: true, items: [], facets: { types: [] } } });
  assert.match(view(env).textContent, /mem_save/);
});

test('the Memory files tab shows only the memory-files table', async () => {
  const env = await boot('#/memfile');
  assert.equal(calls(env, '/api/memories').length, 0);
  assert.ok(tree(view(env)).some((e) => e.tagName === 'a' && e.getAttribute('href') === '#/memfile/a%2Fmemory%2Fn.md'));
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'h1').map((e) => e.textContent).join('|'), 'Memory files');
  const none = await boot('#/memfile', { '/api/memory-files': { items: [] } });
  assert.match(view(none).textContent, /MEMORY\.md/, 'the empty state says where file memories come from');
});

test('the Quality tab is titled Memory quality and says its items are review prompts, never verdicts', async () => {
  const env = await boot('#/lint');
  assert.equal(tree(view(env)).find((e) => e.tagName === 'h1').textContent, 'Memory quality');
  assert.match(view(env).textContent, /review prompts, never verdicts/);
});

test('the Graph page is one explorer: a repo picker, then search, neighbours and diagram for the chosen repo', async () => {
  const env = await boot('#/node');
  const picker = tree(view(env)).find((e) => e.tagName === 'select' && e.attrs['aria-label'] === 'Repository');
  assert.ok(picker, 'repo picker');
  assert.deepEqual(picker.options.map((o) => o.textContent), ['one', 'two', 'three']);
  assert.match(view(env).textContent, /OneNode/);
  assert.doesNotMatch(view(env).textContent, /TwoNode/, 'one repo at a time');
  picker.value = '/r/two';
  for (const fn of picker.listeners.change ?? []) fn({ target: picker });
  await tick();
  assert.match(view(env).textContent, /TwoNode/);
  assert.doesNotMatch(view(env).textContent, /OneNode/);
  picker.value = '/r/three';
  for (const fn of picker.listeners.change ?? []) fn({ target: picker });
  await tick();
  assert.match(view(env).textContent, /not mirrored yet/);
});

test('search results: graph nodes come after every other kind and are capped so they never flood the list', () => {
  const nodes = { kind: 'node', count: 40, items: Array.from({ length: 8 }, (_, i) => ({ kind: 'node', id: `r::${i}`, title: `n${i}` })) };
  const mem = { kind: 'memory', count: 1, items: [{ kind: 'memory', id: '1', title: 'm' }] };
  const task = { kind: 'task', count: 1, items: [{ kind: 'task', id: 't', title: 't' }] };
  const out = plain(R.rankResults([nodes, mem, task]));
  assert.deepEqual(out.map((g) => g.kind), ['memory', 'task', 'node']);
  assert.equal(out[2].items.length, R.NODE_SEARCH_CAP);
  assert.equal(out[2].count, 40, 'the group still says how many matched');
  assert.ok(R.NODE_SEARCH_CAP <= 8);
});

test('page components live in style-pages.css, linked after style.css and served from the static allowlist', async () => {
  const html = await readFile(path.join(STATIC, 'index.html'), 'utf8');
  assert.match(html, /href="\/static\/style\.css">\s*<link rel="stylesheet" href="\/static\/style-pages\.css">/);
  const server = await readFile(path.join(STATIC, '..', 'server.py'), 'utf8');
  assert.match(server, /"style-pages\.css": "text\/css; charset=utf-8"/);
});
