// T15 W3b group C (repeated explanation, class 14) and the session page / Today wording it touches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, page, tree, view, text, ES } from './helpers/t15w3.js';

const SESSION = page('session', { id: 'b9600f26-aaaa', title: 'amauta · Fix the portal bug · 2026-10-23',
  meta: [{ label: 'Project', value: 'amauta', kind: 'project' }, { label: 'Started', value: '2026-10-23T08:00:00Z' }] });
test('A7: the session page heading is what the session was about, not its project and date again', async () => {
  const env = await boot('#/session/b9600f26', { '/api/wiki/page': SESSION });
  assert.equal(tree(view(env)).find((e) => e.tagName === 'h1').textContent, 'Fix the portal bug');
  assert.ok(tree(view(env)).some((e) => e.tagName === 'dt' && e.textContent === 'Started'));
});
test('A8: the project of a session is a link to its page', async () => {
  const env = await boot('#/session/b9600f26', { '/api/wiki/page': SESSION });
  const a = tree(view(env)).find((e) => e.tagName === 'a' && e.attrs.href === '#/project/amauta');
  assert.ok(a, 'a link to #/project/amauta');
});

const SETTINGS = { installed: true, current: { persona: 'gentleman', review_mode: 'off', telemetry: 'on', privacy: 'on', checks: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } }, allowed: {}, undo: { available: false } };
test('E9: "those hooks are removed" is said once for the three hook switches (es)', async () => {
  const env = await boot('#/settings', { '/api/settings': SETTINGS }, ES);
  assert.equal((text(env).match(/esos hooks se eliminan/g) || []).length, 0);
  assert.equal((text(env).match(/se elimina/g) || []).length, 1);
});
test('E9: the Appearance language control has one visible name', async () => {
  const env = await boot('#/settings?tab=appearance', { '/api/themes': { themes: [], tokens: [], max: 50 } }, ES);
  assert.equal(tree(view(env)).filter((e) => /^Idioma$/.test(e.textContent) && ['h2', 'label'].includes(e.tagName)).length, 1);
  assert.ok(tree(view(env)).find((e) => e.attrs.id === 'set-lang').attrs['aria-labelledby']);
});

test('A11: a project sessions tab has a short scope line and rows with the title and start date', async () => {
  const sessions = { available: true, projects: [], sessions: [{ session_id: 'aaaaaaaa1', runtime: 'claude', project: 'amauta', model: 'm', models: 1, messages: 1, input: 1, output: 1,
    cache_read: 0, cache_write: 0, first_ts: '2026-11-09T08:00:00Z', last_ts: '2026-11-10T08:00:00Z', title: 'Fix the portal' }] };
  const env = await boot('#/project/amauta?tab=sessions', { '/api/sessions': sessions, '/api/wiki/page': page('project', { id: 'amauta', title: 'amauta', meta: [], progress: null }) });
  const scope = tree(view(env)).find((e) => e.tagName === 'p' && /newest first/i.test(e.textContent));
  assert.ok(scope && scope.textContent.length < 130, scope && scope.textContent);
  assert.match(text(env), /Fix the portal/);
  assert.match(text(env), /started 2026-11-09/);
});

const FEED = (items) => ({ '/api/wiki/home': { activity: [{ day: '2026-11-14', items }], spending: { available: false }, health: { installed: false }, impact: null }, '/api/pipelines': { projects: [] } });
test('A7: a session row on Today puts a separator before its details', async () => {
  const item = { kind: 'session', id: 's1', title: 'amauta · Fix it', ts: '2026-11-14T10:00:00Z', started: '2026-11-13T08:00:00Z', what: '3 messages' };
  const env = await boot('#/', FEED([item]));
  const li = tree(view(env)).find((e) => e.tagName === 'li' && /Fix it/.test(e.textContent));
  assert.match(li.textContent, /Fix it · 3 messages/);
});
