// Critique P3 (T11 h, revised in T14 j): provenance in one place. Every Projects row names its origin in a Found by
// column; "mirrored" ("Sin reflejar") is said in plain words: the graph is (not) loaded into memory.
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

// T14 j: one rule for origin. The T11/T13 lead ("Where projects come from, unless a row says otherwise: ...") read as a
// puzzle next to rows that named theirs; every row now states its origin in a "Found by" column and the lead says none.
const heads = (v) => tree(v).filter((e) => e.tagName === 'th').map((e) => e.textContent.replace(/ [▲▼]$/, ''));
test('every row states its origin in a Found by column; the lead names none', async () => {
  const v = await boot([project('a', ['flag']), project('b', ['flag']), project('c', ['discovered'], true)]);
  assert.ok(heads(v).includes('Found by'), heads(v).join(' | '));
  const rows = tree(v).filter((e) => e.tagName === 'tr').slice(1).map((e) => e.textContent);
  assert.equal(rows.filter((r) => /Command line/.test(r)).length, 2);
  assert.ok(rows.some((r) => /^c/.test(r) && /Your sessions/.test(r)));
  assert.doesNotMatch(tree(v).find((e) => e.tagName === 'p').textContent, /--repo|unless a row says otherwise/);
});

test('one project says its origin in its row and nothing in the lead', async () => {
  const v = await boot([project('solo', ['config'])]);
  assert.equal(tree(v).filter((e) => e.tagName === 'td' && e.textContent === 'Saved in Settings').length, 1);
  assert.doesNotMatch(v.textContent, /unless a row says otherwise/);
});

test('graph status is said in plain words in both languages', async () => {
  const { en, es, srv } = await readDicts();
  assert.equal(en['project.graphNot'], 'Not loaded yet');
  assert.equal(es['project.graphNot'], 'Aún sin cargar');
  for (const [k, v] of [...Object.entries(es), ...Object.entries(srv)]) assert.doesNotMatch(v, /reflej/i, k);
  const v = await boot([project('a', ['flag'])]);
  assert.match(v.textContent, /Not loaded yet/);
});

test('a project found two ways names both in its row, and the old lead key is gone', async () => {
  const v = await boot([project('a', ['flag', 'config']), project('c', ['discovered']), project('e', ['config'])]);
  const rows = tree(v).filter((e) => e.tagName === 'tr').slice(1).map((e) => e.textContent);
  assert.ok(rows.some((r) => /Command line, Saved in Settings/.test(r)), rows.join(' | '));
  const { en, es } = await readDicts();
  assert.ok(!('project.originCommon' in en) && !('project.originCommon' in es));
});
