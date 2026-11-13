// T14 cross-page agreement, projects: the Projects list takes each project's last activity from the server (the same
// membership as the project page), and a project's Sessions tab has no Project column (every row is this project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const GRAPH_OFF = { mirrored: false, nodes: 0, edges: 0, synced_at: null, howto: '' };
const ODD0 = { features: 0, done: 0, total: 0, percent: 0 };
const PROJECTS = { auto_discover: true, config_repos: [], projects: [
  { name: 'amauta', path: '/h/amauta', origin: ['config'], odd: ODD0, sessions: 3, last: '2026-11-09T20:00:00Z', memories: 0, graph: GRAPH_OFF }] };
const SESSIONS = { available: true, projects: [], sessions: [{ session_id: 'abcdef123456', runtime: 'claude', project: 'amauta',
  first_ts: '2026-10-01T00:00:00Z', last_ts: '2026-10-23T09:30:00Z', messages: 3, input: 1, output: 2, cache_read: 0, cache_write: 0, model: 'm', models: 1 }] };
const PAGE = { kind: 'project', id: 'amauta', title: 'amauta', body_md: null, missing: [], backlinks: [], links: [], meta: [], sections: [],
  progress: { done: 0, total: 0, percent: 0 }, odd_diagrams: [], graph: GRAPH_OFF };

async function boot(hash) {
  const env = makeEnv({ '/api/projects': PROJECTS, '/api/sessions': SESSIONS, '/api/siblings': { siblings: [] }, '/api/wiki/page': PAGE });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}

test('the Projects list shows the last activity the server computed for the project', async () => {
  const env = await boot('#/project');
  const cells = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'td').map((e) => e.textContent);
  assert.ok(cells.includes('2026-11-09'), cells.join(' | '));
  assert.ok(!env.calls.some((c) => /^\/api\/sessions\?.*limit=1000/.test(String(c.url))), 'no second, capped membership from /api/sessions');
});

test('a project\'s Sessions tab has no Project column', async () => {
  const env = await boot('#/project/amauta?tab=sessions');
  const heads = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'th').map((e) => e.textContent.replace(/ [▲▼]$/, ''));
  assert.ok(heads.length > 3, heads.join(' | '));
  assert.ok(!heads.includes('Project'), heads.join(' | '));
});

test('folders with sessions that are not projects are listed apart, with how to add one', async () => {
  const folders = [{ name: 'data', path: '/h/scratch/data', sessions: 1234, last: '2026-11-13T10:00:00Z' }];
  const env = makeEnv({ '/api/projects': { ...PROJECTS, folders }, '/api/siblings': { siblings: [] } });
  env.location.hash = '#/project';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const v = env.document.getElementById('view');
  const h2 = tree(v).filter((e) => e.tagName === 'h2').map((e) => e.textContent);
  assert.ok(h2.includes('Active folders that are not projects'), h2.join(' | '));
  assert.match(v.textContent, /\/h\/scratch\/data/);
  assert.match(v.textContent, /1,234/);
  assert.match(v.textContent, /git repository/);
  assert.ok(tree(v).some((e) => e.tagName === 'a' && e.getAttribute('href') === '#/settings?tab=projects'), 'links to where a folder is added');
});
