// T8 polish round (re-critique 29/40): phone menu, scroll boxes, control contrast, pipelines, page heads, labels, home status,
// palette, error paths. Each test names the critique letter it pins.
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
const { en: EN, es: ES } = await readDicts();
const rctx = {};
vm.runInNewContext(await read('wikiroute.js'), rctx);
const R = rctx.AmautaRoute;
const tctx = {};
vm.runInNewContext(await read('theme.js'), tctx);
const T = tctx.AmautaTheme;

const BASE = { '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false }, '/api/overview': { available: false },
  '/api/costs': { enabled: false, models: [] }, '/api/tools': { available: true, tools: [], skills: [], subagents: [], mcp_servers: [], mcp_tools: [] } };
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
const byId = (env, id) => env.document.getElementById(id);

// ---- a: the phone menu closes ---------------------------------------------------------------------------------------
test('a: the phone menu closes on Esc and on the scrim, returning focus to the Menu button', async () => {
  const { env } = await boot('#/settings', { '/api/settings': { installed: false } });
  const toggle = byId(env, 'nav-toggle'), shell = byId(env, 'shell');
  toggle.click();
  assert.equal(shell.getAttribute('data-nav'), 'open');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  for (const fn of env.docListeners.keydown) fn({ key: 'Escape', target: env.document.body || {}, preventDefault() {} });
  assert.equal(shell.getAttribute('data-nav'), 'closed');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.focused, true);
  toggle.focused = false;
  toggle.click();
  byId(env, 'nav-scrim').click();
  assert.equal(shell.getAttribute('data-nav'), 'closed');
  assert.equal(toggle.focused, true);
  assert.match(html, /<div class="nav-scrim" id="nav-scrim"[^>]*><\/div>/);
  assert.match(css, /\.shell\[data-nav="open"\] \.nav-scrim \{[^}]*display: block/);
});

// ---- b, o: tables scroll sideways in their own box, never vertically -------------------------------------------------
test('b: every table built by a page sits in a keyboard-reachable scroll box', () => {
  for (const m of app.matchAll(/h\("table"/g)) {
    const before = app.slice(Math.max(0, m.index - 120), m.index);
    assert.match(before, /scrollBox\(|class: "scroll", tabindex: 0, role: "region"/, app.slice(m.index - 80, m.index + 60));
  }
});
test('o: a scroll box scrolls sideways only; the page scrolls vertically', () => {
  const rule = /\n\.scroll \{([^}]*)\}/.exec(css)[1];
  assert.doesNotMatch(rule, /max-height/);
  assert.match(rule, /overflow-x: auto/);
});

// ---- c, d: placeholder and control boundaries ------------------------------------------------------------------------
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([a-z-]+):\s*oklch\(([^)]+)\)/g)].map((m) => [m[1], m[2].trim().split(/\s+/).map(Number)]));
const SCHEMES = { light: block(/:root \{([\s\S]*?)\n\}/), dark: block(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/) };
const ok = (v) => `oklch(${v.join(' ')})`;
test('c: placeholder text uses the muted ink at full opacity', () => {
  assert.match(css, /::placeholder \{ color: var\(--ink-muted\); opacity: 1; \}/);
});
test('d: form controls have a >= 3:1 boundary (--line-strong, mixed from ink-muted and bg) in both schemes', () => {
  const m = /--line-strong: color-mix\(in oklch, var\(--ink-muted\) (\d+)%, var\(--bg\)\);/.exec(css);
  assert.ok(m, '--line-strong is derived, not a 15th pinned token');
  const p = Number(m[1]) / 100;
  for (const scheme of ['light', 'dark']) {
    const s = SCHEMES[scheme], [a, b] = [s['ink-muted'], s.bg];
    const mix = [a[0] * p + b[0] * (1 - p), a[1] * p + b[1] * (1 - p), a[2]]; // bg is achromatic: its hue is missing, ink-muted's is kept
    for (const bg of ['bg', 'surface']) {
      const r = T.contrast(ok(mix), ok(s[bg]));
      assert.ok(r >= 3, `${scheme} --line-strong on --${bg} is ${r.toFixed(2)}:1`);
    }
  }
  assert.match(css, /select, input, textarea, button, a\.button \{[^}]*border: 1px solid var\(--line-strong\)/);
  assert.match(design, /--line-strong/);
});

// ---- e, f: pipelines -------------------------------------------------------------------------------------------------
const MODEL = { available: true, projects: [{ name: 'ml', path: '/work/ml', trusted: true, error: null, pipelines: [
  { id: 'model', name: 'Churn model', description: '', category: '', steps: ['Features', 'Train', 'Predict', 'Report'],
    ids: ['features', 'train', 'predict', 'report'], types: ['python', 'python', 'python', 'command'],
    needs: [[], ['features'], ['features', 'train'], []], step_modes: [null, ['train'], ['predict'], null],
    levels: [['features', 'report'], ['train'], ['predict']], modes: ['train', 'predict'], default_mode: 'predict',
    schedules: [], typical: null, last: null, history: [] }] }] };
const PIPES = { '/api/pipelines': MODEL, '/api/projects': { projects: [] }, '/api/wiki/home': { activity: [], spending: { available: false }, impact: null, health: { installed: false } } };
test('e: Run is a plain button; only the confirm step is the accent-filled primary', async () => {
  const { env } = await boot('#/pipelines', PIPES);
  const btn = (text) => tree(view(env)).find((e) => e.tagName === 'button' && e.textContent === text);
  assert.doesNotMatch(cls(btn('Run')), /primary/);
  btn('Run').click();
  assert.match(cls(btn('Run now')), /primary/);
});
test('f: steps are listed in declared order with their stage, and a step outside the mode says so in words', async () => {
  const { env } = await boot('#/pipelines', PIPES);
  const steps = tree(view(env)).find((e) => /pipe-steps/.test(cls(e)));
  const items = tree(steps).filter((e) => e.tagName === 'li');
  assert.deepEqual(items.map((e) => e.getAttribute('data-id')), ['features', 'train', 'predict', 'report']);
  assert.match(items[3].textContent, /stage\s1/);
  assert.match(items[1].textContent, /not in this mode/);
  assert.doesNotMatch(items[2].textContent, /not in this mode/);
  assert.doesNotMatch(css, /line-through/);
});

// ---- h: unknown sub-routes ------------------------------------------------------------------------------------------
test('h: a page that has no item pages turns an extra path into the not-found panel', () => {
  for (const hash of ['#/pipelines/run/zzz', '#/usage/x', '#/settings/a', '#/security/x', '#/harness/x', '#/component/x', '#/lint/x'])
    assert.equal(R.parseHash(hash).kind, 'unknown', hash);
  assert.equal(R.parseHash('#/skill/x').kind, 'skill');
  assert.equal(R.parseHash('#/guide/odd').kind, 'guide');
});

// ---- j: one page-head pattern ---------------------------------------------------------------------------------------
test('j: the title comes first, then the tabs; Tools and skills has no h2 repeating the tab', async () => {
  for (const hash of ['#/session', '#/tool', '#/memory', '#/lint']) {
    const { env } = await boot(hash, { '/api/memories': { available: true, items: [], facets: { types: [] } },
      '/api/wiki/lint': { scanned: { memories: 0 }, categories: [] } });
    const order = tree(view(env)).filter((e) => e.tagName === 'h1' || (e.tagName === 'nav' && /tabs/.test(cls(e)))).map((e) => e.tagName);
    assert.deepEqual(order, ['h1', 'nav'], hash);
  }
  const { env } = await boot('#/tool');
  assert.ok(!tree(view(env)).some((e) => e.tagName === 'h2' && e.textContent === 'Tools'));
});

// ---- k: labels and formats -----------------------------------------------------------------------------------------
test('k: readable project sources, full words, translated placeholders and the right Display hint', () => {
  for (const k of ['origin.flag', 'origin.config', 'origin.discovered']) assert.ok(ES[k].split(' ').length > 1 && EN[k].split(' ').length > 1, k);
  assert.equal(EN['col.msgs'], 'Messages');
  assert.equal(ES['col.msgs'], 'Mensajes');
  assert.doesNotMatch(EN['theme.intro'], /sidebar/);
  assert.doesNotMatch(ES['theme.intro'], /barra lateral/);
  assert.notEqual(ES['sp.placeholder'], EN['sp.placeholder']);
  assert.doesNotMatch(app, /"\/home\/you\/code\/my-project"/);
});
test('k: percentages use the locale format everywhere (Intl), never a hand-written "%"', () => {
  assert.equal(R.fmtPercent(1, 0), '100%');
  for (const [k, v] of Object.entries(EN)) assert.doesNotMatch(v, /\}%/, k);
  assert.doesNotMatch(app, /\}%\)/);
});
const SKILL_PAGE = { kind: 'skill', id: 'imp', title: 'imp', body_md: null, links: [], backlinks: [], sections: [], missing: [],
  meta: [{ label: 'version', value: '3.9.1' }, { label: 'user-invocable', value: 'true' }, { label: 'argument-hint', value: '[craft|shape|audit]' }] };
test('k: skill front-matter keys in the rail have labels, booleans read yes/no, a long hint can break after each |', async () => {
  const { env } = await boot('#/skill/imp', { '/api/wiki/page': SKILL_PAGE });
  const dl = tree(view(env)).find((e) => e.tagName === 'dl');
  const terms = tree(dl).filter((e) => e.tagName === 'dt').map((e) => e.textContent);
  assert.deepEqual(terms, ['Version', 'User can invoke', 'Arguments']);
  const dds = tree(dl).filter((e) => e.tagName === 'dd');
  assert.equal(dds[1].textContent, 'yes');
  assert.ok(tree(dds[2]).filter((e) => e.tagName === 'wbr').length >= 2);
});
test('k: the guide breadcrumb ends with the page title; a project hub title never reads "amauta - amauta"', async () => {
  const { env } = await boot('#/guide/odd', { '/api/guide': { pages: [{ slug: 'odd', title: 'ODD and review' }] },
    '/api/guide/page': { slug: 'odd', title: 'ODD and review', markdown: '# ODD and review\n\nText.' } });
  const crumbs = tree(view(env)).find((e) => e.tagName === 'nav' && /crumbs/.test(cls(e)));
  assert.match(crumbs.textContent, /ODD and review$/);
  const pg = { kind: 'project', id: 'amauta', title: 'amauta', body_md: null, meta: [], links: [], backlinks: [], sections: [], missing: [] };
  const hub = await boot('#/project/amauta', { '/api/wiki/page': pg, '/api/odd': { docs: [] } });
  assert.equal(hub.env.document.title, 'Project amauta - amauta');
});

// ---- l: saved project paths with aligned actions ----------------------------------------------------------------------
test('l: saved project paths are a two-column table (path, action)', async () => {
  const { env } = await boot('#/settings?tab=projects', { '/api/settings': { installed: false }, '/api/themes': { themes: [] }, '/api/siblings': { siblings: [] },
    '/api/projects': { auto_discover: false, config_repos: ['/a', '/a/much/longer/path'], siblings: [], projects: [] } });
  const tables = tree(view(env)).filter((e) => e.tagName === 'table');
  const paths = tables.find((tb) => /\/a\/much\/longer\/path/.test(tb.textContent));
  assert.ok(paths, 'the paths are in a table');
  const row = tree(paths).filter((e) => e.tagName === 'tr')[1];
  assert.equal(row.children.length, 2);
  assert.ok(tree(row.children[1]).some((e) => e.tagName === 'button'));
});

// ---- m: home status sentence -----------------------------------------------------------------------------------------
test('m: Home opens with one status sentence linked to the harness overview', async () => {
  const hs = { installed: true, version: '0.3.0', rdd_mode: 'on', telemetry: false, managed_files: 1, persona: 'x', components: [], hooks: [], mcp_servers: [] };
  const comps = { total: 1, groups: [{ kind: 'plugin', label: 'Plugins', items: [{ kind: 'plugin', id: 'p', title: 'p', source: 's', disabled: true }] }] };
  const { env } = await boot('#/', { '/api/wiki/home': { activity: [], spending: { available: false }, impact: null, health: { installed: true, version: '0.3.0' } },
    '/api/pipelines': { projects: [] }, '/api/harness': hs, '/api/harness/components': comps, '/api/skills': { groups: [] } });
  const h1 = tree(view(env)).find((e) => e.tagName === 'h1');
  const head = tree(view(env)).find((e) => cls(e) === 'page-head'); // T8 final polish: the status sentence leads the page head
  const status = head.children[head.children.indexOf(h1) + 1];
  assert.match(status.textContent, /amauta 0\.3\.0 is installed; 1 component, 1 needs attention/);
  assert.ok(tree(status).some((e) => e.tagName === 'a' && e.getAttribute('href') === '#/harness'));
});

// ---- n: the search palette ------------------------------------------------------------------------------------------
test('n: the palette returns focus to its trigger, rows do not repeat the group label, and pages are a result group', async () => {
  const found = { groups: [{ kind: 'memory', count: 1, items: [{ kind: 'memory', id: '1', title: 'Settings note' }] }] };
  const { env, ctx } = await boot('#/session', { '/api/wiki/search': found });
  byId(env, 'search-open').click();
  const input = byId(env, 'palette-input');
  input.value = 'sett';
  for (const fn of input.listeners.input) fn({});
  await tick(200);
  const results = byId(env, 'palette-results');
  const groups = tree(results).filter((e) => e.attrs.role === 'group').map((e) => e.attrs['aria-label']);
  assert.equal(groups[0], 'Pages');
  assert.ok(tree(results).some((e) => e.attrs.role === 'option' && /Settings/.test(e.textContent)));
  assert.ok(!tree(results).some((e) => /pal-kind/.test(cls(e))), 'no group label repeated on each row');
  vm.runInContext('goResult(0)', ctx);
  assert.equal(env.location.hash, '#/settings');
  byId(env, 'search-open').focused = false;
  byId(env, 'search-open').click();
  for (const fn of input.listeners.keydown) fn({ key: 'Escape', preventDefault() {} });
  assert.equal(byId(env, 'search-open').focused, true);
});

// ---- p: secondary error paths ---------------------------------------------------------------------------------------
test('p: no secondary path shows a raw err.message as the whole message', () => {
  const raw = [...app.matchAll(/String\(err\.message \|\| err\)|\berr\.message\b|\be\.message\b/g)].map((m) => app.slice(m.index - 60, m.index + 30))
    .filter((s) => !s.includes('const plainReason')); // the one helper that reads it, for the detail line
  assert.deepEqual(raw, []);
  assert.ok('error.network' in EN && 'error.network' in ES);
});

// ---- P3 ------------------------------------------------------------------------------------------------------------
test('P3: memory files show human sizes; the memory list opens newest first', async () => {
  const { env } = await boot('#/memfile', { '/api/memory-files': { items: [{ id: 'a/memory/n.md', name: 'n.md', project: 'a', size: 2048, mtime: '2026-11-01T10:00:00Z' }] } });
  assert.match(view(env).textContent, /2\.0 KB/);
  const items = [{ id: 1, title: 'old', type: 'note', updated_at: '2026-01-01T00:00:00Z', revision: 9 }, { id: 2, title: 'new', type: 'note', updated_at: '2026-11-01T00:00:00Z', revision: 1 }];
  const m = await boot('#/memory', { '/api/memories': { available: true, items, facets: { types: [] } } });
  const titles = tree(view(m.env)).filter((e) => e.tagName === 'td').map((e) => e.textContent).filter((x) => x === 'old' || x === 'new');
  assert.deepEqual(titles, ['new', 'old']);
});
