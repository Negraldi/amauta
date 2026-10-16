import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const XSS = '<img src=x onerror=alert(1)>';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const plain = (x) => JSON.parse(JSON.stringify(x));
const rctx = {};
vm.runInNewContext(await read('wikiroute.js'), rctx);
const R = rctx.AmautaRoute;

const CURRENT = { persona: 'gentleman', review_mode: 'off', telemetry: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } };
const draftOf = (over = {}) => ({ ...CURRENT, ...over, modules: { ...CURRENT.modules, ...(over.modules || {}) } });

test('settingsChanges and settingsBody describe only what differs, from the closed list', () => {
  assert.deepEqual(plain(R.settingsChanges(CURRENT, draftOf())), []);
  const d = draftOf({ persona: 'neutral', telemetry: 'off', modules: { sdd: 'on' } });
  assert.deepEqual(plain(R.settingsChanges(CURRENT, d)).map((c) => [c.key, c.from, c.to]), [['persona', 'gentleman', 'neutral'], ['telemetry', 'on', 'off'], ['module:sdd', 'off', 'on']]);
  assert.deepEqual(plain(R.settingsBody(CURRENT, d)), { persona: 'neutral', telemetry: 'off', modules: { sdd: 'on' } });
  assert.deepEqual(plain(R.settingsBody(CURRENT, draftOf(), true)), { repair: true });
  assert.deepEqual(plain(R.settingsBody(CURRENT, draftOf({ review_mode: 'on' }))), { review_mode: 'on' });
});

test('settingsAdvice tells the person what to do next and whether to preview again', () => {
  assert.equal(R.settingsAdvice(409).again, true);
  assert.equal(R.settingsAdvice(400).again, true);
  assert.match(R.settingsAdvice(403).text, /Reload/);
  assert.match(R.settingsAdvice(502).text, /amauta status/);
  assert.equal(R.settingsAdvice(502).again, false);
  assert.ok(R.settingsAdvice(500).text.length > 10);
});

// ---- the page ----------------------------------------------------------------------------------------------
const SETTINGS = { installed: true, current: CURRENT, allowed: { persona: ['gentleman', 'neutral'], review_mode: ['on', 'off'], telemetry: ['on', 'off'], modules: ['sdd', 'rea', 'context7', 'impeccable', 'archify'], module_values: ['on', 'off'] }, undo: { available: false, backup: null, ts: null } };
const PLAN = { changes: [{ key: 'persona', from: 'gentleman', to: 'neutral' }, { key: 'module:sdd', from: 'off', to: 'on' }], repair: false,
  plan: { changed: true, files: ['output-styles/gentleman.md', 'settings.json', XSS], removed: ['skills/old/SKILL.md'], skipped: ['skills/mine/SKILL.md'], state_changes: {} }, apply_token: 'TOK-1', expires_in: 300 };

async function boot(over = {}) {
  const posts = [];
  const respond = (path, fn) => async (opts) => { posts.push({ path, headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null, method: opts.method }); return fn(opts); };
  const routes = {
    '/api/settings': async () => SETTINGS,
    '/api/settings/preview': respond('preview', () => PLAN),
    '/api/settings/apply': respond('apply', () => ({ ok: true, backup: '20261016T101500Z', changed: true, files: ['settings.json'], removed: [], skipped: [], state_changes: {}, undo_available: true })),
    '/api/settings/undo/preview': respond('undo-preview', () => ({ changes: [{ key: 'persona', from: 'neutral', to: 'gentleman' }], repair: false, plan: { changed: true, files: ['settings.json'], removed: [], skipped: [], state_changes: {} }, apply_token: 'UNDO-1', expires_in: 300 })),
    '/api/settings/undo': respond('undo', () => ({ ok: true, backup: '20261016T103000Z', changed: true, files: ['settings.json', 'output-styles/gentleman.md'], removed: [], skipped: [], state_changes: {}, undo_available: false })),
    '/api/wiki/recent': { items: [] }, '/api/overview': { available: false },
    ...over,
  };
  const env = makeEnv(routes);
  env.location.hash = '#/settings';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return { env, posts };
}
const view = (env) => env.document.getElementById('view');
const button = (env, label) => tree(view(env)).find((e) => e.tagName === 'button' && e.textContent === label);
const field = (env, id) => tree(view(env)).find((e) => e.attrs.id === id);
const choose = (env, id, value) => { const f = field(env, id); f.value = value; for (const fn of f.listeners.change ?? []) fn({ target: f }); };

test('the page lists every option of the closed list with its current value and a consequence line', async () => {
  const { env } = await boot();
  const v = view(env);
  assert.match(v.textContent, /Persona/);
  assert.match(v.textContent, /Review mode/);
  assert.match(v.textContent, /Telemetry/);
  for (const m of ['sdd', 'rea', 'context7', 'impeccable', 'archify']) assert.ok(field(env, `set-module-${m}`), m);
  assert.equal(field(env, 'set-persona').value, 'gentleman');
  assert.equal(field(env, 'set-telemetry').value, 'on');
  assert.deepEqual(tree(field(env, 'set-persona')).filter((e) => e.tagName === 'option').map((o) => o.getAttribute('value')), ['gentleman', 'neutral']);
  assert.ok(tree(v).filter((e) => /option-help/.test(e.className)).every((e) => e.textContent.length > 20));
  assert.equal(tree(v).filter((e) => e.tagName === 'textarea' || (e.tagName === 'input' && e.attrs.type === 'text')).length, 0, 'no free-form fields');
  assert.equal(button(env, 'Preview changes').attrs.disabled, '', 'nothing to preview yet');
  assert.ok(button(env, 'Preview repair'));
  assert.ok(!button(env, 'Apply changes'));
});

test('changing an option marks it with words and a symbol (not color alone) and enables the preview', async () => {
  const { env } = await boot();
  choose(env, 'set-persona', 'neutral');
  assert.match(view(env).textContent, /◆ changed, was gentleman/);
  assert.equal(button(env, 'Preview changes').attrs.disabled, undefined);
  choose(env, 'set-persona', 'gentleman');
  assert.doesNotMatch(view(env).textContent, /changed, was/);
  assert.equal(button(env, 'Preview changes').attrs.disabled, '');
});

test('Preview changes posts only the changed keys with the token and a JSON content type, then shows the plan as text', async () => {
  const { env, posts } = await boot();
  choose(env, 'set-persona', 'neutral');
  choose(env, 'set-module-sdd', 'on');
  button(env, 'Preview changes').click();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].method, 'POST');
  assert.equal(posts[0].headers['X-Portal-Token'], 'TOKEN-123');
  assert.equal(posts[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(posts[0].body, { persona: 'neutral', modules: { sdd: 'on' } });
  const v = view(env);
  assert.match(v.textContent, /Persona: gentleman → neutral/);
  assert.match(v.textContent, /Module sdd: off → on/);
  assert.match(v.textContent, /3 file\(s\) written, 1 removed, 1 kept because you edited them/);
  assert.match(v.textContent, /settings\.json/);
  assert.ok(tree(v).some((e) => e.textContent === XSS), 'a hostile file name is text');
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(button(env, 'Apply changes'));
});

test('Apply needs a second, explicit confirmation, then posts the one-time token and shows the backup with an Undo button', async () => {
  const { env, posts } = await boot();
  choose(env, 'set-persona', 'neutral');
  button(env, 'Preview changes').click();
  await tick();
  button(env, 'Apply changes').click();
  await tick();
  assert.equal(posts.filter((p) => p.path === 'apply').length, 0, 'the first click only asks');
  assert.match(view(env).textContent, /A backup is made first/);
  button(env, 'Yes, apply now').click();
  await tick();
  const apply = posts.find((p) => p.path === 'apply');
  assert.deepEqual(apply.body, { apply_token: 'TOK-1', confirm: true });
  assert.match(view(env).textContent, /Applied\./);
  assert.match(view(env).textContent, /Backup: 20261016T101500Z/);
  assert.ok(button(env, 'Undo this change'));
});

test('Undo previews what reverting changes, asks for confirmation, then posts the undo token', async () => {
  const { env, posts } = await boot();
  choose(env, 'set-persona', 'neutral');
  button(env, 'Preview changes').click(); await tick();
  button(env, 'Apply changes').click(); await tick();
  button(env, 'Yes, apply now').click(); await tick();
  button(env, 'Undo this change').click(); await tick();
  assert.equal(posts.filter((p) => p.path === 'undo-preview').length, 1);
  assert.deepEqual(posts.find((p) => p.path === 'undo-preview').body, {});
  assert.equal(posts.filter((p) => p.path === 'undo').length, 0, 'a preview alone changes nothing');
  assert.match(view(env).textContent, /Persona: neutral → gentleman/);
  assert.match(view(env).textContent, /re-runs the installer/);
  button(env, 'Revert these changes').click(); await tick();
  assert.equal(posts.filter((p) => p.path === 'undo').length, 0, 'the first click only asks');
  button(env, 'Yes, undo').click(); await tick();
  assert.deepEqual(posts.find((p) => p.path === 'undo').body, { apply_token: 'UNDO-1', confirm: true });
  assert.match(view(env).textContent, /Undone\./);
  assert.match(view(env).textContent, /Backup: 20261016T103000Z/);
  assert.doesNotMatch(view(env).textContent, /Restored \d+ file/);
});

test('Cancel on the confirmation sends nothing', async () => {
  const { env, posts } = await boot();
  choose(env, 'set-persona', 'neutral');
  button(env, 'Preview changes').click(); await tick();
  button(env, 'Apply changes').click(); await tick();
  button(env, 'Go back').click(); await tick();
  assert.equal(posts.filter((p) => p.path === 'apply').length, 0);
  assert.ok(button(env, 'Apply changes'));
});

test('Preview repair posts repair:true with no value changes', async () => {
  const { env, posts } = await boot();
  button(env, 'Preview repair').click(); await tick();
  assert.deepEqual(posts[0].body, { repair: true });
});

test('a stale preview (409) says what happened, what to do, and offers a fresh preview; the error is announced', async () => {
  const { env } = await boot({ '/api/settings/apply': async () => ({ __status: 409, error: 'settings changed since the preview, preview again' }) });
  choose(env, 'set-persona', 'neutral');
  button(env, 'Preview changes').click(); await tick();
  button(env, 'Apply changes').click(); await tick();
  button(env, 'Yes, apply now').click(); await tick();
  const v = view(env);
  assert.match(v.textContent, /settings changed since the preview/);
  assert.match(v.textContent, /Preview again to see the current plan/);
  assert.ok(tree(v).some((e) => e.attrs.role === 'alert'));
  assert.ok(button(env, 'Preview again'));
});

test('without an install the page says so, and no DOM node gets raw HTML', async () => {
  const { env } = await boot({ '/api/settings': async () => ({ ...SETTINGS, installed: false }) });
  assert.match(view(env).textContent, /not installed yet/);
  assert.ok(tree(view(env)).every((e) => Object.keys(e.attrs).every((k) => !k.startsWith('on'))));
});
