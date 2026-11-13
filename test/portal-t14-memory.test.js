// T14 cross-page agreement, memory: the list says "50 of N" and fetches the rest with Show more; a palette group that hit
// the search cap says so ("first 50 of 728", or "50+" when the total is unknown) instead of reading as the whole count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const row = (i) => ({ id: i, title: `Note ${i}`, type: 'note', project: 'p', topic_key: null, revision: 1, updated_at: `2026-11-01T10:${String(i % 60).padStart(2, '0')}:00Z` });
const page = (offset, n) => ({ source: 'own', available: true, total: 728, offset, items: Array.from({ length: n }, (_, k) => row(offset + k)),
  facets: { projects: [], types: ['note'] } });

async function boot(hash, routes) {
  const env = makeEnv(routes);
  env.location.hash = hash;
  const palette = env.document.getElementById('palette');
  palette.showModal = () => { palette.attrs.open = ''; };
  palette.close = () => { delete palette.attrs.open; };
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}

test('the memory list says how many of the total it shows and Show more fetches the next page', async () => {
  const env = await boot('#/memory', { '/api/memories': (opts, url) => page(Number(new URL(url, 'http://x').searchParams.get('offset') || 0), 50) });
  const v = env.document.getElementById('view');
  assert.match(v.textContent, /Showing 50 of 728/);
  const more = tree(v).find((e) => e.tagName === 'button' && /Show more/.test(e.textContent));
  assert.ok(more, 'a Show more button');
  more.click();
  await tick();
  assert.ok(env.calls.some((c) => /\/api\/memories\?.*offset=50/.test(String(c.url))), env.calls.map((c) => c.url).join(' '));
  assert.equal(tree(v).filter((e) => e.tagName === 'tr').length, 101, 'header + 100 rows');
  assert.match(v.textContent, /Showing 100 of 728/);
});

test('a capped palette group says it is capped', async () => {
  const found = { q: 'x', groups: [
    { kind: 'memory', count: 50, capped: true, total: 728, items: [{ kind: 'memory', id: '1', title: 'One' }] },
    { kind: 'session', count: 50, capped: true, total: null, items: [{ kind: 'session', id: 's', title: 'S' }] },
    { kind: 'skill', count: 3, capped: false, total: null, items: [{ kind: 'skill', id: 'k', title: 'K' }] }] };
  const env = await boot('#/session', { '/api/wiki/search': found, '/api/sessions': { available: false } });
  env.document.getElementById('search-open').click();
  const input = env.document.getElementById('palette-input');
  input.value = 'x';
  for (const fn of input.listeners.input) fn({});
  await tick(200);
  const heads = tree(env.document.getElementById('palette-results')).filter((e) => /pal-head/.test(e.getAttribute('class') || e.className || '')).map((e) => e.textContent);
  assert.ok(heads.includes('Memories (first 50 of 728)'), heads.join(' | '));
  assert.ok(heads.includes('Sessions (50+)'), heads.join(' | '));
  assert.ok(heads.includes('Skills (3)'), heads.join(' | '));
});
