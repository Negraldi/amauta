// T13 re-critique, Today: a feed row under its day heading shows only the time, and says plainly when the session started
// on an earlier day; the page lead stacks under the h1 like every other page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const HOME = { health: { installed: false }, spending: { available: false }, impact: null };

async function home(activity) {
  const env = makeEnv({ '/api/wiki/home': { ...HOME, activity }, '/api/pipelines': { projects: [] } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}

test('a session that started on an earlier day says so; one from the same day shows only the time', async () => {
  const env = await home([{ day: '2026-11-13', items: [
    { kind: 'session', id: 's1', title: 'amauta · Fix the build', what: '12 messages', ts: '2026-11-13T15:00:00Z', started: '2026-11-09T15:00:00Z' },
    { kind: 'session', id: 's2', title: 'amauta · Same day', what: '3 messages', ts: '2026-11-13T16:00:00Z', started: '2026-11-13T14:00:00Z' }] }]);
  const rows = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'li' && /amauta/.test(e.textContent)).map((e) => e.textContent);
  assert.equal(rows.length, 2);
  assert.match(rows.find((r) => /Fix the build/.test(r)), /12 messages, started 2026-11-09 \d\d:\d\d, last active \d\d:\d\d$/);
  assert.match(rows.find((r) => /Same day/.test(r)), /Same day · 3 messages, last active \d\d:\d\d$/);
  assert.doesNotMatch(rows.join(' '), /2026-11-13/); // the heading already says the day
});
