// Critique P3 (T11 e): the home health sentence is plain text with one ordinary link on the part that navigates (the
// component count, to the harness overview). It takes the warning tone only when something needs attention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const HOME = { health: { installed: true }, activity: [], spending: { available: false }, impact: null };
const comps = (disabled) => ({ total: 2, groups: [{ id: 'plugin', items: [{ id: 'a', disabled }, { id: 'b' }] }] });

async function lead(disabled) {
  const env = makeEnv({ '/api/wiki/home': HOME, '/api/pipelines': { projects: [] }, '/api/harness': { installed: true, version: '0.1.0' },
    '/api/harness/components': comps(disabled), '/api/skills': { items: [] } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return tree(env.document.getElementById('view')).find((e) => /\blead\b/.test(e.className || ''));
}

test('a healthy harness reads as plain text with a link on the component count', async () => {
  const p = await lead(false);
  assert.equal(p.textContent, 'amauta 0.1.0 is installed; 2 components, nothing needs attention.');
  const links = tree(p).filter((e) => e.tagName === 'a');
  assert.deepEqual(links.map((a) => [a.textContent, a.attrs.href]), [['2 components', '#/harness']]);
  assert.doesNotMatch(p.className, /warn/);
});

test('a harness that needs attention keeps the warning tone and mark', async () => {
  const p = await lead(true);
  assert.match(p.className, /warn/);
  assert.match(p.textContent, /^▲ /);
  assert.match(p.textContent, /1 needs attention/);
});
