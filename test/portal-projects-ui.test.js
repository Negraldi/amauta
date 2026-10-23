import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const XSS = '<img src=x onerror=alert(1)>';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));
const view = (env) => env.document.getElementById('view');

const GRAPH_OFF = { mirrored: false, nodes: 0, edges: 0, synced_at: null, howto: 'Run `amauta graphify hook install --cwd <path>` once.' };
const PROJECTS = { auto_discover: true, config_repos: ['/home/u/beta'], projects: [
  { name: 'repo', path: '/home/u/repo', origin: ['flag'], odd: { features: 1, done: 2, total: 3, percent: 67 }, sessions: 1234, memories: 5, graph: { mirrored: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z' } },
  { name: XSS, path: '/home/u/alpha', origin: ['discovered'], odd: { features: 0, done: 0, total: 0, percent: 0 }, sessions: 2, memories: 0, graph: GRAPH_OFF },
  { name: 'beta', path: '/home/u/beta', origin: ['config'], odd: { features: 0, done: 0, total: 0, percent: 0 }, sessions: 0, memories: 0, graph: GRAPH_OFF },
] };

async function boot(hash, over = {}) {
  const posts = [];
  const routes = {
    '/api/projects': PROJECTS, '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false }, '/api/graphify': { repos: [] },
    '/api/projects/config': async (opts) => { posts.push({ headers: opts.headers, method: opts.method, body: JSON.parse(opts.body) }); return { ...PROJECTS, config_repos: JSON.parse(opts.body).repos ?? PROJECTS.config_repos }; },
    ...over,
  };
  const env = makeEnv(routes);
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return { env, posts };
}

test('the sidebar has Projects and the old Diagrams entry is gone', async () => {
  const { env } = await boot('#/project');
  const links = hrefs(env.document.getElementById('nav'));
  assert.ok(links.includes('#/project'));
  assert.ok(!links.includes('#/diagrams'));
});

test('#/project lists every known project with progress, counts, graph status and a link to its page', async () => {
  const { env } = await boot('#/project');
  const v = view(env);
  const links = hrefs(v);
  assert.ok(links.includes('#/project/repo'));
  assert.ok(links.includes(`#/project/${encodeURIComponent(XSS)}`));
  assert.match(v.textContent, /2 of 3 tasks \(67%\)/);
  assert.match(v.textContent, /1,234 sessions/);
  assert.match(v.textContent, /graph mirrored 2026-10-14/i);
  assert.match(v.textContent, /graph not mirrored/i);
  assert.match(v.textContent, /discovered/);
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0);
});

test('#/project with no projects teaches how projects are found', async () => {
  const { env } = await boot('#/project', { '/api/projects': { auto_discover: true, config_repos: [], projects: [] } });
  assert.match(view(env).textContent, /--repo/);
  assert.match(view(env).textContent, /Settings/);
  assert.ok(hrefs(view(env)).includes('#/settings'));
});

const PAGE = {
  kind: 'project', id: 'repo', title: 'repo', body_md: null, meta: [{ label: 'Path', value: '/home/u/repo' }, { label: 'Sessions', value: '1234', fmt: 'number' }],
  links: [], backlinks: [], missing: [], progress: { done: 2, total: 3, percent: 67 },
  sections: [{ heading: 'ODD features', items: [{ label: 'feat', value: '2 of 3 tasks done', kind: 'feature', id: 'repo/feat' }] }, { heading: 'Memories', items: [{ label: 'Repo note', value: null, kind: 'memory', id: '9' }] }],
  odd_diagrams: [{ feature: 'repo/feat', name: 'feat.md', done: 2, total: 3, source: 'flowchart LR\n  n0["feat.md"]' }],
  graph: GRAPH_OFF,
};

test('a project page shows progress, linked features, memories, the ODD diagram and the graph how-to when nothing is mirrored', async () => {
  const { env } = await boot('#/project/repo', { '/api/wiki/page': PAGE });
  const v = view(env);
  assert.ok(env.calls.some((c) => c.url === '/api/wiki/page?kind=project&id=repo'));
  assert.match(v.textContent, /2 of 3 done/);
  assert.ok(hrefs(v).includes('#/feature/repo%2Ffeat'));
  assert.ok(hrefs(v).includes('#/memory/9'));
  assert.match(v.textContent, /feat\.md: 2\/3|feat\.md/);
  assert.match(v.textContent, /Graph memory/);
  assert.match(v.textContent, /amauta graphify hook install/);
  assert.match(v.textContent, /1,234/);
});

test('a mirrored project page reports the graph instead of the how-to', async () => {
  const { env } = await boot('#/project/repo', { '/api/wiki/page': { ...PAGE, graph: { mirrored: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z' } } });
  assert.match(view(env).textContent, /6 nodes, 4 edges/);
  assert.doesNotMatch(view(env).textContent, /hook install/);
});

test('ODD features list links to project-qualified ids', async () => {
  const { env } = await boot('#/feature', { '/api/odd': { repos: [{ repo: 'repo', documents: [{ id: 'repo/feat', name: 'feat.md', done: 1, total: 2, tasks: [] }] }] } });
  assert.ok(hrefs(view(env)).includes('#/feature/repo%2Ffeat'));
});

test('the Harness page no longer carries per-repo ODD progress (it lives on project and feature pages)', async () => {
  const { env } = await boot('#/harness', { '/api/harness': { installed: true, version: '1', hooks: [], mcp_servers: [], components: [], managed_files: 1, telemetry: true, rdd_mode: 'on', persona: 'neutral' }, '/api/archify': { installed: true, available: false, fallback: null }, '/api/odd': { repos: [{ repo: 'repo', documents: [] }] } });
  assert.doesNotMatch(view(env).textContent, /ODD task progress/);
  assert.equal(env.calls.some((c) => String(c.url).startsWith('/api/odd')), false);
});

test('the Graph page explains how graph memory is populated and lists projects that already have a mirrored graph', async () => {
  const { env } = await boot('#/node');
  const v = view(env);
  assert.match(v.textContent, /amauta graphify hook install/);
  assert.match(v.textContent, /graphify update/);
  assert.ok(hrefs(v).includes('#/project/repo'), 'mirrored project is linked');
  assert.ok(!hrefs(v).includes('#/project/beta'), 'unmirrored projects are not listed as mirrored');
});

test('with no mirrored graph the Graph page says so', async () => {
  const off = { ...PROJECTS, projects: PROJECTS.projects.map((p) => ({ ...p, graph: GRAPH_OFF })) };
  const { env } = await boot('#/node', { '/api/projects': off });
  assert.match(view(env).textContent, /No project has a mirrored graph yet/);
});

// ---- Settings: Projects ------------------------------------------------------------------------------------
const SETTINGS = { installed: true, current: { persona: 'gentleman', review_mode: 'off', telemetry: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } }, allowed: {}, undo: { available: false } };
const byText = (el, tag, text) => tree(el).find((e) => e.tagName === tag && e.textContent === text);

test('Settings lists configured project paths and the auto-discover switch', async () => {
  const { env } = await boot('#/settings', { '/api/settings': SETTINGS });
  const v = view(env);
  assert.match(v.textContent, /Projects/);
  assert.match(v.textContent, /\/home\/u\/beta/);
  assert.ok(byText(v, 'button', 'Remove'), 'a Remove button per path');
  const box = tree(v).find((e) => e.tagName === 'input' && e.attrs.type === 'checkbox');
  assert.ok(box && 'checked' in box.attrs, 'auto-discover is on');
});

test('adding a path posts the whole list with the token and JSON, then shows the answer', async () => {
  const { env, posts } = await boot('#/settings', { '/api/settings': SETTINGS });
  const input = tree(view(env)).find((e) => e.tagName === 'input' && e.attrs.type === 'text');
  input.value = '/home/u/new';
  byText(view(env), 'button', 'Add project').click();
  await tick();
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { repos: ['/home/u/beta', '/home/u/new'] });
  assert.equal(posts[0].method, 'POST');
  assert.equal(posts[0].headers['X-Portal-Token'], 'TOKEN-123');
  assert.equal(posts[0].headers['Content-Type'], 'application/json');
});

test('removing a path and toggling auto-discover post only what changed', async () => {
  const { env, posts } = await boot('#/settings', { '/api/settings': SETTINGS });
  byText(view(env), 'button', 'Remove').click();
  await tick();
  assert.deepEqual(posts[0].body, { repos: [] });
  const box = tree(view(env)).find((e) => e.tagName === 'input' && e.attrs.type === 'checkbox');
  for (const fn of box.listeners.change ?? []) fn({ target: { checked: false } });
  await tick();
  assert.deepEqual(posts[1].body, { auto_discover: false });
});

test('a rejected path shows the server message inline and nothing else changes', async () => {
  const { env } = await boot('#/settings', { '/api/settings': SETTINGS, '/api/projects/config': { __status: 400, error: `not an existing directory: ${XSS}` } });
  const input = tree(view(env)).find((e) => e.tagName === 'input' && e.attrs.type === 'text');
  input.value = '/nope';
  byText(view(env), 'button', 'Add project').click();
  await tick();
  assert.match(view(env).textContent, /not an existing directory/);
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'img').length, 0);
});

// ---- graph sync on the project page -----------------------------------------------------------------------------
const GIT_GRAPH = { mirrored: true, nodes: 6, edges: 4, synced_at: '2026-10-14T00:00:00Z', is_git: true, last_commit: '2026-10-15T08:00:00Z', stale: true, hooks_installed: false, opted_out: false, running: false };
const withGraph = (graph) => ({ '/api/wiki/page': { ...PAGE, graph } });

test('a stale git project says the graph is older than the last commit and offers Sync and Connect', async () => {
  const { env } = await boot('#/project/repo', withGraph(GIT_GRAPH));
  const v = view(env);
  assert.match(v.textContent, /The graph is older than the last commit \(2026-10-15/);
  assert.ok(byText(v, 'button', 'Sync graph now'));
  assert.ok(byText(v, 'button', 'Connect'));
});

test('an up to date graph says so; hooks installed or a plain directory hide Connect but keep Sync', async () => {
  let { env } = await boot('#/project/repo', withGraph({ ...GIT_GRAPH, stale: false, hooks_installed: true }));
  assert.match(view(env).textContent, /up to date with the last commit/);
  assert.ok(byText(view(env), 'button', 'Sync graph now'));
  assert.equal(byText(view(env), 'button', 'Connect'), undefined);
  ({ env } = await boot('#/project/repo', withGraph({ mirrored: false, nodes: 0, edges: 0, synced_at: null, howto: 'x', is_git: false, last_commit: null, stale: null, hooks_installed: false, opted_out: false, running: false })));
  assert.ok(byText(view(env), 'button', 'Sync graph now'), 'non-git projects sync too');
  assert.equal(byText(view(env), 'button', 'Connect'), undefined);
  assert.doesNotMatch(view(env).textContent, /older than the last commit|up to date with/);
});

test('Sync graph now posts the project with the token, disables the buttons and shows a status line', async () => {
  const posts = [];
  const { env } = await boot('#/project/repo', { ...withGraph(GIT_GRAPH), '/api/projects/graph-sync': async (opts) => { posts.push({ headers: opts.headers, body: JSON.parse(opts.body), method: opts.method }); return { started: true, project: 'repo' }; } });
  const btn = byText(view(env), 'button', 'Sync graph now');
  btn.click();
  await tick();
  assert.deepEqual(posts.map((p) => [p.method, p.body, p.headers['X-Portal-Token'], p.headers['Content-Type']]), [['POST', { project: 'repo' }, 'TOKEN-123', 'application/json']]);
  assert.ok('disabled' in btn.attrs, 'disabled while the refresh runs');
  assert.ok('disabled' in byText(view(env), 'button', 'Connect').attrs);
  assert.match(view(env).textContent, /Refresh started/);
});

test('a refused sync shows the server error and lets the user try again', async () => {
  const { env } = await boot('#/project/repo', { ...withGraph(GIT_GRAPH), '/api/projects/graph-sync': { __status: 409, error: 'graphify is not installed or not on the portal\'s PATH (install it with: pipx install graphifyy)' } });
  const btn = byText(view(env), 'button', 'Sync graph now');
  btn.click();
  await tick();
  assert.match(view(env).textContent, /graphify is not installed/);
  assert.equal('disabled' in btn.attrs, false);
});

test('Connect posts to graph-connect and then disappears', async () => {
  const posts = [];
  const { env } = await boot('#/project/repo', { '/api/wiki/page': async () => ({ ...PAGE, graph: { ...GIT_GRAPH, hooks_installed: posts.length > 0 } }), '/api/projects/graph-connect': async (opts) => { posts.push(JSON.parse(opts.body)); return { ok: true, project: 'repo' }; } });
  byText(view(env), 'button', 'Connect').click();
  await tick();
  assert.deepEqual(posts, [{ project: 'repo' }]);
  assert.match(view(env).textContent, /Connected: the git hooks are installed/);
  assert.equal(byText(view(env), 'button', 'Connect'), undefined);
  assert.equal('disabled' in byText(view(env), 'button', 'Sync graph now').attrs, false);
});

test('while a refresh is running the buttons are disabled and the page says so', async () => {
  const { env } = await boot('#/project/repo', withGraph({ ...GIT_GRAPH, running: true }));
  assert.match(view(env).textContent, /A graph refresh is running/);
  assert.ok('disabled' in byText(view(env), 'button', 'Sync graph now').attrs);
});
