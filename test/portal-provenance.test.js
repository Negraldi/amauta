// Critique P3 (T11 h): provenance said once. The Projects table names the usual origin once in the lead and only rows
// that differ carry their own; "mirrored" ("Sin reflejar") is said in plain words: the graph is (not) loaded into memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, readDicts } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const project = (name, origin, mirrored = false) => ({ name, path: `/home/u/${name}`, origin, odd: { features: 0, done: 0, total: 0, percent: 0 },
  sessions: 0, memories: 0, graph: { mirrored, nodes: 0, edges: 0, synced_at: mirrored ? '2026-10-14T00:00:00Z' : null, howto: 'x' } });

async function boot(projects) {
  const env = makeEnv({ '/api/projects': { auto_discover: false, config_repos: [], projects }, '/api/siblings': { siblings: [] },
    '/api/sessions': { available: false }, '/api/wiki/recent': { items: [] } });
  env.location.hash = '#/project';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env.document.getElementById('view');
}

test('the usual origin is said once; only rows that differ name theirs', async () => {
  const v = await boot([project('a', ['flag']), project('b', ['flag']), project('c', ['discovered'], true)]);
  assert.equal(v.textContent.match(/added with --repo/g).length, 1, v.textContent);
  assert.match(tree(v).find((e) => e.tagName === 'p' && /--repo/.test(e.textContent)).textContent, /Rows without a note were added with --repo/);
  const rows = tree(v).filter((e) => e.tagName === 'tr').map((e) => e.textContent);
  assert.ok(rows.some((r) => /^c/.test(r) && /found in your sessions/.test(r)));
});

test('one project says its origin in its row and nothing in the lead', async () => {
  const v = await boot([project('solo', ['config'])]);
  assert.equal(v.textContent.match(/saved in Settings/g).length, 1);
  assert.doesNotMatch(v.textContent, /Rows without a note/);
});

test('graph status is said in plain words in both languages', async () => {
  const { en, es, srv } = await readDicts();
  assert.equal(en['project.graphNot'], 'Not loaded yet');
  assert.equal(es['project.graphNot'], 'Aún sin cargar');
  for (const [k, v] of [...Object.entries(es), ...Object.entries(srv)]) assert.doesNotMatch(v, /reflej/i, k);
  const v = await boot([project('a', ['flag'])]);
  assert.match(v.textContent, /Not loaded yet/);
});
