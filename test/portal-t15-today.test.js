// T15 W1 (A2): a day with more rows than a page says "N of M" and offers the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const HOME = { health: { installed: false }, spending: { available: false }, impact: null };
const note = (n) => ({ kind: 'memory', id: String(n), title: `Note ${n}`, what: 'memory saved', ts: `2026-11-13T12:${String(n % 60).padStart(2, '0')}:00` });

test('a busy day shows 20 rows, "20 of 31", and Show more reveals the others', async () => {
  const activity = [{ day: '2026-11-13', items: Array.from({ length: 31 }, (_, i) => note(i)) }];
  const env = makeEnv({ '/api/wiki/home': { ...HOME, activity }, '/api/pipelines': { projects: [] } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const v = env.document.getElementById('view');
  const rows = () => tree(v).filter((e) => e.tagName === 'li' && /Note \d+/.test(e.textContent));
  assert.equal(rows().length, 20);
  assert.match(v.textContent, /Showing 20 of 31/);
  tree(v).find((e) => e.tagName === 'button' && e.textContent === 'Show more').click();
  assert.equal(rows().length, 31);
  assert.doesNotMatch(v.textContent, /Showing 20 of 31/);
});
