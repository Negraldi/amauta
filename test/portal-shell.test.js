// Shell and identity (portal redesign T2): the "Andean ledger" tokens, type roles, the top bar with its Display popover,
// the grouped sidebar without the recent list, the breadcrumb and tab styling, target sizes and the state vocabulary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const css = (await read('style.css')).replace(/\/\*[\s\S]*?\*\//g, ''); // comments out, so selectors parse cleanly
const html = await read('index.html');
const tctx = {};
vm.runInNewContext(await read('theme.js'), tctx);
const T = tctx.AmautaTheme;
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
// Every declaration block whose selector list names `selector` exactly (top level or inside a media query).
const rulesOf = (selector) => [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector)).map((m) => m[2]);
const HIT = (/--hit: ([\d.]+rem)/.exec(css) || [])[1];
const rule = (selector) => rulesOf(selector).join(' ').replaceAll('var(--hit)', HIT); // the 24px target token, resolved
const px = (v) => (/rem$/.test(v) ? parseFloat(v) * 16 : parseFloat(v));

// ---- identity tokens ---------------------------------------------------------------------------------------------
const ok = (s) => `oklch(${s})`;
const LIGHT = { bg: '1 0 0', surface: '0.975 0 0', sidebar: '0.965 0.003 22', ink: '0.22 0.005 22', 'ink-muted': '0.47 0.008 22', line: '0.9 0.004 22',
  accent: '0.50 0.155 22', 'accent-soft': '0.95 0.025 22', warn: '0.55 0.13 70', ok: '0.50 0.11 150',
  'c-input': '0.45 0.13 275', 'c-output': '0.62 0.13 60', 'c-cache-read': '0.70 0.02 250', 'c-cache-write': '0.58 0.10 310' };
const DARK = { bg: '0.13 0 0', surface: '0.17 0 0', sidebar: '0.11 0 0', ink: '0.93 0.004 22', 'ink-muted': '0.74 0.008 22', line: '0.28 0.004 22',
  accent: '0.74 0.12 22', 'accent-soft': '0.27 0.05 22', warn: '0.80 0.13 75', ok: '0.78 0.12 150',
  'c-input': '0.74 0.10 275', 'c-output': '0.80 0.12 60', 'c-cache-read': '0.55 0.02 250', 'c-cache-write': '0.72 0.09 310' };

test('the built-in themes carry the approved identity: pure neutral surfaces, cochineal accent, indigo and ochre data', () => {
  const want = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ok(v)]));
  assert.deepEqual(plain(T.BASES.light), want(LIGHT));
  assert.deepEqual(plain(T.BASES.dark), want(DARK));
  assert.equal(plain(T.TOKENS).length, 14, 'custom themes depend on the 14-token list');
});

// ---- typography --------------------------------------------------------------------------------------------------
test('titles and numbers use the system mono at 600, UI the system sans, and the serif is kept for long prose', () => {
  assert.match(css, /--mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;/);
  assert.match(rule('body'), /var\(--sans\)/);
  const h1 = rule('h1');
  assert.match(h1, /font: 600 [\d.]+rem\/[\d.]+ var\(--mono\)/);
  assert.match(h1, /text-wrap: balance/);
  const ls = /letter-spacing: (-?[\d.]+)em/.exec(h1);
  assert.ok(ls && Number(ls[1]) >= -0.02, 'letter-spacing >= -0.02em');
  assert.match(rule('.card .v'), /var\(--mono\)/);
  assert.match(rule('td.n'), /var\(--mono\)/);
  assert.match(rule('.prose'), /var\(--serif\)/);
  for (const m of css.matchAll(/([^{};]+)\{[^{}]*var\(--serif\)[^{}]*\}/g)) {
    for (const sel of m[1].split(',').map((s) => s.trim())) assert.match(sel, /^\.prose\b/, `the serif is used outside long prose: ${sel}`);
  }
});

// ---- index.html: the top bar, the Display popover, the sidebar -----------------------------------------------------
const topbar = /<header class="topbar">([\s\S]*?)<\/header>/.exec(html)[1];
const sidebar = /<nav class="sidebar"[\s\S]*?<\/nav>/.exec(html)[0];
const filters = /<div class="page-bar" id="filters"[\s\S]*?<\/div>/.exec(html)[0];

test('the top bar holds the menu toggle, search, Refresh and a Display button that opens a native popover', () => {
  assert.match(topbar, /<button id="refresh" type="button">/);
  assert.match(topbar, /<button id="display-open" type="button" popovertarget="prefs"[^>]*>/);
  const pop = /<div class="prefs" id="prefs" popover role="group"[^>]*>([\s\S]*?)<\/div>/.exec(topbar);
  assert.ok(pop, 'the Display popover is a [popover] group');
  for (const id of ['theme-picker', 'theme-edit', 'lang-picker']) assert.match(pop[1], new RegExp(`id="${id}"`), id);
  assert.match(topbar, /id="status" role="status"/);
  assert.doesNotMatch(filters, /id="(refresh|status)"/, 'Refresh is not a filter');
});

test('the sidebar carries only the brand and the grouped navigation: no recent list, no pickers', () => {
  for (const id of ['recent', 'prefs', 'theme-picker', 'lang-picker']) assert.doesNotMatch(sidebar, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(html, /id="recent/);
});

test('the shell no longer asks for the recent list; Refresh reloads usage, projects and the route', async () => {
  const env = makeEnv({ '/api/wiki/home': { activity: [], spending: { available: false }, impact: null, health: { installed: false } },
    '/api/sessions': { projects: [{ project: 'alpha' }] }, '/api/themes': { themes: [], tokens: [], max: 50 }, '/api/refresh': { messages: 2, files: 1 } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  assert.ok(!env.calls.some((c) => String(c.url).includes('/api/wiki/recent')), 'no request for the sidebar recent list');
  env.calls.length = 0;
  env.document.getElementById('refresh').click();
  await tick();
  const urls = env.calls.map((c) => String(c.url).split('?')[0]);
  assert.equal(urls[0], '/api/refresh');
  assert.ok(urls.includes('/api/sessions') && urls.includes('/api/wiki/home'), urls.join(' '));
});

// ---- sidebar, breadcrumb and tabs styling -------------------------------------------------------------------------
test('group titles are quiet sentence-case labels; the current item has a tint, the accent and a weight cue', () => {
  const title = rule('.nav-title');
  assert.ok(title, '.nav-title is styled');
  assert.doesNotMatch(title, /text-transform|letter-spacing: 0\.[0-9]*[1-9]/, 'no uppercase tracked eyebrow');
  assert.match(title, /color: var\(--ink-muted\)/);
  const cur = rule('#nav a[aria-current="page"]');
  assert.match(cur, /background: var\(--accent-soft\)/);
  assert.match(cur, /color: var\(--accent\)/);
  assert.match(cur, /font-weight: 600/);
  const foot = rule('.nav-foot');
  assert.match(foot, /margin-top: auto/);
  assert.match(foot, /border-top: 1px solid var\(--line\)/);
  assert.match(rule('.sidebar'), /display: flex/);
});

test('the breadcrumb is a wrapping row with CSS separators; the tabs underline the current one', () => {
  assert.match(rule('.crumbs ol'), /display: flex/);
  assert.match(rule('.crumbs ol'), /flex-wrap: wrap/);
  assert.match(rule('.crumbs li + li::before'), /content: "\/"/);
  assert.match(rule('.crumbs a'), /color: var\(--ink-muted\)/);
  assert.match(rule('.crumbs [aria-current="page"]'), /color: var\(--ink\)/);
  const tab = rule('.tabs a[aria-current="page"]');
  assert.match(tab, /border-bottom-color: var\(--accent\)/);
  assert.doesNotMatch(rule('.tabs a') + tab, /border-radius|background:/, 'tabs are not pills');
});

test('buttons, a.button and the error panel share one shape; the toast sits on the z scale', () => {
  for (const sel of ['button', 'a.button']) {
    assert.match(rule(sel), /border: 1px solid var\(--line\)/, sel);
    assert.match(rule(sel), /border-radius: 6px/, sel);
  }
  assert.match(rule('.error-panel'), /border: 1px solid var\(--line\)/);
  assert.match(rule('.error-panel'), /border-radius: 6px/);
  assert.match(rule('.toasts'), /z-index: var\(--z-toast\)/);
  assert.doesNotMatch(css, /z-index: \d/, 'z-index values come from the scale');
});

// ---- target size (WCAG 2.2 2.5.8) and states ----------------------------------------------------------------------
test('nav items, tabs, breadcrumb links, buttons, selects and the palette rows are at least 24px high', () => {
  for (const sel of ['#nav a', '.tabs a', '.crumbs a', 'button', 'a.button', 'select', '.pal-item']) {
    const m = /min-block-size: ([\d.]+(?:rem|px))/.exec(rule(sel));
    assert.ok(m && px(m[1]) >= 24, `${sel} has min-block-size >= 24px`);
  }
  for (const sel of ['td a', '.refs a', '.items a']) { // inline links grow their box with block padding (no line shift)
    const m = /padding-block: ([\d.]+(?:rem|px))/.exec(rule(sel));
    assert.ok(m && px(m[1]) >= 4, `${sel} has padding-block >= 4px`);
  }
  const body = /font: ([\d.]+)rem\/([\d.]+) var\(--sans\)/.exec(rule('body'));
  assert.ok(body && Number(body[1]) * 16 * Number(body[2]) >= 24, 'body line-height gives inline links a 24px line');
});

test('controls show hover, focus-visible, active and disabled states with short ease-out motion that reduced motion removes', () => {
  assert.match(css, /--ease: cubic-bezier\(0\.25, 1, 0\.5, 1\);/, 'ease-out-quart');
  const t = /--t: (\d+)ms/.exec(css);
  assert.ok(t && Number(t[1]) >= 150 && Number(t[1]) <= 200);
  for (const sel of ['button:hover:not(:disabled)', 'button:active:not(:disabled)', 'button:disabled', 'a.button:hover', '#nav a:hover', '.tabs a:hover']) assert.ok(rule(sel), sel);
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the Display popover is positioned under the top bar without JavaScript', () => {
  const pop = rule('#prefs');
  assert.match(pop, /position: fixed/);
  assert.match(pop, /margin: 0/);
});
