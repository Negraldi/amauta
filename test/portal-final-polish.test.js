// T8 final polish (second re-critique 30/40): home order and feed cap, language leaks, one page-head order, palette node
// results, phone menu focus, Display anchoring, unknown tabs, pipeline steps. Each test names the critique number it pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC, readApp, readDicts } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const view = (env) => env.document.getElementById('view');
const cls = (e) => e.getAttribute('class') || e.className || '';
const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const css = (await read('style.css')) + (await read('style-pages.css'));
const html = await read('index.html');
const app = await readApp();
const design = await readFile(path.join(STATIC, '..', '..', '..', '..', 'docs', 'DESIGN.md'), 'utf8');
const { en: EN, es: ES, srv: SRV } = await readDicts();

const BASE = { '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false }, '/api/overview': { available: false },
  '/api/costs': { enabled: false, models: [] }, '/api/tools': { available: true, tools: [], skills: [], subagents: [], mcp_servers: [], mcp_tools: [] },
  '/api/pipelines': { available: false, projects: [] } };
async function boot(hash, routes = {}, extra = {}) {
  const env = makeEnv({ ...BASE, ...routes });
  env.location.hash = hash;
  const palette = env.document.getElementById('palette');
  palette.showModal = () => { palette.attrs.open = ''; };
  palette.close = () => { delete palette.attrs.open; };
  const ctx = await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  return { env, ctx };
}
const es = { navigator: { language: 'es-ES' } };
const byId = (env, id) => env.document.getElementById(id);

// ---- 1: Home shows the rail before the feed when collapsed, and caps the feed --------------------------------------------
const day = (d) => ({ day: d, items: [{ kind: 'memory', id: d, title: `m ${d}`, ts: `${d}T10:00:00Z`, what: 'memory saved' }] });
const HOME = { activity: ['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02', '2026-11-01'].map(day),
  spending: { available: false }, impact: null, health: { installed: false } };
test('1: Home has its head first, then the rail before the feed in the DOM; wide screens place the rail on the right', async () => {
  const { env } = await boot('#/', { '/api/wiki/home': HOME });
  const top = view(env).children.filter((e) => !/crumbs/.test(cls(e)));
  assert.equal(cls(top[0]), 'page-head');
  assert.equal(top[0].children[0].tagName, 'h1');
  const page = top.find((e) => /\bhome\b/.test(cls(e)));
  assert.ok(page, 'a .page.home grid');
  assert.deepEqual(page.children.map((e) => e.tagName), ['aside', 'article']);
  assert.match(css, /\.page\.home > \.rail \{[^}]*grid-column: 2;[^}]*grid-row: 1;/);
  const collapsed = /@media \(width < 72rem\) \{([\s\S]*?)\n\}/.exec(css)[1];
  assert.match(collapsed, /\.page\.home > \.rail, \.page\.home > \.doc \{[^}]*grid-column: auto;[^}]*grid-row: auto;/);
});
test('1: the feed shows the most recent days first and a Show more button reveals the rest', async () => {
  const { env } = await boot('#/', { '/api/wiki/home': HOME });
  const days = () => tree(view(env)).filter((e) => e.tagName === 'h3' && /^\d{4}-/.test(e.textContent)).map((e) => e.textContent);
  assert.deepEqual(days(), ['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04']);
  const more = tree(view(env)).find((e) => e.tagName === 'button' && /Show more/.test(e.textContent));
  assert.ok(more, 'a Show more button');
  more.click();
  assert.equal(days().length, 8);
  assert.ok(!tree(view(env)).some((e) => e.tagName === 'button' && /Show more/.test(e.textContent)), 'gone once everything shows');
});

// ---- 2: language leaks -----------------------------------------------------------------------------------------------
test('2: server diagram labels are translated before Mermaid draws, entities kept', async () => {
  const { ctx } = await boot('#/settings', { '/api/settings': { installed: false } }, es);
  const src = 'flowchart TB\n  s0(["feat: 1/3 done, 1 blocked"])\n  subgraph p0["Tasks"]\n    n1(["T1 ✓ done"])\n    n2["T2 ○ pending"]\n'
    + '    n3["2 more tasks #40;1 done#41;"]\n  end\n  subgraph g4["Hook events, in session order"]\n  end\n  n0 -->|"fires"| g4\n  n5["user text ✓ done"]';
  const out = ctx.localizedSource(src);
  assert.match(out, /"feat: 1\/3 hechas, bloqueadas: 1"/);
  assert.match(out, /p0\["Tareas"\]/);
  assert.match(out, /"T1 ✓ hecha"/);
  assert.match(out, /"T2 ○ pendiente"/);
  assert.match(out, /"Tareas restantes: 2 #40;hechas: 1#41;"/);
  assert.match(out, /"Eventos de hook, en orden de sesión"/);
  assert.match(out, /-->\|"dispara"\|/);
  assert.match(app, /localizedSource\(themedSource\(source\)\)|themedSource\(localizedSource\(source\)\)/);
});
test('2: every memory type the stores use has a label in both languages', () => {
  for (const v of ['project', 'user', 'feedback', 'reference', 'manual', 'tool_use', 'file_change', 'command', 'search', 'prompt'])
    for (const d of [EN, ES]) assert.ok(`memtype.${v}` in d, `memtype.${v}`);
  assert.equal(ES['memtype.project'], 'Proyecto');
});
test('2: palette group headings are plural, sentence-case labels', () => {
  const groups = Object.keys(EN).filter((k) => k.startsWith('palette.group.'));
  assert.ok(groups.length >= 17);
  for (const k of groups) for (const d of [EN, ES]) assert.match(d[k], /^[A-ZÁÉÍÓÚ]/, `${k}: ${d[k]}`);
  assert.equal(EN['palette.group.memory'], 'Memories');
  assert.equal(ES['palette.group.memory'], 'Memorias');
  assert.equal(ES['palette.group.node'], 'Nodos del grafo');
});
test('2: Spanish wording: source label, semantic pass sentence, Configuración, per-kind not-found titles', async () => {
  assert.doesNotMatch(SRV['Installed by amauta'], /Instaladas/);
  assert.ok(!('graph.semantic' in EN));
  assert.match(ES['graph.semanticPending'], /^Hay una pasada semántica pendiente\./);
  assert.match(ES['graph.semanticNone'], /^No hay ninguna pasada semántica pendiente\./);
  assert.doesNotMatch(ES['sec.lead'], /Ajustes/);
  for (const [k, v] of [...Object.entries(ES), ...Object.entries(SRV)]) assert.doesNotMatch(v, /\bAjustes\b|\bajustes$|\barn[ée]s\b/, k);
  const { env } = await boot('#/memory/zzz', { '/api/wiki/page': { __status: 404, error: 'not found' } }, es);
  assert.equal(tree(view(env)).find((e) => e.tagName === 'h1').textContent, 'Memoria no encontrada');
});
test('2: a session title the server composes reads in the UI language with grouped digits', async () => {
  const home = { ...HOME, activity: [{ day: '2026-11-08', items: [{ kind: 'session', id: 's1', title: 'amauta · claude-opus, 11570 messages · 2026-11-08',
    ts: '2026-11-08T10:00:00Z', what: 'session, 11570 messages' }, { kind: 'session', id: 's2', title: 'beta · unknown model, 1 message', ts: '2026-11-08T09:00:00Z',
    what: 'session, 1 message' }] }] };
  const { env } = await boot('#/', { '/api/wiki/home': home }, es);
  const links = tree(view(env)).filter((e) => e.tagName === 'a' && /^#\/session\//.test(e.getAttribute('href'))).map((e) => e.textContent);
  assert.deepEqual(links, ['amauta · claude-opus, 11.570 mensajes · 2026-11-08', 'beta · modelo desconocido, 1 mensaje']);
});
test('2: the hooks table shows a readable handler and the matcher as a separate muted detail', async () => {
  const comps = { total: 1, groups: [{ kind: 'hook', label: 'Hooks', items: [{ kind: 'hook', id: 'PreToolUse:aa', title: 'PreToolUse (Edit|Write) · amauta hooks: ', source: 's' }] }] };
  const { env } = await boot('#/harness', { '/api/harness': { installed: true, version: '1', hooks: [], mcp_servers: [], components: [] }, '/api/archify': { installed: false },
    '/api/harness/components': comps, '/api/skills': { groups: [] } });
  const cell = tree(view(env)).filter((e) => e.tagName === 'td').find((e) => tree(e).some((a) => a.tagName === 'a' && /#\/hook\//.test(a.getAttribute('href'))));
  const a = tree(cell).find((e) => e.tagName === 'a');
  assert.equal(a.textContent, 'amauta hooks');
  const detail = tree(cell).find((e) => e.tagName === 'span' && /muted/.test(cls(e)));
  assert.match(detail.textContent, /Edit\|Write/);
});

// ---- 3: one page-head order ----------------------------------------------------------------------------------------------
const order = (env) => tree(view(env)).filter((e) => e.tagName === 'h1' || (e.tagName === 'p' && cls(e) === 'lead') || (e.tagName === 'nav' && /tabs/.test(cls(e))))
  .map((e) => e.tagName);
const ROUTES = { '/api/memories': { available: true, items: [], facets: { types: [] } }, '/api/memory-files': { items: [{ id: 'a', name: 'n.md', project: 'a', size: 1, mtime: '2026-11-01T10:00:00Z' }] },
  '/api/wiki/lint': { scanned: { memories: 3 }, categories: [] }, '/api/settings': { installed: false } };
test('3: memory, memory files, quality and settings open with h1, one lead, then the tabs', async () => {
  for (const hash of ['#/memory', '#/memfile', '#/lint', '#/settings']) {
    const { env } = await boot(hash, ROUTES);
    assert.deepEqual(order(env), ['h1', 'p', 'nav'], hash);
  }
  const { env } = await boot('#/lint', ROUTES);
  assert.match(tree(view(env)).find((e) => cls(e) === 'lead').textContent, /review prompts.*3 memories/);
});
test('3: Activity pages no longer repeat the filter bar in words; item pages carry no kind label above the title', async () => {
  for (const hash of ['#/usage', '#/session', '#/tool']) {
    const { env } = await boot(hash);
    assert.ok(!tree(view(env)).some((e) => cls(e) === 'filter-state'), hash);
  }
  assert.doesNotMatch(app, /class: "kind"/);
  assert.doesNotMatch(css, /\n\.kind \{/);
});

// ---- 4: palette node results -------------------------------------------------------------------------------------------
test('4: node results with one title show the file basename, a left-ellipsized path, and duplicates of one file collapse', async () => {
  const long = '/home/u/code/a/very/deep/folder/structure/that/goes/on/src/render.js';
  const found = { groups: [{ kind: 'node', count: 3, items: [{ kind: 'node', id: 'r::1', title: 'render()', snippet: long },
    { kind: 'node', id: 'r::2', title: 'render()', snippet: long }, { kind: 'node', id: 'r::3', title: 'render()', snippet: '/home/u/code/b/view.js' }] }] };
  const { env } = await boot('#/session', { '/api/wiki/search': found });
  byId(env, 'search-open').click();
  const input = byId(env, 'palette-input');
  input.value = 'render';
  for (const fn of input.listeners.input) fn({});
  await tick(200);
  const rows = tree(byId(env, 'palette-results')).filter((e) => e.attrs.role === 'option');
  assert.equal(rows.length, 2, 'two nodes of one file are one row');
  assert.match(rows[0].children[0].textContent, /^render\(\) · render\.js$/);
  assert.match(rows[1].children[0].textContent, /^render\(\) · view\.js$/);
  const snip = rows[0].children[1].textContent;
  assert.match(snip, /^….*src\/render\.js$/);
  assert.ok(snip.length <= 40, snip);
  assert.match(tree(byId(env, 'palette-results')).find((e) => /pal-head/.test(cls(e))).textContent, /\(2\)$/);
});

// ---- 6, 7, 9: rail link target, dark scrims, Display anchored --------------------------------------------------------------
test('6: the home rail link to Pipelines is a 24px target', async () => {
  const pipes = { available: true, projects: [{ name: 'p', path: '/p', trusted: true, pipelines: [] }] };
  const { env } = await boot('#/', { '/api/wiki/home': HOME, '/api/pipelines': pipes });
  const a = tree(view(env)).find((e) => e.tagName === 'a' && e.getAttribute('href') === '#/pipelines');
  assert.match(cls(a), /\brail-link\b/);
  assert.match(css, /\.rail-link \{[^}]*min-block-size: var\(--hit\)/);
});
test('7: in dark, the palette backdrop and the phone-menu scrim are a darker black scrim', () => {
  for (const sel of ['.palette::backdrop', '.nav-scrim']) {
    const esc = sel.replace(/[.:]/g, (c) => `\\${c}`);
    assert.match(css, new RegExp(`:root\\[data-theme="dark"\\] ${esc}[^{]*\\{[^}]*oklch\\(0 0 0 / 0\\.55\\)`), sel);
    assert.match(css, new RegExp(`:root:not\\(\\[data-theme="light"\\]\\) ${esc}[^{]*\\{[^}]*oklch\\(0 0 0 / 0\\.55\\)`), sel);
  }
});
test('9: on phones the Display popover stays anchored under its button (no bottom sheet)', () => {
  const phone = /@media \(max-width: 560px\) \{([\s\S]*?)\n\}/.exec(css)[1];
  assert.doesNotMatch(phone, /#prefs/);
  assert.doesNotMatch(css, /bottom sheet/);
});

// ---- 8: phone menu focus and inert -----------------------------------------------------------------------------------------
test('8: opening the phone menu moves focus to the first nav link and makes the rest inert until it closes', async () => {
  const { env } = await boot('#/settings', { '/api/settings': { installed: false } });
  const toggle = byId(env, 'nav-toggle');
  toggle.click();
  const first = tree(byId(env, 'nav')).find((e) => e.tagName === 'a');
  assert.equal(first.focused, true);
  for (const id of ['view', 'search-open', 'topbar-end', 'filters']) assert.equal(byId(env, id).getAttribute('inert'), '', id);
  assert.equal(toggle.getAttribute('inert'), undefined);
  assert.match(html, /<div class="topbar-end" id="topbar-end">/);
  for (const fn of env.docListeners.keydown) fn({ key: 'Escape', target: {}, preventDefault() {} });
  for (const id of ['view', 'search-open', 'topbar-end', 'filters']) assert.equal(byId(env, id).getAttribute('inert'), undefined, id);
});

// ---- 10: unknown ?tab= ------------------------------------------------------------------------------------------------------
test('10: an unknown ?tab= value is dropped from the URL with replaceState', async () => {
  const replaced = [];
  const history = { replaceState: (_s, _t, url) => replaced.push(url) };
  await boot('#/settings?tab=nope', { '/api/settings': { installed: false } }, { history });
  await boot('#/settings?tab=sessions', { '/api/settings': { installed: false } }, { history });
  await boot('#/settings?tab=projects', { '/api/settings': { installed: false }, '/api/projects': { projects: [], config_repos: [], siblings: [] } }, { history });
  assert.deepEqual(replaced, ['#/settings', '#/settings']);
});

// ---- 11: pipeline steps on phones ------------------------------------------------------------------------------------------
const MODEL = { available: true, projects: [{ name: 'ml', path: '/work/ml', trusted: true, error: null, pipelines: [
  { id: 'model', name: 'Churn model', description: '', category: '', steps: ['Features', 'Train', 'Report'], ids: ['features', 'train', 'report'],
    types: ['python', 'python', 'command'], needs: [[], ['features'], []], step_modes: [null, ['train'], null], levels: [['features', 'report'], ['train']],
    modes: ['train', 'predict'], default_mode: 'predict', schedules: [], typical: null, last: null, history: [] }] }] };
test('11: the stage stays glued to the step name, and steps outside the mode are dimmed in color too', async () => {
  const { env } = await boot('#/pipelines', { '/api/pipelines': MODEL, '/api/projects': { projects: [] } });
  const items = tree(tree(view(env)).find((e) => /pipe-steps/.test(cls(e)))).filter((e) => e.tagName === 'li');
  const label = items[0].children.find((e) => e.tagName === 'span' && /^1\. Features/.test(e.textContent));
  assert.match(label.textContent, /^1\. Features · stage 1$/);
  assert.match(css, /\.pipe-steps li \{[^}]*color: var\(--ink\);/);
  assert.match(css, /\.pipe-steps li\[data-off="true"\] \{[^}]*color: var\(--ink-muted\)/);
});

// ---- 12, 14, 15 ------------------------------------------------------------------------------------------------------------
test('14: the project Sessions tab says what it counts, unlike Activity > Sessions', () => {
  assert.match(EN['project.sessionsScope'], /every day/);
  assert.match(EN['project.sessionsScope'], /date range/);
  assert.match(ES['project.sessionsScope'], /rango de fechas/);
});
test('15: DESIGN.md states the measured --line-strong contrast', () => {
  assert.match(design, /3\.54:1 on `--bg` and 3\.30:1 on `--surface` in light, 4\.25:1 and 4\.05:1 in dark/);
});

// ---- 2: the Spanish guide pages ---------------------------------------------------------------------------------------------
const TU = /(?<![\p{L}])(tú|tu|tus|ti|te|contigo|puedes|tienes|quieres|necesitas|debes|sabes|usas|ejecutas|abres|cambias|eliges|guardas|escribes|instalas|editas|pasas|pides|aceptas|decides|llamas|listes|tengas|puedas|quieras|uses|abras|veas|ejecutes|hagas|haz|asegúrate|fíjate)(?![\p{L}])/iu;
test('2: the Spanish guide pages say "harness", "Configuración" and use the usted register', async () => {
  const dir = path.join(STATIC, '..', 'guide', 'es');
  const { readdir } = await import('node:fs/promises');
  const hits = [];
  for (const f of await readdir(dir)) {
    (await readFile(path.join(dir, f), 'utf8')).split('\n').forEach((line, i) => {
      const prose = line.replace(/`[^`]*`/g, '');
      const m = TU.exec(prose) || /(?<!\p{L})arn[ée]s(?!\p{L})|\bAjustes\b/u.exec(prose);
      if (m) hits.push(`${f}:${i + 1}: ${m[0]}`);
    });
  }
  assert.deepEqual(hits, []);
});
test('2: the Spanish dictionaries use the usted register too', () => {
  const hits = [...Object.entries(ES), ...Object.entries(SRV)].filter(([, v]) => TU.test(v)).map(([k]) => k);
  assert.deepEqual(hits, []);
});
