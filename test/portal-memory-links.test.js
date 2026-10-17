import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const XSS = '<img src=x onerror=alert(1)>';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const plain = (x) => JSON.parse(JSON.stringify(x));
const ctx = {};
vm.runInNewContext(await readFile(path.join(STATIC, 'wikiroute.js'), 'utf8'), ctx);
const R = ctx.AmautaRoute;

test('hashes carry an optional source: formatHash/parseHash round-trip and plain routes are unchanged', () => {
  assert.equal(R.formatHash('memory', '7', { source: 'engram' }), '#/memory/7?source=engram');
  assert.equal(R.formatHash('memory', '7', { source: 'own' }), '#/memory/7', 'own is the default and stays implicit');
  assert.equal(R.formatHash('memory', '7'), '#/memory/7');
  assert.deepEqual(plain(R.parseHash('#/memory/7?source=engram')), { kind: 'memory', id: '7', source: 'engram' });
  assert.deepEqual(plain(R.parseHash('#/memory/7')), { kind: 'memory', id: '7' });
  assert.deepEqual(plain(R.parseHash('#/memory/a%3Fb%2Fc?source=engram')), { kind: 'memory', id: 'a?b/c', source: 'engram' });
  assert.deepEqual(plain(R.parseHash('#/memory/7?source=evil')), { kind: 'memory', id: '7' }, 'only known sources are accepted');
  assert.deepEqual(plain(R.parseHash(R.formatHash('memfile', '-work-alpha/memory/note.md'))), { kind: 'memfile', id: '-work-alpha/memory/note.md' });
  assert.ok(R.KINDS.memfile);
});

const OWN = { source: 'own', available: true, items: [{ id: 1, title: XSS, type: 'note', project: 'p', topic_key: 'k', revision: 1, updated_at: '2026-10-01T10:00:00Z', snippet: 'x' }], facets: { projects: ['p'], types: ['note'] } };
const ENGRAM = { source: 'engram', available: true, items: [{ id: 5, title: 'Engram one', type: 'bugfix', project: 'p', topic_key: 'bug/frob', revision: 3, updated_at: '2026-09-02T00:00:00Z', snippet: 'x' }], facets: { projects: [], types: [] } };
const FILES = { items: [{ id: '-work-alpha/memory/note.md', name: 'note.md', project: '-work-alpha', size: 1234, mtime: '2026-10-01T10:00:00Z' }] };
async function boot(hash, over = {}) {
  const env = makeEnv({
    '/api/memories': (opts, url) => (String(url).includes('source=engram') ? ENGRAM : OWN), '/api/memory-files': FILES, '/api/graphify': { repos: [] }, '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false },
    '/api/projects': { projects: [], auto_discover: true, config_repos: [] }, ...over,
  });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}
const view = (env) => env.document.getElementById('view');
const anchors = (el) => tree(el).filter((e) => e.tagName === 'a');

test('memory titles are real links to their wiki page (keyboard reachable), with no inline detail view', async () => {
  const env = await boot('#/memory');
  const row = anchors(view(env)).find((a) => a.textContent === XSS);
  assert.ok(row, 'title link');
  assert.equal(row.getAttribute('href'), '#/memory/1');
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'img').length, 0);
  assert.doesNotMatch(view(env).textContent, /Select a memory to read it/);
  assert.equal(env.calls.some((c) => String(c.url).startsWith('/api/memory?')), false, 'the old detail endpoint is not used by the page');
  assert.match(view(env).textContent, /2026-10-01 10:00/);
});

test('Engram rows link with their source, and the wiki page asks for that source', async () => {
  const env = await boot('#/memory');
  tree(view(env)).find((e) => e.tagName === 'button' && e.textContent.startsWith('Engram')).click();
  await tick();
  const row = anchors(view(env)).find((a) => a.textContent === 'Engram one');
  assert.equal(row.getAttribute('href'), '#/memory/5?source=engram');
  const page = { kind: 'memory', id: '5', title: 'Engram one', body_md: 'b', meta: [], links: [{ kind: 'memory', id: '9', title: 'Other', source: 'engram' }], backlinks: [], sections: [], missing: [] };
  const e2 = await boot('#/memory/5?source=engram', { '/api/wiki/page': page });
  assert.ok(e2.calls.some((c) => c.url === '/api/wiki/page?kind=memory&id=5&source=engram'), e2.calls.map((c) => c.url).join(' '));
  assert.ok(anchors(view(e2)).some((a) => a.getAttribute('href') === '#/memory/9?source=engram'));
});

test('file memories link to the memfile wiki page and that page renders the file as prose', async () => {
  const env = await boot('#/memory');
  const row = anchors(view(env)).find((a) => a.textContent === 'note.md');
  assert.equal(row.getAttribute('href'), '#/memfile/-work-alpha%2Fmemory%2Fnote.md');
  const page = { kind: 'memfile', id: '-work-alpha/memory/note.md', title: 'note.md', body_md: `Hello\n\n${XSS}\n`, meta: [{ label: 'Size', value: '1234', fmt: 'number' }], links: [], backlinks: [], sections: [], missing: [] };
  const e2 = await boot('#/memfile/-work-alpha%2Fmemory%2Fnote.md', { '/api/wiki/page': page });
  assert.ok(e2.calls.some((c) => c.url === '/api/wiki/page?kind=memfile&id=-work-alpha%2Fmemory%2Fnote.md'));
  assert.match(view(e2).textContent, /Memory file/);
  assert.match(view(e2).textContent, /1,234/);
  assert.equal(tree(view(e2)).filter((e) => e.tagName === 'img').length, 0);
});

test('#/memfile without an id shows the memory list', async () => {
  const env = await boot('#/memfile');
  assert.match(view(env).textContent, /Claude file memories/);
});
