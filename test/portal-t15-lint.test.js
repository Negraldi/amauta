// T15 W1 (B2, B3): Quality lists and duplicate groups say "N of M" and offer the rest through a Show more button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const mem = (n) => ({ kind: 'memory', id: String(n), title: `Note ${n}`, detail: 'No links' });
const members = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'memory', id: `m${i}`, title: `Same ${i}`, topic_key: `t/${i}` }));
const cat = (id, items) => ({ id, title: id, note: `Note for ${id}`, count: items.length, items, truncated: false });

async function boot(categories) {
  const lint = { window_days: 30, scanned: { memories: 1, capped: false }, categories };
  const env = makeEnv({ '/api/wiki/lint': async () => lint, '/api/wiki/recent': { items: [] }, '/api/overview': { available: false } });
  env.location.hash = '#/lint';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env.document.getElementById('view');
}
const items = (v) => tree(v).filter((e) => e.tagName === 'li' && /Note \d+/.test(e.textContent) && !e.children.some((c) => c.tagName === 'ul'));
const button = (v) => tree(v).find((e) => e.tagName === 'button' && e.textContent === 'Show more'); // not the index buttons

test('a category with more rows than a page shows 50 of N and Show more reveals the rest', async () => {
  const v = await boot([cat('orphans', Array.from({ length: 120 }, (_, i) => mem(i)))]);
  assert.equal(items(v).length, 50);
  assert.match(v.textContent, /Showing 50 of 120/);
  button(v).click();
  assert.equal(items(v).length, 100);
  assert.match(v.textContent, /Showing 100 of 120/);
  button(v).click();
  assert.equal(items(v).length, 120);
  assert.equal(button(v), undefined);
  assert.doesNotMatch(v.textContent, /Showing/);
});

test('a duplicate group says how many of its notes are listed and offers the rest', async () => {
  const group = { kind: 'memory', id: 'm0', title: 'Same', detail: '8 notes with the same title', members: members(8) };
  const v = await boot([cat('duplicates', [group])]);
  const links = () => tree(v).filter((e) => e.tagName === 'a' && /^#\/memory\/m/.test(e.attrs.href));
  assert.equal(links().length, 6);
  assert.match(v.textContent, /6 of 8/);
  button(v).click();
  assert.equal(links().length, 8);
  assert.doesNotMatch(v.textContent, /6 of 8/);
});
