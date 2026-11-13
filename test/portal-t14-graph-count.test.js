// T14 k: the graph node list says how many nodes it shows of how many match, and how many vendored ones the toggle hides,
// so turning the toggle visibly changes a number instead of silently changing the rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const GRAPH = { repos: [{ name: 'one', path: '/r/one', available: true, nodes: 1546, edges: 4, synced_at: '2026-10-14T00:00:00Z', graph_mtime: '2026-10-13T00:00:00Z' }] };
const row = (i) => ({ id: `n${i}`, label: `Node ${i}`, kind: 'code', file: 'f', links: 1 });
const nodes = (opts, url) => (/vendored=1/.test(String(url))
  ? { available: true, items: Array.from({ length: 50 }, (_, i) => row(i)), matched: 1546, hidden: 0 }
  : { available: true, items: Array.from({ length: 50 }, (_, i) => row(i)), matched: 1546, hidden: 312 });

test('the count line says shown, matched and hidden, and follows the vendored toggle', async () => {
  const env = makeEnv({ '/api/graphify': GRAPH, '/api/graph/nodes': nodes, '/api/projects': { projects: [] } });
  env.location.hash = '#/node';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const v = env.document.getElementById('view');
  assert.match(v.textContent, /Showing 50 of 1,234 nodes; 312 vendored, minified or dependency nodes hidden\./);
  const all = []; v.walk((e) => all.push(e));
  const box = all.find((e) => e.tagName === 'input' && e.getAttribute('id') === 'graph-vendored');
  box.checked = true;
  for (const fn of box.listeners.change) fn({ target: box });
  await tick();
  assert.match(v.textContent, /Showing 50 of 1,546 nodes, vendored ones included\./);
});
