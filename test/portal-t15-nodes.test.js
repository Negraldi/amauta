// T15 W1 (B10, A10): the node list offers the rest ("Show more" pages the server list); D10: a depth-2 neighbourhood cut
// at the server cap says the cap is a floor ("at least").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const GRAPH = { repos: [{ name: 'one', path: '/r/one', available: true, nodes: 120, edges: 4, synced_at: '2026-10-14T00:00:00Z', graph_mtime: '2026-10-13T00:00:00Z' }] };
const row = (i) => ({ id: `n${i}`, label: `Node ${i}`, kind: 'code', file: 'f', links: 1 });

async function boot(routes) {
  const env = makeEnv({ '/api/graphify': GRAPH, '/api/projects': { projects: [] }, ...routes });
  env.location.hash = '#/node';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}

test('Show more asks the server for the next rows and the count line follows', async () => {
  const seen = [];
  const nodes = async (opts, url) => {
    seen.push(String(url));
    const offset = Number(/offset=(\d+)/.exec(String(url))?.[1] ?? 0);
    return { available: true, items: Array.from({ length: Math.min(50, 120 - offset) }, (_, i) => row(offset + i)), matched: 120, hidden: 0 };
  };
  const env = await boot({ '/api/graph/nodes': nodes });
  const v = env.document.getElementById('view');
  const rows = () => tree(v).filter((e) => e.tagName === 'tr' && /Node \d+/.test(e.textContent));
  assert.equal(rows().length, 50);
  assert.match(v.textContent, /Showing 50 of 120 nodes/);
  tree(v).find((e) => e.tagName === 'button' && e.textContent === 'Show more').click();
  await tick();
  assert.ok(seen.some((u) => /offset=50/.test(u)), seen.join(' '));
  assert.equal(rows().length, 100);
  assert.match(v.textContent, /Showing 100 of 120 nodes/);
  tree(v).find((e) => e.tagName === 'button' && e.textContent === 'Show more').click();
  await tick();
  assert.equal(rows().length, 120);
  assert.equal(tree(v).find((e) => e.tagName === 'button' && e.textContent === 'Show more'), undefined);
});

const NEAR = { available: true, nodes: [{ id: 'n0', label: 'Node 0', kind: 'code', file: 'f', depth: 0 }], edges: [], truncated: true };

test('a neighbourhood cut at the server cap says 200 is a floor ("at least"), in the explorer', async () => {
  const nodes = { available: true, items: [row(0)], matched: 1, hidden: 0 };
  const diagram = { available: true, source: 'flowchart LR\n  n0["a"]', nodes: 200, edges: 9, truncated: true, capped: true };
  const env = await boot({ '/api/graph/nodes': nodes, '/api/graph/neighbors': NEAR, '/api/graph/diagram': diagram });
  const v = env.document.getElementById('view');
  tree(v).find((e) => e.tagName === 'button' && e.attrs['data-graph']).click();
  await tick();
  assert.match(v.textContent, /nearest 30 of at least 200 nodes/);
});

test('an exact count (not capped by the server) keeps the plain sentence', async () => {
  const nodes = { available: true, items: [row(0)], matched: 1, hidden: 0 };
  const diagram = { available: true, source: 'flowchart LR\n  n0["a"]', nodes: 45, edges: 9, truncated: false, capped: false };
  const env = await boot({ '/api/graph/nodes': nodes, '/api/graph/neighbors': NEAR, '/api/graph/diagram': diagram });
  const v = env.document.getElementById('view');
  tree(v).find((e) => e.tagName === 'button' && e.attrs['data-graph']).click();
  await tick();
  assert.match(v.textContent, /nearest 30 of 45 nodes/);
  assert.doesNotMatch(v.textContent, /at least/);
});
