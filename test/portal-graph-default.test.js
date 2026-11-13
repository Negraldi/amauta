// Critique P2 (T11 b): the graph node table opens on meaningful nodes. Vendored, minified and dependency files are hidden
// behind a labelled toggle, the default order is most connected first, and node kinds read as words, not class names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const NODES = { available: true, items: [{ id: 'h', label: 'handle()', kind: 'code', file: 'src/server.py', links: 12 },
  { id: 'd', label: 'Design notes', kind: 'document', file: 'docs/DESIGN.md', links: 3 }, { id: 'x', label: 'odd', kind: 'weird', file: 'a', links: 0 }] };

async function boot(hash) {
  const env = makeEnv({ '/api/graphify': { repos: [{ name: 'one', path: '/r/one', available: true, nodes: 3, edges: 2, synced_at: '2026-10-14T00:00:00Z',
    graph_mtime: '2026-10-13T00:00:00Z' }] }, '/api/projects': { projects: [] }, '/api/graph/nodes': NODES,
  '/api/graph/neighbors': { available: true, nodes: [{ id: 'h', label: 'handle()', kind: 'code', file: 'x', depth: 0 }], edges: [] } });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return { env, view: env.document.getElementById('view') };
}
const fire = (el, type) => { for (const fn of el.listeners[type] ?? []) fn({ target: el }); };
const nodeCalls = (env) => env.calls.filter((c) => String(c.url).startsWith('/api/graph/nodes')).map((c) => String(c.url));

test('the first node list hides vendored files and asks for the most connected nodes', async () => {
  const { env, view } = await boot('#/node');
  const [first] = nodeCalls(env);
  assert.doesNotMatch(first, /vendored=1/);
  assert.doesNotMatch(first, /order=name/);
  const box = tree(view).find((e) => e.tagName === 'input' && e.attrs.type === 'checkbox');
  assert.ok(box, 'a visible toggle');
  assert.equal(Boolean(box.checked), false);
  const label = tree(view).find((e) => e.tagName === 'label' && e.attrs.for === box.attrs.id);
  assert.match(label.textContent, /vendored, minified and dependency files/);
  const head = tree(view).filter((e) => e.tagName === 'th').map((e) => e.textContent.trim());
  assert.ok(head.some((x) => /^Links/.test(x)), `a Links column: ${head}`);
});

test('the toggle and the order select reload the list with their choice', async () => {
  const { env, view } = await boot('#/node');
  const box = tree(view).find((e) => e.tagName === 'input' && e.attrs.type === 'checkbox');
  box.checked = true;
  fire(box, 'change');
  await tick();
  assert.match(nodeCalls(env).at(-1), /vendored=1/);
  const order = tree(view).find((e) => e.tagName === 'select' && e.attrs['aria-label'] === 'Order');
  assert.ok(order, 'an order select');
  assert.deepEqual(tree(order).filter((e) => e.tagName === 'option').map((o) => o.textContent), ['Most connected first', 'Name']);
  order.value = 'name';
  fire(order, 'change');
  await tick();
  assert.match(nodeCalls(env).at(-1), /order=name/);
  assert.match(nodeCalls(env).at(-1), /vendored=1/, 'the toggle is kept');
});

test('node kinds are shown as words; an unknown kind stays as sent', async () => {
  const { view } = await boot('#/node');
  const cells = tree(view).filter((e) => e.tagName === 'td').map((e) => e.textContent);
  assert.ok(cells.includes('Code symbol'));
  assert.ok(cells.includes('Document'));
  assert.ok(cells.includes('weird'));
  assert.ok(!cells.includes('code'));
});

test('a node page names its kind in words', async () => {
  const env = makeEnv({ '/api/wiki/page': { kind: 'node', id: 'one::h', title: 'handle()', meta: [{ label: 'Kind', value: 'code' }, { label: 'File', value: 'src/server.py' }],
    sections: [], links: [], backlinks: [] }, '/api/graphify': { repos: [] }, '/api/projects': { projects: [] } });
  env.location.hash = '#/node/one%3A%3Ah';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const dds = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'dd').map((e) => e.textContent);
  assert.ok(dds.includes('Code symbol'), dds.join(' | '));
});
