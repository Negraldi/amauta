// T13 re-critique item 10: large numbers were "2,4B" in Spanish too, where "billón" is 10^12. Spanish now says "2,4 mil M"
// (miles de millones); English keeps 2.4B, 12.4M and 3.5k.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

async function shortIn(language) {
  const env = makeEnv({ '/api/wiki/home': { activity: [], spending: { available: false }, health: { installed: false } }, '/api/pipelines': { projects: [] } });
  env.location.hash = '#/';
  const ctx = await runPortal(env, { DOMParser: class {}, queueMicrotask, navigator: { language } });
  await tick();
  return (n) => vm.runInContext(`short(${n})`, ctx);
}

test('English keeps the short units', async () => {
  const s = await shortIn('en-US');
  assert.deepEqual([s(2.4e9), s(12_158_958), s(3500), s(999)], ['2.4B', '12.2M', '3.5k', '999']);
});

test('Spanish never writes B for thousands of millions', async () => {
  const s = await shortIn('es-AR');
  assert.deepEqual([s(2.4e9), s(4.8e9), s(12_158_958), s(3500), s(999)], ['2,4 mil M', '4,8 mil M', '12,2M', '3,5k', '999']);
});
