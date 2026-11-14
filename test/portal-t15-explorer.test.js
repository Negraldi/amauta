// T15 W2 (D2, B11, D8, B9): the depth control lives in the neighbours panel and re-renders it at once, the panel is brought into
// view, the graph's age is said once, and the node list opens on the project's own code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, Element } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const day = 86400000;
const stamp = (ago) => new Date(Date.now() - ago).toISOString();
const GRAPH = (extra = {}) => ({ repos: [{ name: 'one', path: '/r/one', available: true, nodes: 3, edges: 1, synced_at: stamp(0), graph_mtime: stamp(0), ...extra }] });
const row = (id, file = 'f.py') => ({ id, label: id, kind: 'code', file, links: 2 });
const NEAR = { available: true, nodes: [{ id: 'a', label: 'a', kind: 'code', file: 'f', depth: 0 }], edges: [] };

async function boot(routes, { reduce = false } = {}) {
  const seen = [];
  const scrolls = [];
  Element.prototype.scrollIntoView = function (opts) { scrolls.push({ el: this, opts }); };
  const wrap = (r) => async (opts, url) => { seen.push(String(url)); return typeof r === 'function' ? r(opts, url) : r; };
  const base = { '/api/projects': { projects: [] }, '/api/graph/diagram': { available: true, source: '', nodes: 1, edges: 0 }, ...routes };
  const env = makeEnv(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, wrap(v)])));
  env.location.hash = '#/node';
  const matchMedia = (q) => ({ matches: reduce && /reduce/.test(q), addEventListener() {} });
  await runPortal(env, { DOMParser: class {}, queueMicrotask, matchMedia });
  await tick();
  return { env, seen, scrolls, v: env.document.getElementById('view') };
}
const nodes = { available: true, items: [row('a'), row('b')], matched: 2, hidden: 0 };
const press = async (v, id) => { tree(v).find((e) => e.tagName === 'button' && e.attrs['data-graph'] && e.textContent === id).click(); await tick(); };

test('D2: the depth select is inside the neighbours panel, not next to the search; changing it re-renders the same node', async () => {
  const { v, seen } = await boot({ '/api/graphify': GRAPH(), '/api/graph/nodes': nodes, '/api/graph/neighbors': NEAR });
  const controls = tree(v).find((e) => /\bcontrols\b/.test(e.className) && tree(e).some((x) => x.tagName === 'input' && x.attrs.type === 'search'));
  assert.ok(!tree(controls).some((e) => e.tagName === 'select' && e.attrs['aria-label'] === 'Depth'), 'not beside the search');
  await press(v, 'a');
  const panel = tree(v).find((e) => /\bnear\b/.test(e.className));
  const depth = tree(panel).find((e) => e.tagName === 'select' && e.attrs['aria-label'] === 'Depth');
  assert.ok(depth, 'the depth select is in the panel');
  assert.ok(seen.some((u) => /graph\/neighbors/.test(u) && /depth=1/.test(u) && /node=a/.test(u)));
  depth.value = '2';
  for (const fn of depth.listeners.change ?? []) fn({ target: depth });
  await tick();
  assert.ok(seen.some((u) => /graph\/neighbors/.test(u) && /depth=2/.test(u) && /node=a/.test(u)), seen.join('\n'));
  assert.ok(seen.some((u) => /graph\/diagram/.test(u) && /depth=2/.test(u)), 'the diagram follows the depth too');
});

test('D2: choosing a row brings the panel into view (nearest, smooth unless reduced motion) and moves focus to its heading', async () => {
  const a = await boot({ '/api/graphify': GRAPH(), '/api/graph/nodes': nodes, '/api/graph/neighbors': NEAR });
  await press(a.v, 'a');
  const panel = tree(a.v).find((e) => /\bnear\b/.test(e.className));
  const hit = a.scrolls.find((s) => s.el === panel);
  assert.ok(hit, 'scrollIntoView on the panel');
  assert.equal(hit.opts.block, 'nearest');
  assert.equal(hit.opts.behavior, 'smooth');
  const heading = tree(panel).find((e) => e.tagName === 'h3');
  assert.equal(heading.attrs.tabindex, '-1');
  assert.equal(heading.focused, true);
  const b = await boot({ '/api/graphify': GRAPH(), '/api/graph/nodes': nodes, '/api/graph/neighbors': NEAR }, { reduce: true });
  await press(b.v, 'a');
  assert.equal(b.scrolls.find((s) => /\bnear\b/.test(s.el.className)).opts.behavior, 'auto');
});

test('D2: a depth change updates the panel and says so (live status), without stealing focus or scrolling again', async () => {
  const { v, scrolls } = await boot({ '/api/graphify': GRAPH(), '/api/graph/nodes': nodes, '/api/graph/neighbors': NEAR });
  await press(v, 'a');
  const before = scrolls.length;
  const depth = tree(v).find((e) => e.tagName === 'select' && e.attrs['aria-label'] === 'Depth');
  depth.value = '3';
  for (const fn of depth.listeners.change ?? []) fn({ target: depth });
  await tick();
  assert.equal(scrolls.length, before);
  const status = tree(v).find((e) => e.attrs.role === 'status' && /Neighbors of a/.test(e.textContent));
  assert.ok(status, 'a status line');
  assert.match(status.textContent, /depth 3/);
});

test('B11: one time when the graph copy and graph.json agree; the age in days when graph.json is older than a day', async () => {
  const same = await boot({ '/api/graphify': GRAPH(), '/api/graph/nodes': nodes });
  const line = tree(same.v).find((e) => /^3 nodes/.test(e.textContent) && e.tagName === 'p');
  assert.doesNotMatch(line.textContent, /loaded .*graph\.json/);
  assert.match(line.textContent, /graph\.json and the loaded copy/);
  assert.doesNotMatch(line.textContent, /old/);
  const old = await boot({ '/api/graphify': GRAPH({ graph_mtime: stamp(4 * day + 3600000) }), '/api/graph/nodes': nodes });
  const text = tree(old.v).find((e) => /^3 nodes/.test(e.textContent) && e.tagName === 'p').textContent;
  assert.match(text, /graph\.json .*4 days old/);
  const one = await boot({ '/api/graphify': GRAPH({ graph_mtime: stamp(day + 3600000) }), '/api/graph/nodes': nodes });
  assert.match(tree(one.v).find((e) => /^3 nodes/.test(e.textContent) && e.tagName === 'p').textContent, /1 day old/);
});

test('D8: the node list asks for own code first; a labelled option brings concept and reference nodes back', async () => {
  const { v, seen } = await boot({ '/api/graphify': GRAPH(), '/api/graph/nodes': { ...nodes, matched: 7, hidden: 5 } });
  const first = seen.find((u) => /graph\/nodes/.test(u));
  assert.doesNotMatch(first, /concepts=1/);
  assert.match(v.textContent, /Showing 2 of 2 nodes; 5 more hidden/);
  const box = tree(v).find((e) => e.tagName === 'input' && e.attrs.id === 'graph-concepts');
  assert.ok(box, 'a concepts checkbox');
  assert.ok(tree(v).some((e) => e.tagName === 'label' && e.attrs.for === 'graph-concepts' && /concept and reference nodes/i.test(e.textContent)));
  box.checked = true;
  for (const fn of box.listeners.change ?? []) fn({ target: box });
  await tick();
  assert.ok(seen.filter((u) => /graph\/nodes/.test(u)).some((u) => /concepts=1/.test(u)));
});
