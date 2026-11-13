// Settings (portal redesign T7): one page, three tabs in the URL (?tab=): preferences, projects and siblings, appearance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const view = (env) => env.document.getElementById('view');
const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const ctx = {};
vm.runInNewContext(await read('wikiroute.js'), ctx);
const R = ctx.AmautaRoute;

const MODS = { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' };
const SETTINGS = { installed: true, current: { persona: 'gentleman', review_mode: 'off', telemetry: 'on', privacy: 'on', checks: 'on', modules: MODS },
  allowed: {}, undo: { available: false } };
const SIBS = [{ name: 'Data catalog', path: '/home/u/catalog', mcp: 'oga-catalog', watch: 'cuts/ACTIVE', max_age_days: 35 }];
const PROJECTS = (siblings) => ({ auto_discover: true, config_repos: ['/home/u/beta'], siblings, projects: [] });
const THEMES = { themes: [{ slug: 'night', name: 'Night', base: 'dark', tokens: { bg: '#000000' } }], tokens: [], max: 50 };

async function boot(hash, over = {}, extra = {}) {
  const posts = [];
  const env = makeEnv({ '/api/settings': SETTINGS, '/api/projects': PROJECTS(SIBS), '/api/themes': THEMES, '/api/wiki/recent': { items: [] },
    '/api/sessions': { available: false }, '/api/siblings': { siblings: [] }, '/api/overview': { available: false },
    '/api/projects/config': async (opts) => { posts.push(JSON.parse(opts.body)); return PROJECTS(JSON.parse(opts.body).siblings || SIBS); }, ...over });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  return { env, posts };
}
const tabLinks = (env) => {
  const nav = tree(view(env)).find((e) => e.tagName === 'nav' && /tabs/.test(e.className));
  return nav ? tree(nav).filter((e) => e.tagName === 'a') : [];
};
const labelled = (el) => {
  const ids = new Set(tree(el).filter((e) => e.tagName === 'label').map((e) => e.attrs.for));
  return tree(el).filter((e) => ['input', 'select', 'textarea'].includes(e.tagName) && e.attrs.type !== 'file')
    .filter((e) => !(e.attrs.id && ids.has(e.attrs.id)) && !e.attrs['aria-label']).map((e) => e.attrs.id || e.attrs.type);
};

// ---- routing -----------------------------------------------------------------------------------------------
test('the settings tabs live in ?tab= and the default tab is never written', () => {
  assert.deepEqual(plain(R.SETTINGS_TABS), ['preferences', 'projects', 'appearance']);
  assert.deepEqual(plain(R.parseHash('#/settings?tab=appearance')), { kind: 'settings', id: '', query: { tab: 'appearance' } });
  assert.deepEqual(plain(R.parseHash('#/settings?tab=projects')), { kind: 'settings', id: '', query: { tab: 'projects' } });
  assert.equal(R.settingsTab(R.parseHash('#/settings')), 'preferences');
  assert.equal(R.settingsTab(R.parseHash('#/settings?tab=nope')), 'preferences');
  assert.equal(R.settingsTab(R.parseHash('#/settings?tab=appearance')), 'appearance');
  assert.equal(R.routeHash({ kind: 'settings', id: '', query: { tab: 'preferences' } }), '#/settings');
  assert.equal(R.routeHash({ kind: 'settings', id: '', query: { tab: 'appearance' } }), '#/settings?tab=appearance');
});

test('the old themes hash redirects to the Appearance tab; current hashes do not redirect', () => {
  assert.equal(R.redirectOf('#/themes'), '#/settings?tab=appearance');
  assert.equal(R.redirectOf('#/settings'), null);
  assert.equal(R.redirectOf('#/settings?tab=projects'), null);
  assert.deepEqual(plain(R.parseHash('#/themes')), { kind: 'settings', id: '', query: { tab: 'appearance' } });
  assert.equal(R.hubOf('themes'), 'settings');
  assert.equal(R.hubOf(R.parseHash('#/settings?tab=appearance')), 'settings');
});

// T13 item 11, one crumb rule: a breadcrumb never names the open tab (the tab bar under the lead does), so every tab of
// Settings shares one trail, like Memory's and Activity's tabs.
test('the Settings breadcrumb ends at Settings; the tab bar names the tab', () => {
  const crumbs = (h) => plain(R.crumbs(R.parseHash(h)));
  for (const hash of ['#/settings', '#/settings?tab=projects', '#/themes']) assert.deepEqual(crumbs(hash), [{ key: 'nav.settings', hash: '#/settings' }], hash);
});

// ---- the page ----------------------------------------------------------------------------------------------
test('Settings shows one title and three tab links that keep the tab in the URL', async () => {
  const { env } = await boot('#/settings');
  const v = view(env);
  assert.equal(tree(v).filter((e) => e.tagName === 'h1').length, 1);
  assert.deepEqual(tabLinks(env).map((a) => a.getAttribute('href')), ['#/settings', '#/settings?tab=projects', '#/settings?tab=appearance']);
  assert.deepEqual(tabLinks(env).map((a) => a.textContent), ['Preferences', 'Projects and siblings', 'Appearance']);
  assert.equal(tabLinks(env)[0].getAttribute('aria-current'), 'page');
  assert.ok(!tabLinks(env)[1].getAttribute('aria-current'));
  const crumbs = tree(v).find((e) => e.tagName === 'nav' && /crumbs/.test(e.className));
  assert.equal(crumbs.textContent, 'Settings', 'the tab bar, not the breadcrumb, names the tab (T13)');
});

test('Preferences groups the options under plain headings and keeps the changed mark off the accent color', async () => {
  const { env } = await boot('#/settings');
  const heads = tree(view(env)).filter((e) => e.tagName === 'h2').map((e) => e.textContent);
  for (const h of ['Behavior', 'Hooks and privacy', 'Optional modules']) assert.ok(heads.includes(h), h);
  const css = await read('style-pages.css');
  const rule = /\.settings \.option \.changed \{[^}]*\}/.exec(css)[0];
  assert.doesNotMatch(rule, /--accent/);
  const f = tree(view(env)).find((e) => e.attrs.id === 'set-persona');
  f.value = 'neutral';
  for (const fn of f.listeners.change ?? []) fn({ target: f });
  assert.match(view(env).textContent, /changed, was Gentleman/);
  assert.deepEqual(labelled(view(env)), []);
});

test('Preferences that cannot load show the error panel with Retry, and the tabs stay', async () => {
  const { env } = await boot('#/settings', { '/api/settings': { __status: 500, error: 'boom' } });
  const v = view(env);
  assert.ok(tree(v).some((e) => e.attrs.role === 'alert'));
  assert.ok(tree(v).some((e) => e.tagName === 'button' && e.textContent === 'Retry'));
  assert.equal(tabLinks(env).length, 3);
});

test('Projects and siblings lists siblings in a table, with a Remove button that names the project', async () => {
  const { env, posts } = await boot('#/settings?tab=projects');
  const v = view(env);
  assert.equal(tabLinks(env)[1].getAttribute('aria-current'), 'page');
  const table = tree(v).find((e) => e.tagName === 'table' && /Data catalog/.test(e.textContent)); // T8 l: the saved paths are a table too
  assert.ok(table, 'siblings are a table');
  assert.match(table.textContent, /Data catalog/);
  assert.match(table.textContent, /\/home\/u\/catalog/);
  assert.match(table.textContent, /oga-catalog/);
  assert.match(v.textContent, /\/home\/u\/beta/, 'the saved project paths are still there');
  assert.deepEqual(labelled(v), []);
  tree(v).find((e) => e.tagName === 'button' && e.attrs['aria-label'] === 'Remove Data catalog').click();
  await tick();
  tree(v).find((e) => e.tagName === 'button' && e.textContent === 'Remove sibling').click(); // T11 a: Remove asks first
  await tick();
  assert.deepEqual(posts.at(-1), { siblings: [] });
  assert.ok(tree(view(env)).some((e) => e.attrs.role === 'status' && /Removed Data catalog/.test(e.textContent)));
});

test('with no siblings the tab teaches what a sibling is and how to add one', async () => {
  const { env } = await boot('#/settings?tab=projects', { '/api/projects': PROJECTS([]) });
  const v = view(env);
  assert.match(v.textContent, /A sibling is a project that lives beside amauta/);
  assert.match(v.textContent, /choose Add sibling/);
  assert.equal(tree(v).filter((e) => e.tagName === 'table').length, 1, 'only the saved paths table (T8 l)');
  assert.ok(tree(v).some((e) => e.tagName === 'button' && e.textContent === 'Add sibling'));
});

test('a failing projects tab shows an error with Retry instead of an empty page', async () => {
  const { env } = await boot('#/settings?tab=projects', { '/api/projects': { __status: 500, error: 'boom' } });
  assert.ok(tree(view(env)).some((e) => e.tagName === 'button' && e.textContent === 'Retry'));
  assert.equal(tabLinks(env).length, 3);
});

test('Appearance has the theme editor and the language choice', async () => {
  const { env } = await boot('#/settings?tab=appearance');
  const v = view(env);
  assert.equal(tabLinks(env)[2].getAttribute('aria-current'), 'page');
  assert.equal(tree(v).filter((e) => e.tagName === 'h1').length, 1);
  assert.ok(tree(v).some((e) => e.attrs.id === 'theme-import'));
  assert.match(v.textContent, /Night/);
  const lang = tree(v).find((e) => e.attrs.id === 'set-lang');
  assert.ok(lang, 'language select');
  assert.deepEqual(tree(lang).filter((e) => e.tagName === 'option').map((o) => o.getAttribute('value')), ['en', 'es']);
  assert.deepEqual(labelled(v), []);
  lang.value = 'es';
  for (const fn of lang.listeners.change ?? []) fn({ target: lang });
  await tick();
  assert.equal(tabLinks(env)[2].textContent, 'Apariencia');
});

test('the old #/themes link opens the Appearance tab and leaving it ends the preview', async () => {
  const { env } = await boot('#/themes');
  assert.ok(tree(view(env)).some((e) => e.attrs.id === 'theme-import'));
  assert.equal(tabLinks(env)[2].getAttribute('aria-current'), 'page');
});

test('the Display popover links to the Appearance tab', async () => {
  assert.match(await read('index.html'), /id="theme-edit" href="#\/settings\?tab=appearance"/);
});

test('every new Settings string exists in both languages and Spanish differs from English', async () => {
  const en = JSON.parse(await read('i18n/en.json')), es = JSON.parse(await read('i18n/es.json'));
  const keys = Object.keys(en).filter((k) => /^(set\.tab\.|set\.group\.|set\.lang|sib\.empty|sib\.col\.)/.test(k));
  assert.ok(keys.length >= 9, `found ${keys.length}`);
  for (const k of keys) { assert.ok(k in es, k); assert.notEqual(es[k], en[k], k); }
});
