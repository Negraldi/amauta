// T15 W1 (A1, A10): the project page says when the task-progress diagrams are fewer than the features, and the graph tab
// lists more nodes on request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const GRAPH = { mirrored: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z', is_git: true, last_commit: null, stale: null, hooks_installed: false,
  opted_out: false, running: false };
const diagram = (i) => ({ feature: `repo/f${i}`, name: `f${i}.md`, done: 1, total: 2, source: 'flowchart LR\n  n0["x"]' });
const PAGE = { kind: 'project', id: 'repo', title: 'repo', body_md: null, missing: [], backlinks: [], links: [], meta: [], sections: [], graph: GRAPH,
  progress: { done: 11, total: 22, percent: 50 }, odd_diagrams: Array.from({ length: 3 }, (_, i) => diagram(i)), odd_diagrams_total: 11 };
const ODD = { repos: [{ repo: 'repo', documents: [{ id: 'repo/f0', name: 'f0.md', done: 1, total: 2, tasks: [] }] }] };

test('the features tab says "3 of 11" when the diagrams are fewer than the features', async () => {
  const env = makeEnv({ '/api/wiki/page': PAGE, '/api/projects': { projects: [] }, '/api/odd': ODD, '/api/sessions': { available: true, projects: [], sessions: [] },
    '/api/graphify': { repos: [] }, '/api/pipelines': { projects: [] }, '/api/siblings': { siblings: [] } });
  env.location.hash = '#/project/repo?tab=features';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  assert.match(env.document.getElementById('view').textContent, /Showing 3 of 11/);
});
