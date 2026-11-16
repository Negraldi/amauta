// T13 re-critique item 15: after typing in the search palette, "Type to search..." stayed for about a second with no sign
// of work. A pending search now says "Searching." at once (aria-busy on the results) until its answer is painted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

test('typing shows a searching state until the results arrive', async () => {
  let release;
  const pending = new Promise((r) => { release = r; });
  const env = makeEnv({ '/api/wiki/home': { activity: [], spending: { available: false }, health: { installed: false } }, '/api/pipelines': { projects: [] },
    '/api/wiki/search': async () => { await pending; return { groups: [{ kind: 'memory', items: [{ kind: 'memory', id: '1', title: 'Widgets' }] }] }; } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const input = env.document.getElementById('palette-input'), results = env.document.getElementById('palette-results');
  input.value = 'widg';
  for (const fn of input.listeners.input ?? []) fn({ target: input });
  assert.match(results.textContent, /Searching/, 'at once, before the debounce');
  assert.equal(results.getAttribute('aria-busy'), 'true');
  await tick(200);
  assert.match(results.textContent, /Searching/, 'still pending');
  release();
  await tick();
  assert.match(results.textContent, /Widgets/);
  assert.equal(results.getAttribute('aria-busy'), undefined);
});
