// Project hub (portal redesign T3): one project = one place. #/project/<name>?tab= carries the view (overview, features,
// graph, pipelines, sessions, memories); each tab has loading, empty and error states; the list is one row per project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const rctx = {};
vm.runInNewContext(await readFile(path.join(STATIC, 'wikiroute.js'), 'utf8'), rctx);
const R = rctx.AmautaRoute;
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));
const view = (env) => env.document.getElementById('view');
const byClass = (el, cls) => tree(el).filter((e) => String(e.className || '').split(' ').includes(cls));
const crumbNav = (env) => tree(view(env)).find((e) => e.tagName === 'nav' && e.className === 'crumbs');
const tabNav = (env) => tree(view(env)).find((e) => e.tagName === 'nav' && e.className === 'tabs');

// ---- routing (pure) -------------------------------------------------------------------------------------------------
test('?tab= is a validated query param of the project hub; overview is the default and never written', () => {
  assert.deepEqual(plain(R.PROJECT_TABS), ['overview', 'features', 'graph', 'pipelines', 'sessions', 'memories']);
  assert.deepEqual(plain(R.parseHash('#/project/amauta?tab=graph')), { kind: 'project', id: 'amauta', query: { tab: 'graph' } });
  assert.deepEqual(plain(R.parseHash('#/project/amauta?tab=bogus')), { kind: 'project', id: 'amauta' });
  assert.deepEqual(plain(R.parseHash('#/project/amauta?tab=overview')), { kind: 'project', id: 'amauta' });
  assert.equal(R.routeHash({ kind: 'project', id: 'a/b', query: { tab: 'sessions' } }), '#/project/a%2Fb?tab=sessions');
  assert.equal(R.projectTab(R.parseHash('#/project/x?tab=memories')), 'memories');
  assert.equal(R.projectTab(R.parseHash('#/project/x')), 'overview');
  assert.equal(R.projectTab({ kind: 'project', id: 'x', query: { tab: 'nope' } }), 'overview');
});

test('crumbs: the hub ends at the project (or its tab); features and graph nodes pass through their project', () => {
  const base = [{ key: 'nav.group.work' }, { key: 'nav.project', hash: '#/project' }];
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/project/amauta'))), [...base, { text: 'amauta' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/project/amauta?tab=sessions'))),
    [...base, { text: 'amauta', hash: '#/project/amauta' }, { key: 'project.tab.sessions' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/feature/proj/name'))), [...base, { text: 'proj', hash: '#/project/proj?tab=features' }, { text: 'name' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/node/repo%3A%3Asrc%2Fa.js'))), [...base, { text: 'repo', hash: '#/project/repo?tab=graph' }, { text: 'src/a.js' }]);
  assert.equal(R.hubOf(R.parseHash('#/node/repo::x')), 'project', 'a node page lights Projects in the sidebar');
  assert.equal(R.hubOf('node'), 'graph', 'the cross-repo explorer stays under Knowledge');
});

// ---- fixtures -------------------------------------------------------------------------------------------------------
const GRAPH = { mirrored: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z', is_git: true, last_commit: '2026-10-15T08:00:00Z', stale: true,
  hooks_installed: false, opted_out: false, running: false };
const PAGE = {
  kind: 'project', id: 'repo', title: 'repo', body_md: null, missing: [], backlinks: [{ kind: 'memory', id: '3', title: 'Mentions repo' }],
  links: [{ kind: 'feature', id: 'repo/feat', title: 'feat' }],
  meta: [{ label: 'Path', value: '/home/u/repo' }, { label: 'Found by', value: 'flag' }, { label: 'Features', value: '1', fmt: 'number' },
    { label: 'Tasks done', value: '2 of 3' }, { label: 'Sessions', value: '1234', fmt: 'number' }, { label: 'Memories', value: '1', fmt: 'number' },
    { label: 'Graph memory', value: '6 nodes, 4 edges, synced 2026-10-14T00:00:00Z' }],
  progress: { done: 2, total: 3, percent: 67 },
  sections: [{ heading: 'ODD features', items: [{ label: 'feat', value: '2 of 3 tasks done', kind: 'feature', id: 'repo/feat' }] },
    { heading: 'Recent sessions', items: [{ label: 'old label', kind: 'session', id: 'abcdef123456' }] },
    { heading: 'Memories', items: [{ label: 'Repo note', value: null, kind: 'memory', id: '9' }] }],
  odd_diagrams: [{ feature: 'repo/feat', name: 'feat.md', done: 2, total: 3, source: 'flowchart LR\n  n0["feat.md"]' }],
  graph: GRAPH,
};
const ODD = { repos: [{ repo: 'other', documents: [{ id: 'other/x', name: 'x.md', done: 0, total: 1, tasks: [] }] },
  { repo: 'repo', documents: [{ id: 'repo/feat', name: 'feat.md', done: 2, total: 3, tasks: [] }] }] };
const GRAPHIFY = { repos: [{ name: 'other', path: '/home/u/other', available: true, nodes: 99, edges: 1, synced_at: '2026-10-01T00:00:00Z', graph_mtime: '2026-10-01T00:00:00Z' },
  { name: 'repo', path: '/home/u/repo', available: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z', graph_mtime: '2026-10-14T00:00:00Z', sql_tables: 0 }] };
const PIPE = (name) => ({ id: name.toLowerCase(), name, description: '', category: '', steps: ['S'], types: ['command'], schedules: [], last: null, history: [] });
const PIPELINES = { available: true, projects: [{ name: 'other', path: '/home/u/other', trusted: true, error: null, pipelines: [PIPE('Other job')] },
  { name: 'repo', path: '/home/u/repo', trusted: true, error: null, pipelines: [PIPE('Weekly sales')] }] };
const SESSIONS = { available: true, projects: [], sessions: [{ session_id: 'abcdef123456', runtime: 'claude', project: 'repo', first_ts: '2026-10-01T00:00:00Z',
  last_ts: '2026-10-02T09:30:00Z', messages: 3, input: 1, output: 2, cache_read: 0, cache_write: 0, model: 'm' }] };
const MEMORIES = { source: 'own', available: true, items: [{ id: 9, title: 'Repo note', type: 'decision', project: 'repo', topic_key: 'a/b', revision: 1,
  updated_at: '2026-10-03T10:00:00Z' }], facets: { projects: ['repo'], types: ['decision'] } };

async function boot(hash, over = {}) {
  const env = makeEnv({ '/api/wiki/page': PAGE, '/api/projects': { projects: [] }, '/api/sessions': SESSIONS, '/api/odd': ODD, '/api/graphify': GRAPHIFY,
    '/api/graph/nodes': { available: true, items: [{ id: 'n1', label: 'main()', kind: 'function', file: 'src/a.js' }] }, '/api/pipelines': PIPELINES,
    '/api/memories': MEMORIES, '/api/siblings': { siblings: [] }, ...over });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}

// ---- the hub --------------------------------------------------------------------------------------------------------
test('the hub opens on Overview: title, a plural-aware summary, the six tabs, progress, graph freshness and the rail', async () => {
  const env = await boot('#/project/repo');
  const v = view(env);
  assert.equal(tree(v).filter((e) => e.tagName === 'h1').map((e) => e.textContent).join('|'), 'repo');
  assert.match(v.textContent, /1 feature · 1,234 sessions · 1 memory/);
  assert.deepEqual(hrefs(tabNav(env)), ['#/project/repo', '#/project/repo?tab=features', '#/project/repo?tab=graph', '#/project/repo?tab=pipelines',
    '#/project/repo?tab=sessions', '#/project/repo?tab=memories']);
  assert.deepEqual(tree(tabNav(env)).filter((e) => e.getAttribute && e.getAttribute('aria-current') === 'page').map((e) => e.textContent), ['Overview']);
  assert.match(v.textContent, /2 of 3 done/);
  assert.match(v.textContent, /The graph is older than the last commit \(2026-10-15/);
  assert.ok(tree(v).some((e) => e.tagName === 'button' && e.textContent === 'Sync graph now'));
  assert.match(v.textContent, /\/home\/u\/repo/);
  assert.ok(hrefs(v).includes('#/memory/3'), 'backlinks stay in the rail');
});

test('each fact appears once: no Links list repeating features, no feature, session or memory lists on Overview', async () => {
  const env = await boot('#/project/repo');
  const v = view(env);
  assert.doesNotMatch(v.textContent, /Links/);
  assert.ok(!hrefs(v).includes('#/feature/repo%2Ffeat'));
  assert.ok(!hrefs(v).includes('#/memory/9'));
  assert.ok(!hrefs(v).includes('#/session/abcdef123456'));
  assert.doesNotMatch(v.textContent, /Tasks done|Graph memory6|ODD features/);
});

test('a tab shows in the breadcrumb (Work / Projects / repo / Sessions) and as the current tab', async () => {
  const env = await boot('#/project/repo?tab=sessions');
  assert.deepEqual(hrefs(crumbNav(env)), ['#/project', '#/project/repo']);
  assert.match(crumbNav(env).textContent, /Work.*Projects.*repo.*Sessions/);
  assert.deepEqual(tree(tabNav(env)).filter((e) => e.getAttribute && e.getAttribute('aria-current') === 'page').map((e) => e.textContent), ['Sessions']);
});

test('Features: this project\'s features with a progress bar and label, a link each, and the task diagrams', async () => {
  const env = await boot('#/project/repo?tab=features');
  const v = view(env);
  assert.ok(env.calls.some((c) => c.url === '/api/odd'));
  assert.ok(hrefs(v).includes('#/feature/repo%2Ffeat'));
  assert.ok(!hrefs(v).includes('#/feature/other%2Fx'), 'only this project');
  const bar = tree(v).find((e) => e.tagName === 'progress');
  assert.equal(bar.getAttribute('value'), '2');
  assert.equal(bar.getAttribute('max'), '3');
  assert.match(v.textContent, /2 of 3 done/);
  assert.match(v.textContent, /Task progress/);
});

test('Features with none teaches where they come from', async () => {
  const env = await boot('#/project/repo?tab=features', { '/api/odd': { repos: [{ repo: 'repo', documents: [] }] } });
  assert.match(view(env).textContent, /odd\/tasks/);
});

test('Graph: only this repository\'s graph with its node search; the cross-repo explorer is linked', async () => {
  const env = await boot('#/project/repo?tab=graph');
  const v = view(env);
  assert.ok(env.calls.some((c) => String(c.url).startsWith('/api/graph/nodes') && c.url.includes(encodeURIComponent('/home/u/repo'))));
  assert.ok(!env.calls.some((c) => String(c.url).includes(encodeURIComponent('/home/u/other'))));
  assert.match(v.textContent, /main\(\)/);
  assert.ok(tree(v).some((e) => e.tagName === 'input' && e.attrs.type === 'search'));
  assert.ok(hrefs(v).includes('#/node'));
});

test('Graph with no mirror teaches how to fill it', async () => {
  const env = await boot('#/project/repo?tab=graph', { '/api/graphify': { repos: [{ name: 'repo', path: '/home/u/repo', available: false, reason: 'not mirrored yet: run `amauta graphify hook install --cwd <repo>`' }] } });
  assert.match(view(env).textContent, /amauta graphify hook install/);
  assert.ok(tree(view(env)).some((e) => e.tagName === 'code'));
});

test('Pipelines: only this project\'s pipelines, and a link to all of them', async () => {
  const env = await boot('#/project/repo?tab=pipelines');
  const v = view(env);
  assert.match(v.textContent, /Weekly sales/);
  assert.doesNotMatch(v.textContent, /Other job/);
  assert.ok(hrefs(v).includes('#/pipelines'));
});

test('Pipelines with none for this project teaches how to add one', async () => {
  const env = await boot('#/project/repo?tab=pipelines', { '/api/pipelines': { available: true, projects: [PIPELINES.projects[0]] } });
  assert.match(view(env).textContent, /\.amauta\/pipelines\.json/);
  assert.ok(hrefs(view(env)).includes('#/pipelines'));
});

test('Sessions: the project\'s sessions in the session table, newest first', async () => {
  const env = await boot('#/project/repo?tab=sessions');
  const call = env.calls.find((c) => String(c.url).startsWith('/api/sessions?') && c.url.includes('project=repo'));
  assert.ok(call, 'filtered by project');
  assert.ok(hrefs(view(env)).includes('#/session/abcdef123456'));
  assert.match(view(env).textContent, /2026-10-02 09:30/);
});

test('Sessions with none teaches how they arrive', async () => {
  const env = await boot('#/project/repo?tab=sessions', { '/api/sessions': { available: true, projects: [], sessions: [] } });
  assert.match(view(env).textContent, /No sessions .*repo/);
});

test('Memories: the project\'s memories with type, topic and date', async () => {
  const env = await boot('#/project/repo?tab=memories');
  assert.ok(env.calls.some((c) => String(c.url).startsWith('/api/memories?') && c.url.includes('project=repo')));
  assert.ok(hrefs(view(env)).includes('#/memory/9'));
  assert.match(view(env).textContent, /Decision/); // T8: the type is shown with its label
});

test('Memories with none teaches mem_save', async () => {
  const env = await boot('#/project/repo?tab=memories', { '/api/memories': { ...MEMORIES, items: [] } });
  assert.match(view(env).textContent, /mem_save/);
});

test('a tab that is still loading shows skeleton lines under the tabs', async () => {
  const env = await boot('#/project/repo?tab=sessions', { '/api/sessions': (o, url) => (url.includes('project=') ? new Promise(() => {}) : SESSIONS) });
  assert.ok(tabNav(env), 'the tabs are already there');
  assert.ok(byClass(view(env), 'skeleton').length >= 1);
  assert.ok(tree(view(env)).some((e) => e.getAttribute && e.getAttribute('aria-busy') === 'true'));
});

test('a tab that fails says so with Retry, keeps the tabs, and Retry loads it', async () => {
  let fail = true;
  const env = await boot('#/project/repo?tab=memories', { '/api/memories': async () => (fail ? { __status: 500, error: 'boom' } : MEMORIES) });
  assert.ok(tabNav(env));
  assert.match(view(env).textContent, /could not load/i);
  fail = false;
  tree(view(env)).find((e) => e.tagName === 'button' && e.textContent === 'Retry').click();
  await tick();
  assert.ok(hrefs(view(env)).includes('#/memory/9'));
});

test('an unknown project teaches instead of failing', async () => {
  const env = await boot('#/project/nope', { '/api/wiki/page': { __status: 404, error: 'not found' } });
  assert.match(view(env).textContent, /No project page/);
});

test('a graph node page breadcrumb passes through its project hub', async () => {
  const env = await boot('#/node/repo%3A%3An1', { '/api/wiki/page': { kind: 'node', id: 'repo::n1', title: 'main()', meta: [], links: [], backlinks: [], missing: [], sections: [] } });
  assert.deepEqual(hrefs(crumbNav(env)), ['#/project', '#/project/repo?tab=graph']);
  const nav = env.document.getElementById('nav');
  assert.deepEqual(tree(nav).filter((e) => e.getAttribute && e.getAttribute('aria-current') === 'page').map((e) => e.getAttribute('href')), ['#/project']);
});

// ---- the list -------------------------------------------------------------------------------------------------------
const LIST = { auto_discover: false, projects: [
  { name: 'repo', path: '/home/u/repo', origin: ['flag'], odd: { features: 1, done: 2, total: 3, percent: 67 }, sessions: 1, memories: 1,
    graph: { mirrored: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z' } },
  { name: 'beta', path: '/home/u/beta', origin: ['config'], odd: { features: 0, done: 0, total: 0, percent: 0 }, sessions: 0, memories: 0,
    graph: { mirrored: false, nodes: 0, edges: 0, synced_at: null } }] };

test('#/project is one table row per project: name, ODD progress with a bar, graph chip with a shape, last activity date', async () => {
  const sessions = { available: true, projects: [], sessions: [{ ...SESSIONS.sessions[0], last_ts: '2026-11-01T22:10:00Z' },
    { ...SESSIONS.sessions[0], session_id: 'b', last_ts: '2026-10-20T08:00:00Z' }] };
  const env = await boot('#/project', { '/api/projects': LIST, '/api/sessions': sessions });
  const v = view(env);
  const rows = tree(v).filter((e) => e.tagName === 'tbody').flatMap((b) => b.children);
  assert.equal(rows.length, 2);
  const repo = rows.find((r) => /repo/.test(r.textContent));
  assert.ok(hrefs(repo).includes('#/project/repo'));
  assert.ok(tree(repo).some((e) => e.tagName === 'progress'));
  assert.match(repo.textContent, /2 of 3 tasks \(67%\)/);
  assert.match(repo.textContent, /● Mirrored 2026-10-14/);
  assert.match(repo.textContent, /2026-11-01/);
  assert.doesNotMatch(repo.textContent, /22:10/, 'a date, not a date-time');
  const beta = rows.find((r) => /beta/.test(r.textContent));
  assert.match(beta.textContent, /○ Not mirrored/);
  assert.match(beta.textContent, /No ODD features/);
  assert.equal(tree(v).filter((e) => e.tagName === 'article').length, 0, 'no cards for projects');
});

test('siblings sit below the project table as a secondary section', async () => {
  const sib = { name: 'Data catalog', path: '/home/u/catalog', exists: true, state: 'ok' };
  const env = await boot('#/project', { '/api/projects': LIST, '/api/siblings': { siblings: [sib] } });
  const kids = view(env).children.map((e) => e.textContent);
  const table = kids.findIndex((t) => /Not mirrored/.test(t));
  const sibs = kids.findIndex((t) => /Sibling projects/.test(t));
  assert.ok(table >= 0 && sibs > table, 'siblings after the table');
});
