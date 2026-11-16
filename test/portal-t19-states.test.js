// T19: errors in the portal's words (no browser reason in the sentence, a Retry on a failed part, a failed page that still names
// itself), Today's requests issued together, and checkbox targets of at least 24 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { boot, tick, tree, view, text, page, ES } from './helpers/t15w3.js';
import { STATIC, readDicts } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const { en: EN, es: ES_DICT } = await readDicts();
const DOWN = () => { throw new TypeError('Failed to fetch'); };
const HTTP500 = { __status: 500, error: 'boom' };
const HOME = { activity: [], spending: { available: false }, impact: null, health: { installed: true } };
const HS = { installed: true, version: '1.0.0', hooks: [], components: [], managed_files: 1, telemetry: true, persona: 'neutral', rdd_mode: 'on' };
const COMPS = { total: 1, pending: 0, groups: [{ kind: 'hook', label: 'Hooks', items: [{ id: 'a', title: 'a', source: 'x', description: '' }] }] };
const alerts = (env) => tree(view(env)).filter((e) => e.getAttribute && e.getAttribute('role') === 'alert');
const buttons = (el, word) => tree(el).filter((e) => e.tagName === 'button' && word.test(e.textContent));
const count = (env, re) => env.calls.filter((c) => re.test(c.url)).length;

// ---- T19a.1: a rejected fetch has no browser text in the sentence ----
test('T19a: error.network takes no {reason} in either language', () => {
  assert.doesNotMatch(EN['error.network'], /\{reason\}/);
  assert.doesNotMatch(ES_DICT['error.network'], /\{reason\}/);
});
for (const [extra, want] of [[{}, /The portal server could not be reached\./], [ES, /No se pudo contactar con el servidor del portal\./]]) {
  test(`T19a: a rejected fetch reads without the browser's own reason (${want.source.slice(0, 12)})`, async () => {
    const env = await boot('#/harness', { '/api/harness': DOWN }, extra);
    assert.doesNotMatch(text(env), /Failed to fetch/);
    assert.match(text(env), want);
  });
}

// ---- T19a.2: a failed part offers Retry that re-runs that part only ----
test('T19a: Today pipelines rail offers Retry that fetches only the pipelines again', async () => {
  let fail = true;
  const env = await boot('#/', { '/api/wiki/home': HOME, '/api/harness': HS, '/api/pipelines': () => (fail ? HTTP500 : { available: false, projects: [] }) });
  const note = alerts(env).find((a) => /pipelines/i.test(a.textContent));
  assert.ok(note, 'the pipelines note is shown');
  const retry = buttons(note, /^Retry$/);
  assert.equal(retry.length, 1, 'one Retry button inside the note');
  const home = count(env, /wiki\/home/), pipes = count(env, /api\/pipelines/);
  fail = false;
  retry[0].click();
  await tick();
  assert.equal(count(env, /api\/pipelines/), pipes + 1);
  assert.equal(count(env, /wiki\/home/), home, 'the rest of the page is not fetched again');
  assert.ok(!alerts(env).some((a) => /pipelines/i.test(a.textContent)), 'the note is gone');
});
test('T19a: Retry that fails again shows the note again, in Spanish too', async () => {
  const env = await boot('#/', { '/api/wiki/home': HOME, '/api/harness': HS, '/api/pipelines': HTTP500 }, ES);
  const note = alerts(env).find((a) => /pipelines/i.test(a.textContent));
  const retry = buttons(note, /^Reintentar$/);
  assert.equal(retry.length, 1);
  retry[0].click();
  await tick();
  assert.ok(alerts(env).some((a) => /pipelines/i.test(a.textContent) && buttons(a, /^Reintentar$/).length === 1));
});
test('T19a: the Today lede (harness status) offers Retry', async () => {
  let fail = true;
  const env = await boot('#/', { '/api/wiki/home': HOME, '/api/pipelines': { available: false, projects: [] }, '/api/harness': () => (fail ? HTTP500 : HS) });
  const note = alerts(env).find((a) => /harness/i.test(a.textContent));
  assert.equal(buttons(note, /^Retry$/).length, 1);
  fail = false;
  buttons(note, /^Retry$/)[0].click();
  await tick();
  assert.match(text(env), /amauta 1\.0\.0 is installed/);
});
test('T19a: Harness architecture failure offers Retry for that part', async () => {
  let fail = true;
  const env = await boot('#/harness', { '/api/harness': HS, '/api/harness/components': COMPS, '/api/skills': { groups: [] },
    '/api/archify': () => (fail ? HTTP500 : { installed: false }) });
  const note = alerts(env).find((a) => /architecture/i.test(a.textContent));
  assert.equal(buttons(note, /^Retry$/).length, 1);
  const harness = count(env, /api\/harness$/);
  fail = false;
  buttons(note, /^Retry$/)[0].click();
  await tick();
  assert.equal(count(env, /api\/harness$/), harness);
  assert.ok(!alerts(env).some((a) => /architecture/i.test(a.textContent)));
});
test('T19a: Harness skills note and Catalog skills note offer Retry', async () => {
  for (const hash of ['#/harness', '#/component']) {
    const env = await boot(hash, { '/api/harness': HS, '/api/harness/components': COMPS, '/api/skills': HTTP500, '/api/archify': { installed: false } });
    const note = alerts(env).find((a) => /skills/i.test(a.textContent));
    assert.ok(note && buttons(note, /^Retry$/).length === 1, hash);
  }
});
test('T19a: a failed theme list offers Retry that fetches the themes again', async () => {
  let fail = true;
  const env = await boot('#/settings?tab=appearance', { '/api/themes': () => (fail ? HTTP500 : { themes: [] }) });
  const note = alerts(env).find((a) => /themes/i.test(a.textContent));
  assert.equal(buttons(note, /^Retry$/).length, 1);
  fail = false;
  buttons(note, /^Retry$/)[0].click();
  await tick();
  assert.match(text(env), /No custom themes yet/);
});
test('T19a: a failed pipelines page-part offers Retry (Today rail covers the same function)', async () => {
  const src = await read('page-pipelines.js');
  assert.match(src, /errorNote\(err, t\("part\.pipelines"\), \w+/);
});

// ---- T19a.3: a failed page names itself ----
test('T19a: a failed guide page keeps its name in the title, the h1 and the crumb (never the slug)', async () => {
  const env = await boot('#/guide/portal', { '/api/guide': HTTP500, '/api/guide/page': HTTP500 });
  const h1 = tree(view(env)).filter((e) => e.tagName === 'h1');
  assert.equal(h1.length, 1);
  assert.equal(h1[0].textContent, 'Guide');
  assert.equal(env.document.title, 'Guide - amauta');
  const crumbs = tree(view(env)).filter((e) => e.className === 'crumbs');
  assert.doesNotMatch(crumbs[0].textContent, /portal/);
});
test('T19a: a failed list page keeps its name in the title and the h1', async () => {
  const env = await boot('#/harness', { '/api/harness': HTTP500 });
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'h1')[0].textContent, 'Harness overview');
  assert.equal(env.document.title, 'Harness overview - amauta');
});
test('T19a: a project whose page fails keeps its tab bar, its name and the "Project name" title', async () => {
  const env = await boot('#/project/amauta?tab=graph', { '/api/wiki/page': HTTP500 });
  assert.ok(tree(view(env)).some((e) => e.className === 'tabs'), 'the project tab bar stays');
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'h1')[0].textContent, 'amauta');
  assert.equal(env.document.title, 'Project amauta - amauta');
  assert.equal(alerts(env).length >= 1, true);
});
test('T19a: a project tab that fails keeps the tab bar and shows the error inside the tab panel', async () => {
  const pg = page('project', { id: 'amauta', title: 'amauta', graph: {}, progress: null });
  const env = await boot('#/project/amauta?tab=graph', { '/api/wiki/page': pg, '/api/graphify': HTTP500 });
  const panel = tree(view(env)).find((e) => e.className === 'tab-panel');
  assert.ok(panel && tree(panel).some((e) => e.getAttribute && e.getAttribute('role') === 'alert'));
  assert.ok(tree(view(env)).some((e) => e.className === 'tabs'));
});

// ---- T19b: Today's requests are issued together ----
test('T19b: Today issues every request before the first one resolves', async () => {
  const log = [];
  const slow = (name, body) => async () => { log.push(`start ${name}`); await tick(40); log.push(`done ${name}`); return body; };
  const env = await boot('#/', { '/api/wiki/home': slow('home', HOME), '/api/pipelines': slow('pipes', { available: false, projects: [] }),
    '/api/harness': slow('harness', HS), '/api/harness/components': slow('comps', COMPS), '/api/skills': slow('skills', { groups: [] }) });
  await tick(150);
  const firstDone = log.findIndex((l) => l.startsWith('done'));
  const starts = log.slice(0, firstDone).filter((l) => l.startsWith('start')).length;
  assert.equal(starts, 5, log.join(', '));
});

// ---- T19c: every checkbox has a 24 px target ----
test('T19c: the checkbox rule makes the target at least 24 px (1.5rem) in both axes', async () => {
  const css = await read('style.css');
  const rule = /input\[type="checkbox"\]\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /inline-size:\s*1\.5rem/);
  assert.match(rule, /block-size:\s*1\.5rem/);
  assert.doesNotMatch(await read('style-pages.css'), /input\[type="checkbox"\]\s*\{[^}]*(inline-size|block-size|width|height):\s*1(\.\d+)?(rem|px)/);
});
