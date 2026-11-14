// T16d: loading and error states. A part that fails never changes a headline figure or vanishes silently, a failure is never
// shown as an empty state, transport errors and routes stay out of the copy, and loading / reloading is announced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { boot, tick, tree, view, text, ES } from './helpers/t15w3.js';
import { STATIC, readDicts } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const { en: EN, es: ES_DICT } = await readDicts();
const DOWN = () => { throw new TypeError('Failed to fetch'); }; // a rejected fetch, like a server that stopped
const HTTP500 = { __status: 500, error: 'boom' };
const item = (id) => ({ id, title: id, source: 'x', description: '' });
const COMPS = { total: 3, pending: 0, groups: [{ kind: 'hook', label: 'Hooks', items: [item('a'), item('b'), item('c')] }] };
const SKILLS = { groups: [{ label: 'User', items: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, description: '' })) }] };
const HS = { installed: true, version: '1.0.0', hooks: [], components: [], managed_files: 1, telemetry: true, persona: 'neutral', rdd_mode: 'on' };
const alerts = (env) => tree(view(env)).filter((e) => e.getAttribute && e.getAttribute('role') === 'alert');
const HOME = { activity: [], spending: { available: false }, impact: null, health: { installed: true } };

// ---- F1: a count built from a failed part is never the complete count ----
for (const [hash, extra] of [['#/component', {}], ['#/', { '/api/wiki/home': HOME, '/api/harness': HS }], ['#/harness', { '/api/harness': HS }]]) {
  test(`F1: ${hash} with /api/skills down does not present the partial total as complete`, async () => {
    const env = await boot(hash, { '/api/harness/components': COMPS, '/api/skills': HTTP500, '/api/archify': { installed: false }, ...extra });
    assert.doesNotMatch(text(env), /(?<!\d)3 (components|things)(?!, not counting)/, 'the partial total of 3 is not said as the total');
    assert.ok(alerts(env).some((a) => /skills/i.test(a.textContent)), 'an inline note names the skills');
  });
}
test('F1: with skills loaded the full total is still said (5 skills + 3 hooks = 8)', async () => {
  const env = await boot('#/component', { '/api/harness/components': COMPS, '/api/skills': SKILLS });
  assert.match(text(env), /(?<!\d)8 things installed/);
  assert.equal(alerts(env).length, 0);
});

// ---- F2: a section whose request fails says so in place ----
test('F2: Today names the pipelines and the status line that could not load', async () => {
  const env = await boot('#/', { '/api/wiki/home': HOME, '/api/pipelines': HTTP500, '/api/harness': HTTP500 });
  const said = alerts(env).map((a) => a.textContent).join(' | ');
  assert.match(said, /pipelines/i);
  assert.match(said, /harness/i);
});
test('F2: Harness shows an error note where the architecture diagram would be', async () => {
  const env = await boot('#/harness', { '/api/harness': HS, '/api/archify': HTTP500, '/api/harness/components': COMPS, '/api/skills': SKILLS });
  assert.ok(alerts(env).some((a) => /architecture/i.test(a.textContent)), 'the note names the architecture diagram');
});
test('F2: Harness without archify installed still shows no architecture section', async () => {
  const env = await boot('#/harness', { '/api/harness': HS, '/api/archify': { installed: false }, '/api/harness/components': COMPS, '/api/skills': SKILLS });
  assert.equal(alerts(env).length, 0);
});

// ---- F3: a failed theme list is not "no custom themes" ----
test('F3: a failed /api/themes shows an error note and never the empty state', async () => {
  const env = await boot('#/settings?tab=appearance', { '/api/themes': HTTP500 });
  assert.doesNotMatch(text(env), /No custom themes yet/);
  assert.ok(alerts(env).some((a) => /themes/i.test(a.textContent)));
  const ok = await boot('#/settings?tab=appearance', { '/api/themes': { themes: [] } });
  assert.match(text(ok), /No custom themes yet/);
});

// ---- F4: no raw transport text, no raw route ----
test('F4: a rejected fetch reads as the translated network message in the page error, without the hash route', async () => {
  for (const [extra, want] of [[{}, /The portal server could not be reached/], [ES, /No se pudo contactar con el servidor del portal/]]) {
    const env = await boot('#/harness', { '/api/harness': DOWN }, extra);
    assert.match(text(env), want);
    assert.doesNotMatch(text(env), /Ruta: #|Route: #|#\/harness/);
  }
});
test('F4: the network error is not wrapped twice by pages that already call netError', async () => {
  const env = await boot('#/harness', { '/api/harness': DOWN });
  assert.equal((text(env).match(/could not be reached/g) || []).length, 1);
});
test('F4: "HTTP 500" reads as a sentence in both languages', async () => {
  for (const [extra, want] of [[{}, /The server answered with an error \(HTTP 500\)\./], [ES, /El servidor respondió con un error \(HTTP 500\)\./]]) {
    const env = await boot('#/harness', { '/api/harness': { __status: 500 } }, extra);
    assert.match(text(env), want);
  }
});

// ---- F5: loading is announced once through #status, and cleared when the page renders ----
test('F5: a slow page announces loading in #status and clears it when it renders', async () => {
  const env = await boot('#/harness', { '/api/harness': async () => { await tick(500); return HS; }, '/api/archify': { installed: false } });
  await tick(300);
  assert.equal(env.document.getElementById('status').textContent, 'Loading...');
  await tick(400);
  assert.equal(env.document.getElementById('status').textContent, '');
});
test('F5: a fast page never announces', async () => {
  const env = await boot('#/harness', { '/api/harness': HS, '/api/archify': { installed: false } });
  assert.equal(env.document.getElementById('status').textContent, '');
});

// ---- F6: a same-route reload is busy, and says so visually ----
test('F6: changing the range on the same route sets aria-busy and a reloading mark until done, and clears them on failure too', async () => {
  let slow = false, fail = false;
  const env = await boot('#/usage', { '/api/costs': { enabled: false, models: [] }, '/api/overview': async () => { if (slow) await tick(150); if (fail) return HTTP500; return { available: false }; } });
  slow = true;
  const days = env.document.getElementById('days');
  for (const fn of days.listeners.change ?? []) fn({ target: days });
  await tick(30);
  assert.equal(view(env).getAttribute('aria-busy'), 'true');
  assert.ok(view(env).getAttribute('data-reloading') !== undefined, 'the view is marked for dimming');
  await tick(250);
  assert.equal(view(env).getAttribute('aria-busy'), 'false');
  assert.equal(view(env).getAttribute('data-reloading'), undefined);
  fail = true;
  for (const fn of days.listeners.change ?? []) fn({ target: days });
  await tick(250);
  assert.equal(view(env).getAttribute('aria-busy'), 'false');
  assert.equal(view(env).getAttribute('data-reloading'), undefined);
});
test('F6: the dimming honours prefers-reduced-motion', async () => {
  const css = await read('style.css');
  assert.match(css, /#view\[data-reloading\]\s*\{[^}]*opacity/);
  assert.match(css, /prefers-reduced-motion: reduce\)[^]*#view\[data-reloading\][^}]*transition: none/);
});

// ---- F8: the palette keeps local results when the search request fails ----
test('F8: a failed search keeps the page results and adds a translated note', async () => {
  for (const [extra, want] of [[{}, /could not finish/], [ES, /no pudo completarse/]]) {
    const env = await boot('#/', { '/api/wiki/home': HOME, '/api/wiki/search': DOWN }, extra);
    const input = env.document.getElementById('palette-input');
    input.value = 'us';
    for (const fn of input.listeners.input ?? []) fn({ target: input });
    await tick(400);
    const results = env.document.getElementById('palette-results');
    assert.match(results.textContent, want);
    assert.ok(tree(results).some((e) => /pal-item/.test(e.className ?? '') && /^us/i.test(e.textContent)), 'the local Usage page is still listed');
    assert.doesNotMatch(results.textContent, /Failed to fetch/);
  }
});

// ---- F9, F10 live in the second commit's block below ----
test('F9: the pipeline history mark has a control boundary of at least 3:1 (--line-strong)', async () => {
  const css = await read('style-pages.css');
  const rule = /\.hist-mark \{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /border: 1px solid var\(--line-strong\)/);
});
test('F10: the sparkline is natural-size at 343px (375px phone): viewBox no wider than 343, text not scaled below 11px', async () => {
  const env = await boot('#/', { '/api/wiki/home': HOME });
  const usage = { days: 30, daily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, value: i + 1 })) };
  const block = vm.runInContext('usageBlock', env.__ctx)(usage);
  const svg = tree(block).find((e) => e.tagName === 'svg');
  const [, , w] = svg.attrs.viewBox.split(' ').map(Number);
  assert.ok(w <= 343, `viewBox width ${w}`);
  assert.equal(svg.attrs.width, String(w), 'the svg states its natural width');
  assert.ok(11 * Math.min(1, 343 / w) >= 11);
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(ES_DICT).sort());
});
