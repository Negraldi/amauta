import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const XSS = '<img src=x onerror=alert(1)>';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };

const cat = (id, title, items, over = {}) => ({ id, title, note: `Note for ${id}`, count: items.length, items, truncated: false, ...over });
const LINT = {
  window_days: 30, scanned: { memories: 12, capped: false },
  categories: [
    cat('orphans', 'Orphan memories', [{ kind: 'memory', id: '7', title: XSS, detail: 'No links to or from other pages' }]),
    cat('duplicates', 'Possible duplicates', [{ kind: 'memory', id: '1', title: 'Same', detail: '2 notes with the same title: review', members: [{ kind: 'memory', id: '1', title: 'Same', topic_key: 'a/b' }, { kind: 'memory', id: '2', title: 'Same', topic_key: 'c/d' }] }]),
    cat('superseded', 'Possibly superseded notes', []),
    cat('unused_skills', 'Installed skills never used', [{ kind: 'skill', id: 'never-used', title: 'never-used', detail: 'Installed, not loaded in the last 30 days' }], { count: 80, truncated: true }),
    cat('features_no_commits', 'ODD tasks checked without a commit', [{ kind: 'feature', id: 'f', title: 'f', detail: '1 of 3 checked tasks have no commit hash in their evidence: W2' }]),
    cat('missing_links', 'Wikilinks to missing pages', []),
  ],
};

async function boot(lint = LINT) {
  const env = makeEnv({ '/api/wiki/lint': async () => lint, '/api/wiki/recent': { items: [] }, '/api/overview': { available: false } });
  env.location.hash = '#/lint';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}
const view = (env) => env.document.getElementById('view');

test('the lint page shows each category with its count, note and links to the pages', async () => {
  const env = await boot();
  const v = view(env);
  for (const c of LINT.categories) assert.match(v.textContent, new RegExp(c.title), c.id);
  assert.match(v.textContent, /Orphan memories \(1\)/);
  assert.match(v.textContent, /Installed skills never used \(80\)/);
  assert.match(v.textContent, /Note for orphans/);
  const hrefs = tree(v).filter((e) => e.tagName === 'a').map((e) => e.attrs.href);
  for (const h of ['#/memory/7', '#/memory/1', '#/memory/2', '#/skill/never-used', '#/feature/f']) assert.ok(hrefs.includes(h), h);
});

test('data stays text (no markup from titles) and truncation and empty categories are stated', async () => {
  const env = await boot();
  const v = view(env);
  assert.match(v.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0);
  assert.match(v.textContent, /Showing 1 of 80/);
  assert.match(v.textContent, /Nothing to review/);
});

test('review wording stays conservative: candidates are labelled, never asserted', async () => {
  const env = await boot();
  assert.doesNotMatch(view(env).textContent, /contradict/i);
});

test('the sidebar links to Lint and the Range/Project filters are hidden there', async () => {
  const env = await boot();
  const nav = env.document.getElementById('nav');
  assert.ok(tree(nav).some((e) => e.tagName === 'a' && e.attrs.href === '#/lint'));
  assert.equal(env.document.getElementById('filters').hidden, true);
});

test('a failing request shows an error panel, not a blank page', async () => {
  const env = makeEnv({ '/api/wiki/recent': { items: [] }, '/api/overview': { available: false } });
  env.location.hash = '#/lint';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  assert.match(view(env).textContent, /Error/);
});
