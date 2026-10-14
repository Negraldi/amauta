import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeEnv, Element } from './helpers/fakedom.js';

const STATIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'python', 'gentle_lite', 'portal', 'static');
const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const XSS = '<img src=x onerror=alert(1)>';
const tick = () => new Promise((r) => setTimeout(r, 20));

const usage = { available: true, totals: { messages: 3, sessions: 2, input: 160, output: 85, cache_read: 900, cache_write: 150, thinking: 5 }, cache_hit_ratio: 0.5, events: 4, dropped_events: 7,
  daily: [{ day: '2026-10-01', messages: 1, sessions: 1, input: 100, output: 50, cache_read: 800, cache_write: 100 }, { day: '2026-10-02', messages: 2, sessions: 2, input: 60, output: 35, cache_read: 100, cache_write: 50 }],
  models: [{ model: XSS, messages: 3, input: 160, output: 85, cache_read: 900, cache_write: 150 }] };
const routes = {
  '/api/overview': usage,
  '/api/costs': { enabled: false, models: [] },
  '/api/sessions': { available: true, sessions: [{ session_id: 'abcdef123456', project: XSS, first_ts: 'a', last_ts: 'b', messages: 1, input: 1, output: 1, cache_read: 0, cache_write: 0, model: 'm' }], projects: [{ project: XSS, sessions: 1, messages: 1, input: 1, output: 1, cache_read: 0, cache_write: 0 }] },
  '/api/tools': { available: true, tools: [{ name: XSS, count: 2, sessions: 1, last_used: 'x' }], skills: [], subagents: [], mcp_servers: [], mcp_tools: [] },
  '/api/memories': { source: 'own', available: true, items: [{ id: 1, title: XSS, type: 'note', project: 'p', topic_key: 'k', revision: 1, updated_at: 'u', snippet: XSS }], facets: { projects: ['p'], types: ['note'] } },
  '/api/memory': { available: true, id: 1, title: XSS, content: XSS, type: 'note', project: 'p', topic_key: null, revision: 1, updated_at: 'u' },
  '/api/memory-files': { items: [{ id: 'a/memory/n.md', name: XSS, project: 'a', size: 3, mtime: 'm' }] },
  '/api/memory-file': { id: 'a/memory/n.md', content: XSS, truncated: false },
  '/api/graphify': { repos: [
    { name: XSS, path: '/r/one', available: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z', graph_mtime: '2026-10-13T00:00:00Z' },
    { name: 'two', path: '/r/two', available: false, reason: XSS }] },
  '/api/graph/nodes': { available: true, items: [{ id: 'a', label: XSS, kind: 'code', file: 'src/a.py' }, { id: 'b', label: 'Beta', kind: 'code', file: 'src/b.py' }] },
  '/api/graph/neighbors': { available: true, depth: 1, start: ['a'], nodes: [{ id: 'a', label: XSS, kind: 'code', file: 'x', depth: 0 }, { id: 'b', label: 'Beta', kind: 'code', file: 'y', depth: 1 }], edges: [{ src: 'a', dst: 'b', relation: XSS }] },
  '/api/harness': { installed: true, version: '1', hooks: [{ event: 'Stop', kind: 'usage' }], mcp_servers: [{ name: XSS, type: 'stdio', command: 'x' }], components: [XSS], managed_files: 1, telemetry: true, rdd_mode: 'on', persona: 'neutral' },
  '/api/odd': { repos: [{ repo: XSS, documents: [{ name: XSS, done: 1, total: 2, tasks: [{ done: true, title: XSS }, { done: false, title: 'b' }] }] }] },
};

async function boot(hash = '') {
  const env = makeEnv(routes);
  env.location.hash = hash;
  vm.runInNewContext(await read('app.js'), { ...env, URLSearchParams, console, setTimeout, String, Number, Object, Math, Array, Promise, Error });
  await tick();
  return env;
}
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };

test('static files: no innerHTML-style sinks, no external URLs, no inline script or style', async () => {
  const js = await read('app.js');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'localStorage']) assert.ok(!js.includes(sink), sink);
  const html = await read('index.html');
  const css = await read('style.css');
  for (const [name, text] of [['app.js', js], ['index.html', html], ['style.css', css]]) assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(text), `${name} references an external URL`);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /name="portal-token" content="__PORTAL_TOKEN__"/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'inline script');
  assert.ok(!/\sstyle=/.test(html), 'inline style attribute');
  assert.ok(!/<script[^>]*src="https?:/.test(html));
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /@media \(max-width:\s*\d+px\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/); // long titles must not force horizontal scroll at 375px
});

test('app.js is valid JavaScript', async () => {
  const r = spawnSync(process.execPath, ['--check', path.join(STATIC, 'app.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('overview renders KPIs, chart and the dropped counter; data strings only become text', async () => {
  const env = await boot();
  const view = env.document.getElementById('view');
  const text = view.textContent;
  assert.match(text, /Cache hit ratio/);
  assert.match(text, /50\.0%/);
  assert.match(text, /7 dropped/);
  assert.ok(tree(view).some((e) => e.tagName === 'svg'));
  assert.ok(tree(view).some((e) => e.tagName === 'rect'));
  assert.ok(text.includes(XSS), 'model name is shown as text');
  assert.equal(tree(view).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(tree(view).every((e) => Object.keys(e.attrs).every((k) => !k.startsWith('on'))));
});

for (const hash of ['#usage', '#sessions', '#memories', '#harness']) {
  test(`view ${hash} escapes hostile data`, async () => {
    const env = await boot(hash);
    const view = env.document.getElementById('view');
    if (hash === '#usage') {
      const tab = tree(view).find((e) => e.tagName === 'button' && e.textContent.startsWith('Tools'));
      assert.ok(tab, 'Tools tab');
      tab.click();
      await tick();
    }
    assert.ok(view.textContent.includes(XSS), view.textContent.slice(0, 200));
    assert.equal(tree(view).filter((e) => e.tagName === 'img').length, 0);
    assert.ok(tree(view).every((e) => Object.values(e.attrs).every((v) => !v.includes('onerror'))));
  });
}

test('memory detail shows content in a text node', async () => {
  const env = await boot('#memories');
  const view = env.document.getElementById('view');
  const link = tree(view).find((e) => e.tagName === 'button' && e.textContent === XSS && e.className === 'row-link');
  assert.ok(link, 'memory row link');
  link.click();
  await tick();
  assert.equal(tree(view).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(tree(view).some((e) => e.tagName === 'pre' && e.textContent === XSS));
});

test('refresh button POSTs with the page token and nothing else sensitive', async () => {
  const env = await boot();
  env.calls.length = 0;
  routes['/api/refresh'] = { messages: 2, files: 1 };
  env.document.getElementById('refresh').click();
  await tick();
  delete routes['/api/refresh'];
  const post = env.calls.find((c) => c.url === '/api/refresh');
  assert.equal(post.opts.method, 'POST');
  assert.equal(post.opts.headers['X-Portal-Token'], 'TOKEN-123');
  assert.match(env.document.getElementById('status').textContent, /2 new message/);
});

test('API failures render an error panel instead of throwing', async () => {
  const saved = routes['/api/overview'];
  delete routes['/api/overview'];
  const env = await boot();
  routes['/api/overview'] = saved;
  assert.match(env.document.getElementById('view').textContent, /Error/);
});

async function withRoutes(overrides, hash, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) { saved[k] = routes[k]; if (v === undefined) delete routes[k]; else routes[k] = v; }
  const rejections = [];
  const onRejection = (r) => rejections.push(r);
  process.on('unhandledRejection', onRejection);
  try {
    const env = await boot(hash);
    await fn(env, rejections);
  } finally {
    process.off('unhandledRejection', onRejection);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete routes[k]; else routes[k] = v; }
  }
}

test('memories: an unavailable database without facets shows the friendly message, not an error panel', async () => {
  await withRoutes({ '/api/memories': { source: 'own', available: false, items: [] } }, '#memories', async (env) => {
    const text = env.document.getElementById('view').textContent;
    assert.match(text, /Memory database not found\./);
    assert.ok(!/^Error/.test(text));
  });
});

test('memories: a failing search, detail or file fetch is shown inline and never becomes an unhandled rejection', async () => {
  await withRoutes({}, '#memories', async (env, rejections) => {
    const view = env.document.getElementById('view');
    delete routes['/api/memories'];
    const search = tree(view).find((e) => e.tagName === 'button' && e.textContent === 'Search');
    search.click();
    await tick();
    assert.match(view.textContent, /not found/); // the error message from the API is rendered
    delete routes['/api/memory'];
    delete routes['/api/memory-file'];
    routes['/api/memories'] = { source: 'own', available: true, items: [{ id: 1, title: 'T', type: 'note', project: 'p', topic_key: 'k', revision: 1, updated_at: 'u' }], facets: { projects: [], types: [] } };
    search.click();
    await tick();
    tree(view).find((e) => e.tagName === 'button' && e.className === 'row-link' && e.textContent === 'T').click();
    tree(view).find((e) => e.tagName === 'button' && e.className === 'row-link' && e.textContent === XSS).click();
    await tick();
    assert.deepEqual(rejections, []);
    assert.ok(tree(view).some((e) => e.tagName === 'pre' && /not found/.test(e.textContent)));
  });
  routes['/api/memory'] = { available: true, id: 1, title: XSS, content: XSS, type: 'note', project: 'p', topic_key: null, revision: 1, updated_at: 'u' };
  routes['/api/memory-file'] = { id: 'a/memory/n.md', content: XSS, truncated: false };
  routes['/api/memories'] = { source: 'own', available: true, items: [{ id: 1, title: XSS, type: 'note', project: 'p', topic_key: 'k', revision: 1, updated_at: 'u', snippet: XSS }], facets: { projects: ['p'], types: ['note'] } };
});

test('overview reports invalid prices and an unreadable prices file', async () => {
  await withRoutes({ '/api/costs': { enabled: true, label: 'L', models: [{ model: 'm', cost: null }], total: 0, invalid_prices: ['m: input'], unpriced_models: [] } }, '', async (env) => {
    assert.match(env.document.getElementById('view').textContent, /Invalid prices.*m: input/);
  });
  await withRoutes({ '/api/costs': { enabled: false, models: [], error: 'prices.json is unreadable' } }, '', async (env) => {
    assert.match(env.document.getElementById('view').textContent, /prices\.json is unreadable/);
  });
});

test('graph memory: per-repo stats, searchable node list and neighbors view, all as text', async () => {
  const env = await boot('#memories');
  const view = env.document.getElementById('view');
  assert.match(view.textContent, /6 nodes, 4 edges/);
  assert.match(view.textContent, /not mirrored|graphify update|<img/); // the unavailable repo shows its reason as text
  assert.ok(view.textContent.includes('src/a.py'), 'initial node list is loaded');
  env.calls.length = 0;
  const box = tree(view).find((e) => e.tagName === 'input' && e.attrs['aria-label'] === 'Search graph nodes');
  assert.ok(box, 'graph search box');
  box.value = 'alp';
  tree(view).find((e) => e.tagName === 'button' && e.textContent === 'Search graph').click();
  await tick();
  const call = env.calls.find((c) => c.url.startsWith('/api/graph/nodes'));
  assert.match(call.url, /repo=%2Fr%2Fone/);
  assert.match(call.url, /q=alp/);
  tree(view).find((e) => e.tagName === 'button' && e.className === 'row-link' && e.textContent === XSS && e.attrs['data-graph']).click();
  await tick();
  const n = env.calls.find((c) => c.url.startsWith('/api/graph/neighbors'));
  assert.match(n.url, /node=a/);
  assert.match(view.textContent, /Beta/);
  assert.equal(tree(view).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(tree(view).every((e) => Object.values(e.attrs).every((v) => !v.includes('onerror'))));
});

test('graph memory: API failures are shown inline', async () => {
  await withRoutes({ '/api/graph/nodes': undefined }, '#memories', async (env, rejections) => {
    const view = env.document.getElementById('view');
    assert.match(view.textContent, /not found/);
    assert.deepEqual(rejections, []);
  });
});
