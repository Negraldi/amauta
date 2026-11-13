// Critique P2 (T11 c): one name per page. The home page is "Today" in its nav group, nav item, title and error action; the
// harness overview has the same title in English and Spanish ("Harness overview" / "Resumen del harness").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, readDicts } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const { en, es } = await readDicts();

test('the home page has one name in each language', () => {
  for (const [d, name] of [[en, 'Today'], [es, 'Hoy']]) {
    for (const key of ['nav.group.today', 'nav.home', 'home.title', 'kind.home']) assert.equal(d[key], name, key);
    assert.match(d['error.home'], new RegExp(name));
    assert.match(d['common.backHome'], new RegExp(name));
  }
});

test('the harness overview has the same title in both languages', () => {
  assert.equal(en['nav.harnessPage'], 'Harness overview');
  assert.equal(es['nav.harnessPage'], 'Resumen del harness');
  assert.equal(en['kind.harness'], en['nav.harnessPage']);
  assert.equal(es['kind.harness'], es['nav.harnessPage']);
});

test('Today opens with its title and labels the feed as recent activity', async () => {
  const env = makeEnv({ '/api/wiki/home': { health: { installed: false }, activity: [], spending: { available: false }, impact: null },
    '/api/pipelines': { projects: [] } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const v = env.document.getElementById('view');
  assert.equal(tree(v).find((e) => e.tagName === 'h1').textContent, 'Today');
  assert.ok(tree(v).some((e) => e.tagName === 'h2' && e.textContent === 'Recent activity'));
});

test('a one-item group named like its item shows the name once in the sidebar', async () => {
  const env = makeEnv({ '/api/wiki/home': { health: { installed: false }, activity: [], spending: { available: false }, impact: null },
    '/api/pipelines': { projects: [] } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const nav = env.document.getElementById('nav');
  assert.equal(nav.textContent.match(/Today/g).length, 1);
  const group = tree(nav).find((e) => e.attrs.role === 'group' && e.attrs['aria-label'] === 'Today');
  assert.ok(group, 'the group keeps its accessible name');
});
