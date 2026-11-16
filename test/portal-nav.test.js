// Job-based navigation model (portal redesign T1): the NAV data, redirects, hubs, breadcrumbs, filters, segments, palette and error panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const rctx = {};
vm.runInNewContext(await readFile(path.join(STATIC, 'wikiroute.js'), 'utf8'), rctx);
const R = rctx.AmautaRoute;
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));

// ---- the model (pure) --------------------------------------------------------------------------------------------
test('NAV lists the job groups in order, each item with its hub, hash, label key and tabs', () => {
  assert.deepEqual(plain(R.NAV.map((g) => g.id)), ['today', 'work', 'knowledge', 'activity', 'harnessWiki', 'foot']);
  const items = R.NAV.flatMap((g) => g.items.map((i) => [g.id, i.hub, i.hash]));
  assert.deepEqual(plain(items), [['today', 'home', '#/'], ['work', 'project', '#/project'], ['work', 'pipelines', '#/pipelines'],
    ['knowledge', 'memory', '#/memory'], ['knowledge', 'graph', '#/node'], ['activity', 'usage', '#/usage'],
    ['harnessWiki', 'harness', '#/harness'], ['harnessWiki', 'component', '#/component'], ['harnessWiki', 'security', '#/security'],
    ['foot', 'guide', '#/guide'], ['foot', 'settings', '#/settings']]);
  const tabs = (hub) => plain(R.NAV.flatMap((g) => g.items).find((i) => i.hub === hub).tabs.map((t) => t.kind));
  assert.deepEqual(tabs('memory'), ['memory', 'memfile', 'lint']);
  assert.deepEqual(tabs('usage'), ['usage', 'session', 'tool']);
  assert.equal(R.NAV.flatMap((g) => g.items).find((i) => i.hub === 'settings').tabs, undefined, 'Settings tabs ride in ?tab=, not in the nav model');
  assert.ok(R.NAV.every((g) => typeof g.key === 'string' && g.items.every((i) => /^nav\./.test(i.key))));
  assert.equal(R.NAV.find((g) => g.id === 'foot').foot, true);
});

test('parseHash exposes known query params as route.query and keeps ?source=engram on items', () => {
  assert.deepEqual(plain(R.parseHash('#/tool?seg=mcp')), { kind: 'tool', id: '', query: { seg: 'mcp' } });
  assert.deepEqual(plain(R.parseHash('#/component?kind=skill')), { kind: 'component', id: '', query: { kind: 'skill' } });
  assert.deepEqual(plain(R.parseHash('#/tool?seg=evil&x=1')), { kind: 'tool', id: '' }, 'unknown params and values are dropped');
  assert.deepEqual(plain(R.parseHash('#/memory/7?source=engram')), { kind: 'memory', id: '7', source: 'engram', query: { source: 'engram' } });
  assert.equal(R.routeHash(R.parseHash('#/tool?seg=mcp')), '#/tool?seg=mcp');
  assert.equal(R.routeHash({ kind: 'home', id: '' }), '#/');
});

test('every old hash redirects to its new home; item routes keep working unchanged', () => {
  const moves = { '#/mcp': '#/tool?seg=mcp', '#/skill': '#/component?kind=skill', '#/diagrams': '#/harness', '#diagrams': '#/harness',
    '#/activity': '#/usage', '#/activity/sessions': '#/session', '#/activity/tools': '#/tool', '#/activity/mcp': '#/tool?seg=mcp',
    '#overview': '#/', '#sessions': '#/session', '#memories': '#/memory', '#usage': '#/usage', '#harness': '#/harness' };
  for (const [from, to] of Object.entries(moves)) {
    assert.equal(R.redirectOf(from), to, from);
    assert.equal(R.routeHash(R.parseHash(from)), to, `${from} parses to its target`);
  }
  for (const h of ['#/skill/x', '#/mcp/engram', '#/hook/Stop%3Aa', '#/tool', '#/', '#/memory/7?source=engram']) assert.equal(R.redirectOf(h), null, h);
  assert.deepEqual(plain(R.parseHash('#/mcp/engram')), { kind: 'mcp', id: 'engram' });
  assert.deepEqual(plain(R.parseHash('#/skill/work-unit-commits')), { kind: 'skill', id: 'work-unit-commits' });
});

test('hubOf maps every kind (or route) to its sidebar hub; tabOf names the tab of a hub with tabs', () => {
  const want = { home: 'home', project: 'project', feature: 'project', pipelines: 'pipelines', memory: 'memory', memfile: 'memory', lint: 'memory',
    node: 'graph', usage: 'usage', session: 'usage', tool: 'usage', mcp: 'usage', harness: 'harness', component: 'component', skill: 'component',
    hook: 'component', agent: 'component', mcptool: 'component', connector: 'component', command: 'component', plugin: 'component',
    outputstyle: 'component', security: 'security', guide: 'guide', settings: 'settings', themes: 'settings' };
  for (const [kind, hub] of Object.entries(want)) {
    assert.equal(R.hubOf(kind), hub, kind);
    // An MCP server or built-in tool page is a Catalog item (T6), although the old #/mcp list folds into Tools and skills.
    assert.equal(R.hubOf({ kind, id: 'x' }), ['mcp', 'tool'].includes(kind) ? 'component' : hub, `${kind} item`);
  }
  for (const k of Object.keys(R.KINDS)) assert.ok(R.NAV.some((g) => g.items.some((i) => i.hub === R.hubOf(k))), `${k} has a hub`);
  assert.equal(R.tabOf({ kind: 'session', id: 'abc' }), 'session');
  assert.equal(R.tabOf({ kind: 'mcp', id: 'engram' }), null, 'a Catalog item, not an Activity tab');
  assert.equal(R.tabOf({ kind: 'memfile', id: 'f' }), 'memfile');
  assert.equal(R.tabOf({ kind: 'hook', id: 'x' }), null);
});

test('crumbs: group, hub (or tab) and the item; list pages stop at the hub', () => {
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/hook/X'))), [{ key: 'nav.group.harnessWiki' }, { key: 'nav.catalog', hash: '#/component' },
    { key: 'catalog.kind.hook', hash: '#/component?kind=hook' }, { text: 'X' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/feature/proj/name'))),
    [{ key: 'nav.group.work' }, { key: 'nav.project', hash: '#/project' }, { text: 'proj', hash: '#/project/proj?tab=features' }, { text: 'name' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/memory/k'))), [{ key: 'nav.group.knowledge' }, { key: 'nav.memory', hash: '#/memory' }, { text: 'k' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/session/id'))), [{ key: 'nav.activity' }, { key: 'nav.usage', hash: '#/usage' },
    { key: 'nav.session', hash: '#/session' }, { text: 'id' }]); // the hub the sidebar highlights, then its tab (T15 A14)
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/mcp/engram'))), [{ key: 'nav.group.harnessWiki' }, { key: 'nav.catalog', hash: '#/component' },
    { key: 'catalog.kind.mcp', hash: '#/component?kind=mcp' }, { text: 'engram' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/skill/s'))), [{ key: 'nav.group.harnessWiki' }, { key: 'nav.catalog', hash: '#/component' },
    { key: 'catalog.kind.skill', hash: '#/component?kind=skill' }, { text: 's' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/session'))), [{ key: 'nav.activity' }, { key: 'nav.usage', hash: '#/usage' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/lint'))), [{ key: 'nav.group.knowledge' }, { key: 'nav.memory', hash: '#/memory' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/themes'))), [{ key: 'nav.settings', hash: '#/settings' }], 'foot pages have no group; no tab crumb');
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/nope'))), []);
});

test('the Range/Project/Runtime filters belong to the Activity list routes only', () => {
  for (const kind of ['usage', 'session', 'tool']) assert.equal(R.showsFilters({ kind, id: '' }), true, kind);
  for (const kind of ['session', 'tool', 'mcp']) assert.equal(R.showsFilters({ kind, id: 'x' }), false, `${kind} item`);
  for (const kind of ['memory', 'memfile', 'lint', 'home', 'component', 'project']) assert.equal(R.showsFilters({ kind, id: '' }), false, kind);
});

// ---- the shell (fake DOM) -----------------------------------------------------------------------------------------
const routes = () => ({
  '/api/wiki/recent': { items: [] }, '/api/overview': { available: false }, '/api/costs': { enabled: false, models: [] },
  '/api/sessions': { available: true, projects: [{ project: 'alpha', sessions: 1 }], sessions: [] },
  '/api/tools': { available: true, tools: [{ name: 'Bash', count: 1, sessions: 1, last_used: 'x' }], skills: [], subagents: [], mcp_servers: [{ name: 'engram', count: 2, sessions: 1, last_used: 'x' }], mcp_tools: [] },
  '/api/memories': { available: true, items: [], facets: { types: [] } }, '/api/memory-files': { items: [] }, '/api/graphify': { repos: [] }, '/api/projects': { projects: [] },
  '/api/wiki/page': { kind: 'hook', id: 'X', title: 'X', body_md: null, meta: [], links: [], backlinks: [], sections: [], missing: [] },
});
async function boot(hash, over = {}, extra = {}) {
  const env = makeEnv({ ...routes(), ...over });
  env.location.hash = hash;
  const closed = [];
  const palette = env.document.getElementById('palette');
  palette.showModal = () => {};
  palette.close = () => closed.push('close');
  await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  return { env, closed };
}
const view = (env) => env.document.getElementById('view');
const crumbNav = (env) => view(env).children.find((e) => e.tagName === 'nav' && e.getAttribute('aria-label') === 'Breadcrumb');

test('the sidebar renders the groups from R.NAV, Guide and Settings in a separate foot, and marks the hub', async () => {
  const { env } = await boot('#/session/abc');
  const nav = env.document.getElementById('nav');
  assert.deepEqual(hrefs(nav), ['#/', '#/project', '#/pipelines', '#/memory', '#/node', '#/usage', '#/harness', '#/component', '#/security', '#/guide', '#/settings']);
  const foot = tree(nav).find((e) => /\bnav-foot\b/.test(e.className || ''));
  assert.ok(foot, 'foot block');
  assert.deepEqual(hrefs(foot), ['#/guide', '#/settings']);
  assert.match(nav.textContent, /Harness wiki/);
  const current = tree(nav).filter((e) => e.getAttribute && e.getAttribute('aria-current') === 'page');
  assert.deepEqual(current.map((e) => e.getAttribute('href')), ['#/usage']);
});

test('an item page opens with a breadcrumb (text only, last item current) above its title', async () => {
  const { env } = await boot('#/hook/X');
  const crumbs = crumbNav(env);
  assert.ok(crumbs, 'breadcrumb nav');
  assert.equal(view(env).children[0], crumbs, 'first in the view');
  const ol = crumbs.children[0];
  assert.equal(ol.tagName, 'ol');
  assert.deepEqual(ol.children.map((li) => li.textContent), ['Harness wiki', 'Catalog', 'Hooks', 'X']);
  assert.deepEqual(hrefs(crumbs), ['#/component', '#/component?kind=hook']);
  const last = tree(ol.children[3]).find((e) => e.getAttribute && e.getAttribute('aria-current') === 'page');
  assert.ok(last, 'the last crumb is the current page');
});

test('list pages show the breadcrumb, the title, then the tabs of their hub (T8 j: one page-head pattern)', async () => {
  const { env } = await boot('#/session');
  const kids = view(env).children;
  assert.equal(kids[0], crumbNav(env));
  assert.equal(kids[1].tagName, 'header');
  const tabs = kids[2];
  assert.equal(tabs.className, 'tabs');
  assert.deepEqual(hrefs(tabs), ['#/usage', '#/session', '#/tool']);
  assert.match(tabs.textContent, /Tools and skills/);
  const mem = await boot('#/memory');
  assert.deepEqual(hrefs(mem.env.document.getElementById('view').children[2]), ['#/memory', '#/memfile', '#/lint']);
  assert.match(mem.env.document.getElementById('view').children[2].textContent, /Quality/);
});

test('Memory never filters by the hidden Project select, and the filter bar is hidden there', async () => {
  const env = makeEnv(routes());
  env.location.hash = '#/memory';
  env.document.getElementById('project').value = 'alpha';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const call = env.calls.find((c) => String(c.url).startsWith('/api/memories'));
  assert.ok(call, 'memories requested');
  assert.doesNotMatch(call.url, /project=/);
  assert.equal(env.document.getElementById('filters').hidden, true);
});

test('the Tools and skills segment lives in the hash: ?seg= selects it and a click writes it', async () => {
  const { env } = await boot('#/tool?seg=mcp');
  const links = tree(view(env)).filter((e) => e.tagName === 'a' && /^#\/tool\?seg=/.test(e.getAttribute('href'))); // links since T5
  const current = links.filter((b) => b.getAttribute('aria-current') === 'true');
  assert.equal(current.length, 1);
  assert.match(current[0].textContent, /MCP servers/);
  assert.match(view(env).textContent, /engram/);
  assert.equal(links.find((b) => /^Skills/.test(b.textContent)).getAttribute('href'), '#/tool?seg=skills');
  const usage = await boot('#/usage');
  assert.equal(tree(view(usage.env)).filter((e) => e.getAttribute && e.getAttribute('aria-current') === 'true').length, 0, 'the segment shows once, on its tab');
});

test('an old hash is rewritten in place (replaceState) and renders the new page', async () => {
  const replaced = [];
  const { env } = await boot('#/mcp', {}, { history: { replaceState: (_s, _t, url) => replaced.push(url) } });
  assert.deepEqual(replaced, ['#/tool?seg=mcp']);
  assert.match(view(env).textContent, /engram/);
});

test('the search palette closes on the first Escape and on every route change', async () => {
  const { env, closed } = await boot('#/settings');
  const input = env.document.getElementById('palette-input');
  let prevented = false;
  for (const fn of input.listeners.keydown ?? []) fn({ key: 'Escape', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(closed.length, 1);
  env.location.hash = '#/memory';
  env.listeners.hashchange();
  assert.equal(closed.length, 2);
});

test('a failing page shows a short message, two actions: Retry and Go to Today', async () => {
  let fail = true;
  const { env } = await boot('#/lint', { '/api/wiki/lint': async () => (fail ? { __status: 500, error: 'boom' } : { scanned: {}, categories: [] }) });
  const v = view(env);
  assert.match(v.textContent, /could not load/i);
  assert.doesNotMatch(v.textContent, /#\/lint/, 'the raw route is not shown (T16d F4)');
  const buttons = tree(v).filter((e) => e.tagName === 'button');
  const retry = buttons.find((b) => b.textContent === 'Retry');
  assert.ok(retry, 'Retry');
  const home = tree(v).find((e) => e.textContent === 'Go to Today' && (e.tagName === 'a' || e.tagName === 'button'));
  assert.ok(home, 'Go to Today');
  fail = false;
  retry.click();
  await tick();
  assert.doesNotMatch(view(env).textContent, /could not load/i);
});

test('stale comments are gone: no "six pages" left in the shell', async () => {
  const src = await readFile(path.join(STATIC, 'app.js'), 'utf8') + await readFile(path.join(STATIC, 'wikiroute.js'), 'utf8');
  assert.doesNotMatch(src, /six pages|six-page/i);
});
