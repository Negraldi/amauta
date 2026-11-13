// Visual pass (portal redesign T8): one vocabulary for counts and enums, data colors that read on their chart, diagrams that follow
// the theme, prose measure, and the carry-overs of T3-T7 (harness total, sibling age limit, filter-state wrapping, dead CSS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv, Element } from './helpers/fakedom.js';
import { runPortal, STATIC, readApp, readDicts } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const view = (env) => env.document.getElementById('view');
const cls = (e) => e.getAttribute('class') || e.className || '';
const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const css = (await read('style.css')) + (await read('style-pages.css'));
const app = await readApp();
const { en: EN, es: ES } = await readDicts();
const tctx = {};
vm.runInNewContext(await read('theme.js'), tctx);
const T = tctx.AmautaTheme;

const BASE = { '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false }, '/api/overview': { available: false },
  '/api/costs': { enabled: false, models: [] }, '/api/tools': { available: true, tools: [], skills: [], subagents: [], mcp_servers: [], mcp_tools: [] } };
async function boot(hash, routes = {}, extra = {}) {
  const env = makeEnv({ ...BASE, ...routes });
  env.location.hash = hash;
  const ctx = await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  return { env, ctx };
}

// ---- C5: counts through tn(), enums through labels, neutral Spanish -------------------------------------------------
test('counts that can be one are written through tn() with singular and plural forms', () => {
  const keys = ['skills.calls', 'skills.sessions', 'graph.nodeCount', 'graph.edgeCount', 'graph.sqlTables', 'pipe.sched.minutes',
    'pipe.sched.hours', 'harness.drawn', 'lint.intro', 'set.validFor', 'set.undoValid', 'catalog.intro'];
  for (const k of keys) {
    for (const [name, d] of [['en', EN], ['es', ES]]) assert.ok(`${k}.one` in d && `${k}.other` in d, `${name} ${k} has one/other forms`);
    assert.ok(app.includes(`tn("${k}"`), `${k} is used through tn()`);
  }
});

test('the catalog says "1 call in 1 session", never "1 calls in 1 sessions"', async () => {
  const skills = { total: 1, groups: [{ source: 'installed', label: 'Installed by amauta', items: [{ id: 'a-skill', uses: 1, sessions: 1, last_used: '2026-10-17T10:00:00Z' }] }] };
  const { env } = await boot('#/component', { '/api/harness/components': { total: 0, groups: [] }, '/api/skills': skills });
  assert.match(view(env).textContent, /1 call in 1 session, last used 2026-10-17/);
});

test('Spanish status words are neutral (no activado/desactivado) and Harness/Lint have Spanish labels', () => {
  for (const k of ['common.on', 'common.off', 'set.on', 'set.off', 'components.disabled']) assert.doesNotMatch(ES[k], /activad[oa]/i, k);
  for (const k of ['set.review.help', 'set.telemetry.help', 'set.privacy.help', 'set.checks.help']) assert.doesNotMatch(ES[k], /\b(Des)?[Aa]ctivado:/, k);
  for (const k of ['kind.harness', 'nav.harnessPage', 'kind.lint']) assert.doesNotMatch(ES[k], /^(Harness|Lint)$/, k);
  assert.notEqual(EN['kind.lint'], 'Lint');
});

test('memory types and redaction kinds are shown with labels; an unknown value is shown as sent', async () => {
  const items = [{ id: 1, title: 'A', type: 'session_summary', project: 'p', topic_key: null, revision: 1, updated_at: '2026-11-12T03:18:00Z' },
    { id: 2, title: 'B', type: 'my_own_kind', project: 'p', topic_key: null, revision: 1, updated_at: '2026-11-12T03:18:00Z' }];
  const mem = { source: 'own', available: true, items, facets: { projects: ['p'], types: ['session_summary', 'my_own_kind'] } };
  const { env } = await boot('#/memory', { '/api/memories': mem });
  const cells = tree(view(env)).filter((e) => e.tagName === 'td').map((e) => e.textContent);
  assert.ok(cells.includes('Session summary') && cells.includes('my_own_kind'), cells.join('|'));
  const options = tree(view(env)).filter((e) => e.tagName === 'option');
  const opt = options.find((o) => o.getAttribute('value') === 'session_summary');
  assert.equal(opt.textContent, 'Session summary');
  const sec = { protections: { memory_guard: 'on', privacy: 'on', checks: 'on', installed: true }, checkers: [], trusted: [],
    profiles: { names: [], drafts: 0, selected: [] }, redacted: { email: 3, cedula: 1 } };
  const s = await boot('#/security', { '/api/security': sec });
  const td = tree(view(s.env)).filter((e) => e.tagName === 'td').map((e) => e.textContent);
  assert.ok(td.includes('Email address') && td.includes('National ID (cédula)'), td.join('|'));
});

test('a recent-changes line formats the count the server wrote in it', async () => {
  const home = { activity: [{ day: '2026-11-09', items: [{ kind: 'session', id: 's1', title: 'x', what: 'session, 11300 messages', ts: '2026-11-09T21:10:00Z' }] }],
    spending: { available: false }, impact: null, health: { installed: false } };
  const { env } = await boot('#/', { '/api/wiki/home': home, '/api/pipelines': { projects: [] } });
  assert.match(view(env).textContent, /session, 11,300 messages, 21:10/);
});

// ---- carry-overs ----------------------------------------------------------------------------------------------------
test('the harness health sentence counts the same things as the Catalog (skills included), and still works without skills', async () => {
  const hs = { installed: true, version: '0.3.0', rdd_mode: 'on', telemetry: false, managed_files: 3, persona: 'neutral', components: [], hooks: [], mcp_servers: [] };
  const comps = { total: 2, groups: [{ kind: 'hook', label: 'Hooks', items: [{ kind: 'hook', id: 'Stop:a', title: 'Stop · x', source: 's' },
    { kind: 'hook', id: 'Stop:b', title: 'Stop · y', source: 's' }] }] };
  const skills = { total: 3, groups: [{ source: 'installed', label: 'Installed', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }] };
  const routes = { '/api/harness': hs, '/api/harness/components': comps, '/api/archify': { installed: false } };
  const lead = (env) => tree(view(env)).find((e) => cls(e) === 'lead').textContent;
  assert.match(lead((await boot('#/harness', { ...routes, '/api/skills': skills })).env), /; 5 components, nothing needs attention\.$/);
  assert.match(lead((await boot('#/harness', { ...routes, '/api/skills': { __status: 500, error: 'x' } })).env), /; 2 components, nothing needs attention\.$/);
});

test('the siblings table shows the watched file with its age limit when the config sets one', async () => {
  const sibs = [{ name: 'Cat', path: '/home/u/cat', watch: 'cuts/ACTIVE', max_age_days: 35 }, { name: 'B', path: '/home/u/b', watch: 'x.txt' }];
  const { env } = await boot('#/settings?tab=projects', { '/api/settings': { installed: false }, '/api/themes': { themes: [] }, '/api/siblings': { siblings: [] },
    '/api/projects': { auto_discover: false, config_repos: [], siblings: sibs, projects: [] } });
  const cells = tree(view(env)).filter((e) => e.tagName === 'td').map((e) => e.textContent);
  assert.ok(cells.includes('cuts/ACTIVE (at most 35 days old)'), cells.join('|'));
  assert.ok(cells.includes('x.txt'));
});

test('Activity filter state is one nowrap span per part, so it wraps between parts and never inside one', async () => {
  const { env } = await boot('#/session');
  const p = tree(view(env)).find((e) => cls(e) === 'filter-state');
  const parts = p.children.filter((c) => c.tagName === 'span');
  assert.equal(parts.length, 3);
  assert.match(css, /\.filter-state span \{[^}]*white-space: nowrap/);
  assert.match(css, /\.page-head \{[^}]*row-gap: /);
});

// ---- color: accent is links, selection, focus only; data colors read on their chart ---------------------------------
test('progress bars and a running pipeline step do not use the accent', () => {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/progress|data-status="running"/.test(m[1])) assert.doesNotMatch(m[2], /var\(--accent\)/, m[1].trim());
  }
});

const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([a-z-]+):\s*oklch\(([^)]+)\)/g)].map((m) => [m[1], m[2].trim().split(/\s+/).map(Number)]));
const SCHEMES = { light: block(/:root \{([\s\S]*?)\n\}/), dark: block(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/) };
const DATA = ['c-input', 'c-output', 'c-cache-read', 'c-cache-write'];
const lab = ([L, C, H]) => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
for (const scheme of ['light', 'dark']) {
  test(`data colors reach 3:1 on the chart background and stay apart from each other (${scheme})`, () => {
    const t = SCHEMES[scheme];
    for (const k of DATA) for (const bg of ['bg', 'surface']) {
      const r = T.contrast(`oklch(${t[k].join(' ')})`, `oklch(${t[bg].join(' ')})`);
      assert.ok(r >= 3, `${scheme} --${k} on --${bg} is ${r.toFixed(2)}:1`);
    }
    for (let i = 0; i < DATA.length; i++) for (let j = i + 1; j < DATA.length; j++) {
      const [a, b] = [lab(t[DATA[i]]), lab(t[DATA[j]])];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(d >= 0.1, `${scheme} --${DATA[i]} and --${DATA[j]} are only ${d.toFixed(3)} apart (OKLab)`);
    }
  });
}

// ---- prose and dead CSS ---------------------------------------------------------------------------------------------
test('the guide page body is long prose: the serif .prose style at a 65-75ch measure', async () => {
  const { env } = await boot('#/guide', { '/api/guide': { pages: [{ slug: 'overview', title: 'Overview' }] },
    '/api/guide/page': { slug: 'overview', title: 'Overview', markdown: '# Overview\n\nText.' } });
  const article = tree(view(env)).find((e) => e.tagName === 'article');
  assert.match(cls(article), /\bprose\b/);
  const m = /\n\.prose \{[^}]*max-inline-size: (\d+)ch/.exec(css) || /\n\.prose \{[^}]*max-inline-size: var\(--measure\)/.exec(css);
  assert.ok(m, '.prose has a measure');
  const ch = m[1] ? Number(m[1]) : Number(/--measure: (\d+)ch/.exec(css)[1]);
  assert.ok(ch >= 65 && ch <= 75, `${ch}ch`);
});

test('no rule styles the archify iframe that the portal no longer builds', () => {
  assert.doesNotMatch(css, /archify-frame/);
  assert.doesNotMatch(app, /archify-frame/);
});

// ---- diagrams follow the theme --------------------------------------------------------------------------------------
function mermaidEnv() {
  const log = { init: [], render: [] };
  const mermaid = { initialize: (cfg) => log.init.push(cfg), render: async (id, src) => { log.render.push(src); return { svg: '<svg></svg>' }; } };
  return { log, mermaid };
}
async function bootDiagram(scheme, fallback = 'flowchart LR\n  n0["A"]') {
  const { log, mermaid } = mermaidEnv();
  const tokens = { ...T.BASES[scheme] };
  const getComputedStyle = () => ({ getPropertyValue: (p) => tokens[String(p).replace(/^--/, '')] || '' });
  const env = makeEnv({ ...BASE, '/api/harness': { installed: true, version: '1', rdd_mode: 'on', telemetry: false, managed_files: 0, persona: 'x', components: [], hooks: [], mcp_servers: [] },
    '/api/harness/components': { total: 0, groups: [] }, '/api/skills': { total: 0, groups: [] },
    '/api/archify': { installed: true, available: false, fallback }, '/api/themes': { themes: [] } });
  env.location.hash = '#/harness';
  env.window.mermaid = mermaid;
  const head = new Element('head');
  head.append = (script) => queueMicrotask(() => script.onload());
  env.document.head = head;
  env.document.importNode = (n) => n;
  class DOMParser { parseFromString() { return { body: { querySelector: () => new Element('svg') } }; } }
  const ctx = await runPortal(env, { DOMParser, queueMicrotask, getComputedStyle });
  await tick();
  return { env, ctx, log, tokens };
}

test('Mermaid draws with the current theme tokens: a dark page gets a dark diagram', async () => {
  const light = await bootDiagram('light');
  assert.equal(light.log.init[0].themeVariables.background, T.toHex(T.BASES.light.bg));
  assert.equal(light.log.init[0].themeVariables.primaryTextColor, T.toHex(T.BASES.light.ink));
  const dark = await bootDiagram('dark');
  const v = dark.log.init.at(-1).themeVariables;
  assert.equal(v.background, T.toHex(T.BASES.dark.bg));
  assert.equal(v.primaryTextColor, T.toHex(T.BASES.dark.ink));
  assert.equal(v.darkMode, true);
});

test('changing the theme redraws the diagrams on the page with the new tokens', async () => {
  const b = await bootDiagram('light');
  assert.equal(b.log.render.length, 1);
  Object.assign(b.tokens, T.BASES.dark); // what the stylesheet resolves to once data-theme="dark" is set
  vm.runInContext('chooseTheme("dark")', b.ctx);
  await tick();
  assert.equal(b.log.render.length, 2, 'drawn again');
  assert.equal(b.log.init.at(-1).themeVariables.background, T.toHex(T.BASES.dark.bg));
});

test('the server\'s light classDef colors are redrawn from the theme tokens (a dark page gets dark nodes with light text)', async () => {
  const src = 'flowchart LR\n  a["A"]\n  classDef done fill:#cdeedd,stroke:#2f9e6f,color:#1d1f23\n  classDef blocked fill:#fbd5d5,stroke:#b42318,stroke-width:3px,color:#1d1f23\n  class a done';
  const b = await bootDiagram('dark', src);
  const drawn = b.log.render.at(-1);
  const hex = (k) => T.toHex(T.BASES.dark[k]);
  assert.match(drawn, new RegExp(`classDef done fill:${hex('surface')},stroke:${hex('ok')},color:${hex('ink')}`));
  assert.match(drawn, new RegExp(`classDef blocked fill:${hex('surface')},stroke:${hex('warn')},stroke-width:3px,color:${hex('ink')}`));
  assert.match(drawn, /class a done/);
});

test('the diagram card uses the page tokens instead of pinning a white sheet', () => {
  const rule = css.match(/\n\.diagram \{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /oklch\(/, 'no literal colors on the card');
  assert.match(rule, /background: var\(--bg\)/);
});
