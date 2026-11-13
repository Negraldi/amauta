// T14 P3: Settings lists on/off choices in one order everywhere; the project tabs wrap at phone width instead of hiding
// behind a sideways scroll; the title and lead of a page sit one spacing step apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const CURRENT = { persona: 'gentleman', review_mode: 'off', telemetry: 'on', privacy: 'on', checks: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } };
const SETTINGS = { installed: true, current: CURRENT, allowed: { persona: ['gentleman', 'neutral'], review_mode: ['on', 'off'], telemetry: ['on', 'off'],
  modules: ['sdd', 'rea', 'context7', 'impeccable', 'archify'], module_values: ['on', 'off'] }, undo: { available: false, backup: null, ts: null } };

test('every on/off choice in Settings lists On first, then Off', async () => {
  const env = makeEnv({ '/api/settings': SETTINGS, '/api/wiki/recent': { items: [] }, '/api/overview': { available: false } });
  env.location.hash = '#/settings';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const selects = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'select');
  const orders = selects.map((s) => s.children.map((o) => o.getAttribute('value'))).filter((v) => v.includes('on') && v.includes('off'));
  assert.ok(orders.length >= 9, String(orders.length));
  for (const o of orders) assert.deepEqual(o, ['on', 'off']);
});

const css = (await readFile(path.join(STATIC, 'style.css'), 'utf8')) + (await readFile(path.join(STATIC, 'style-pages.css'), 'utf8'));
const rule = (sel) => (css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^$()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[2] || '';

test('a page title and its lead sit one spacing step apart (--s2), with the head spaced from the content below', () => {
  assert.match(rule('.page-head'), /row-gap: var\(--s2\)/);
  assert.match(rule('.page-head'), /margin-bottom: var\(--s5\)/);
  assert.match(rule('#view .page-head > h1, #view .page-head > .lead'), /margin-block: 0/);
});

test('at phone width the tabs wrap onto a second row instead of hiding the last ones behind a sideways scroll', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 560px)'));
  assert.doesNotMatch(phone, /\.tabs \{[^}]*(nowrap|overflow-x)/);
  assert.match(rule('.tabs'), /flex-wrap: wrap/);
});

test('the Projects list uses the shared page head', async () => {
  const env = makeEnv({ '/api/projects': { auto_discover: false, config_repos: [], projects: [{ name: 'a', path: '/a', origin: ['config'],
    odd: { features: 0, done: 0, total: 0, percent: 0 }, sessions: 0, memories: 0, graph: { mirrored: false, nodes: 0, edges: 0, synced_at: null } }] },
  '/api/siblings': { siblings: [] } });
  env.location.hash = '#/project';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const head = tree(env.document.getElementById('view')).find((e) => e.tagName === 'header');
  assert.ok(head && /page-head/.test(head.getAttribute('class') || head.className), 'a page-head');
  assert.equal(head.children[0].tagName, 'h1');
});
