// T19h: findings of the browser review. F1: the outline of a flowchart uses the same translated, decoded labels as the drawn diagram and
// never lists a subgraph id (an edge to or from a subgraph uses its title); F2: focus follows the diagram/list toggle; F3: the
// palette starts empty and clears with its input; F4: the catalog intro follows the runtime filter; F6: error titles from an id;
// F7: repo and project selects sorted. Pure parts run in the fake DOM context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Element } from './helpers/fakedom.js';
import { boot, tick, tree } from './helpers/t15w3.js';

const run = (c, code) => vm.runInContext(code, c);
const json = (x) => JSON.parse(JSON.stringify(x));
const call = (c, fn, ...args) => { c.__a = args; return json(run(c, `${fn}(...__a)`)); };
const ctx = async (extra = {}) => (await boot('#/', { '/api/guide': { pages: [] } }, extra)).__ctx;

const ARCH = [
  'flowchart LR', '  n0["Runtime"]', '  subgraph g1["amauta kernel"]', '    n2["Dispatch"]', '  end',
  '  subgraph g3["Hooks"]', '    n4["Stop"]', '  end',
  '  n0 -->|"fires"| g3', '  g3 -->|"runs handlers"| g1', '  n0 -->|"memory reads#44; writes"| n2',
].join('\n');

test('F1: the outline never lists a subgraph id; edges to and from a subgraph use its title', async () => {
  const c = await ctx();
  const out = call(c, 'flowOutline', ARCH);
  const nodes = out.flatMap((g) => g.nodes);
  assert.ok(nodes.every((n) => !/^g\d+$/.test(n.id) && !/^g\d+$/.test(n.label)), JSON.stringify(nodes));
  const runtime = nodes.find((n) => n.label === 'Runtime');
  assert.deepEqual(runtime.edges.map((e) => e.to), ['Hooks', 'Dispatch']);
  const hooks = out.find((g) => g.title === 'Hooks');
  assert.deepEqual(hooks.edges, [{ to: 'amauta kernel', label: 'runs handlers' }], 'an edge out of a subgraph hangs on its group');
  assert.equal(runtime.edges[1].label, 'memory reads, writes', 'entity codes are decoded');
});

test('F1: in Spanish the outline translates node, subgraph and edge labels like the drawn diagram', async () => {
  const env = await boot('#/', { '/api/guide': { pages: [] } }, { navigator: { language: 'es-ES' } });
  const c = env.__ctx;
  c.__src = ARCH;
  const el = run(c, 'outlineList(__src, "x")');
  const text = tree(el).map((e) => e.textContent).join('|');
  assert.ok(text.includes('dispara'), text);
  assert.ok(text.includes('ejecuta los manejadores'), text);
  assert.ok(!text.includes('(fires)') && !/\bg\d+\b/.test(text), text);
});

test('F1: the outline box wraps instead of growing to the diagram width', async () => {
  const css = (await import('node:fs')).readFileSync(new URL('../python/amauta/portal/static/style-pages.css', import.meta.url), 'utf8');
  assert.match(css, /\.arch-scroll \.diagram\.outline\s*\{[^}]*width:\s*auto/);
});

// ---- F2: focus follows the toggle that re-renders itself ----
class FakeParser {
  parseFromString(svg) {
    const el = new Element('svg');
    el.style = {};
    el.viewBox = { baseVal: { width: Number(/viewBox="0 0 (\d+)/.exec(svg)[1]) } };
    return { body: { querySelector: () => el } };
  }
}
test('F2: after the diagram/list toggle the new toggle button has focus', async () => {
  const env = await boot('#/', { '/api/guide': { pages: [] } }, { DOMParser: FakeParser });
  const c = env.__ctx;
  env.document.importNode = (n) => n;
  c.__mm = { initialize() {}, render: async () => ({ svg: '<svg viewBox="0 0 900 100"></svg>' }) };
  run(c, 'mermaidReady = Promise.resolve(__mm)');
  c.__src = 'flowchart LR\n  A["a"] --> B["b"]';
  const box = run(c, 'adaptiveDiagram(__src, "Diagram")');
  box.isConnected = true; box.clientWidth = 300;
  await tick(80);
  const button = () => tree(box).find((e) => e.tagName === 'button');
  button().click();
  assert.equal(button().focused, true, 'the button to see the list has focus');
  await tick(60);
  button().focused = false;
  button().click();
  assert.equal(button().focused, true, 'the button to see the diagram has focus');
  assert.match(box.className, /outline/, 'the outline box wraps');
});

// ---- F3: the palette has no stale state ----
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, readDicts } from './helpers/portalboot.js';

async function palette(search) {
  const env = makeEnv({ '/api/wiki/home': { activity: [], spending: { available: false }, health: { installed: false } }, '/api/pipelines': { projects: [] },
    '/api/wiki/search': search });
  env.location.hash = '#/';
  const c = await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const input = env.document.getElementById('palette-input'), results = env.document.getElementById('palette-results');
  const type = (value) => { input.value = value; for (const fn of input.listeners.input ?? []) fn({ target: input }); };
  return { c, input, results, type };
}
const HIT = { groups: [{ kind: 'memory', items: [{ kind: 'memory', id: '1', title: 'Widgets' }] }] };

test('F3: clearing the input returns to the empty state at once, and a late answer does not repaint it', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const { results, type } = await palette(async () => { if (++calls === 2) await gate; return HIT; });
  type('widg');
  await tick(250);
  assert.match(results.textContent, /Widgets/);
  type('widgets');
  await tick(200);
  type('');
  assert.match(results.textContent, /Type to search/, 'the hint, before any debounce');
  release();
  await tick(60);
  assert.doesNotMatch(results.textContent, /Widgets/, 'the late answer is dropped');
  assert.equal(results.getAttribute('aria-busy'), undefined);
});

test('F3: clearing the input removes a failure note', async () => {
  const { results, type } = await palette(async () => { throw new Error('boom'); });
  type('widg');
  await tick(250);
  assert.match(results.textContent, /Search failed/);
  type('');
  assert.doesNotMatch(results.textContent, /failed/);
  assert.match(results.textContent, /Type to search/);
});

test('F3: reopening the palette after closing it starts empty', async () => {
  const { c, input, results, type } = await palette(async () => HIT);
  run(c, 'openPalette()');
  type('widg');
  await tick(250);
  assert.match(results.textContent, /Widgets/);
  run(c, 'closePalette(true)');
  run(c, 'openPalette()');
  assert.equal(input.value, '');
  assert.match(results.textContent, /Type to search/);
  assert.doesNotMatch(results.textContent, /Widgets/);
});

test('F3: the placeholder is short in both languages and the long list lives in the hint', async () => {
  const d = await readDicts();
  for (const lang of ['en', 'es']) assert.ok(d[lang]['palette.placeholder'].length <= 24, d[lang]['palette.placeholder']);
  assert.match(d.en['palette.hint'], /memories, skills, tools, sessions, features/);
  assert.match(d.es['palette.hint'], /memorias, skills, herramientas, sesiones, funcionalidades/);
});

// ---- F4: the catalog intro follows the runtime filter ----
import { view, text, ES } from './helpers/t15w3.js';
const item = (kind, id, runtimes) => ({ kind, id, title: id, description: `About ${id}`, source: 'Your Claude home', uses: 0, ...(runtimes ? { runtimes } : {}) });
const COMPS = { total: 3, pending: 0, refresh: { servers: 0 }, groups: [
  { kind: 'hook', label: 'Hooks', items: [item('hook', 'a', ['claude']), item('hook', 'b', ['codex']), item('hook', 'c', ['claude', 'codex'])] }] };
const CAT = { '/api/harness/components': COMPS, '/api/skills': { total: 0, groups: [] } };

test('F4: the intro count follows the runtime filter and says so, and the kinds include instruction blocks', async () => {
  const all = await boot('#/component', CAT);
  assert.match(text(all), /3 things installed in your harness/);
  assert.match(text(all), /instruction blocks/);
  const codex = await boot('#/component?runtime=codex', CAT);
  assert.match(text(codex), /2 of 3 things in your harness apply to Codex/);
  assert.doesNotMatch(text(codex), /3 things installed/);
  const es = await boot('#/component?runtime=codex', CAT, ES);
  assert.match(text(es), /2 de 3 elementos de su harness se aplican a Codex/);
  const esAll = await boot('#/component', CAT, ES);
  assert.match(text(esAll), /bloques de instrucciones/);
  void view;
});

// ---- F5: a block's summary names every file, once ----
test('F5: the summary lists each origin and the Configured in section does not repeat them', async () => {
  const page = { kind: 'instructions', id: 'g', title: 'g', body_md: 'Body.', links: [], backlinks: [], missing: [],
    meta: [{ label: 'Runtime', value: 'Claude Code, Codex' }],
    sections: [{ heading: 'Configured in', items: [{ label: '/h/.claude/CLAUDE.md', value: 'Your Claude home', kind: null, id: null },
      { label: '/h/.codex/AGENTS.md', value: 'Your Codex home', kind: null, id: null }] }],
    summary: { description: 'D.', trigger: null, when: 'W.', source: 'Your Claude home', path: '/h/.claude/CLAUDE.md', builtin: false, note: null,
      origins: [{ source: 'Your Claude home', path: '/h/.claude/CLAUDE.md' }, { source: 'Your Codex home', path: '/h/.codex/AGENTS.md' }] } };
  const env = await boot('#/instructions/g', { '/api/wiki/page': page });
  const t = text(env);
  for (const p of ['/h/.claude/CLAUDE.md', '/h/.codex/AGENTS.md']) assert.equal(t.split(p).length - 1, 1, `${p} once in: ${t}`);
  assert.match(t, /Your Codex home/);
  assert.doesNotMatch(t, /Configured in/);
});

// ---- F6: a failed detail page names itself from its id, never the raw id ----
const HTTP500 = { __status: 500, error: 'boom' };
async function failed(id, kind, extra) {
  const env = await boot(`#/${kind}/${encodeURIComponent(id)}`, { '/api/wiki/page': HTTP500 }, extra);
  const h1 = tree(view(env)).find((e) => e.tagName === 'h1').textContent;
  const crumb = tree(view(env)).filter((e) => e.className === 'crumbs')[0].textContent;
  return { h1, crumb, title: env.document.title };
}
test('F6: a node falls back to the part after ::, a session to its short id, a memory file to its file name', async () => {
  const node = await failed('amauta::src_install_installer', 'node');
  assert.equal(node.h1, 'src_install_installer');
  assert.match(node.crumb, /src_install_installer/);
  assert.doesNotMatch(node.crumb + node.title, /amauta::/);
  const sess = await failed('01a1c00f-1234-4abc-8def-0123456789ab', 'session');
  assert.equal(sess.h1, 'Session 01a1c00f');
  assert.doesNotMatch(sess.crumb + sess.title, /1234/);
  assert.equal((await failed('01a1c00f-1234-4abc-8def-0123456789ab', 'session', { navigator: { language: 'es-ES' } })).h1, 'Sesión 01a1c00f');
  const file = await failed('-home-negraldi/memory/ge66-rgb-lightbar.md', 'memfile');
  assert.equal(file.h1, 'ge66-rgb-lightbar.md');
  assert.doesNotMatch(file.crumb + file.title, /-home-negraldi/);
});

// ---- F7: pickers of names are sorted A to Z, the "all" option first ----
test('F7: the project select lists the projects A to Z (case-insensitive) after "All projects"', async () => {
  const env = await boot('#/usage', { '/api/sessions': { available: true, sessions: [], projects: [{ project: 'zeta' }, { project: 'Beta' }, { project: 'alpha' }] },
    '/api/overview': { available: false, totals: {}, daily: [], models: [], runtimes: [] }, '/api/costs': { enabled: false }, '/api/projects': { projects: [] } });
  const opts = tree(env.document.getElementById('project')).filter((e) => e.tagName === 'option').map((e) => e.textContent);
  assert.deepEqual(opts, ['All projects', 'alpha', 'Beta', 'zeta']);
});
test('F7: the repo select of the graph explorer lists the repos A to Z', async () => {
  const repo = (name) => ({ name, path: `/r/${name}`, available: true, nodes: 1, edges: 0, synced_at: null, stale: false });
  const env = await boot('#/node', { '/api/graphify': { repos: [repo('zeta'), repo('Beta'), repo('alpha')] }, '/api/projects': { projects: [] } });
  const sel = tree(view(env)).find((e) => e.tagName === 'select' && e.getAttribute('aria-label') === 'Repository');
  assert.ok(sel, 'the picker exists');
  assert.deepEqual(tree(sel).filter((e) => e.tagName === 'option').map((e) => e.textContent), ['alpha', 'Beta', 'zeta']);
});
