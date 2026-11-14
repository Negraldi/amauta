// T19e: the Catalog (#/component) filters by runtime (?runtime=claude|codex, a segmented control that keeps its state in the hash
// next to ?kind=), and the instruction blocks amauta writes to CLAUDE.md and AGENTS.md are a catalog kind of their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { boot, tree, view, text, ES } from './helpers/t15w3.js';
import { STATIC, readDicts } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const ctx = {};
vm.runInNewContext(await read('wikiroute.js'), ctx);
const R = ctx.AmautaRoute;
const plain = (x) => JSON.parse(JSON.stringify(x));
const { en: EN, es: ES_DICT } = await readDicts();
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));
const navs = (env) => tree(view(env)).filter((e) => e.tagName === 'nav' && /segmented/.test(e.getAttribute('class') || e.className || ''));
const links = (nav) => tree(nav).filter((e) => e.tagName === 'a');
const item = (kind, id, runtimes, over = {}) => ({ kind, id, title: id, description: `About ${id}`, source: 'Your Claude home', uses: 0, ...(runtimes ? { runtimes } : {}), ...over });
const COMPS = { total: 5, pending: 0, refresh: { servers: 0 }, groups: [
  { kind: 'hook', label: 'Hooks', items: [item('hook', 'claude-hook', ['claude']), item('hook', 'codex-hook', ['codex']), item('hook', 'both-hook', ['claude', 'codex'])] },
  { kind: 'agent', label: 'Agents', items: [item('agent', 'an-agent', ['claude']), item('agent', 'old-agent', null)] }] };
const SKILLS = { total: 1, groups: [{ source: 'x', label: 'Your Codex skills', items: [{ id: 'cx-skill', description: 'Codex skill', uses: 0, runtimes: ['codex'] }] }] };
const ROUTES = { '/api/harness/components': COMPS, '/api/skills': SKILLS };
const ids = (env) => hrefs(view(env)).filter((h) => /^#\/(hook|agent|skill)\//.test(h)).map((h) => h.split('/')[2]);

// ---- runtime filter ----
test('T19e: the route keeps ?runtime= (claude or codex) next to ?kind=, and drops anything else', () => {
  assert.deepEqual(plain(R.parseHash('#/component?runtime=codex')), { kind: 'component', id: '', query: { runtime: 'codex' } });
  assert.deepEqual(plain(R.parseHash('#/component?kind=hook&runtime=claude')), { kind: 'component', id: '', query: { kind: 'hook', runtime: 'claude' } });
  assert.deepEqual(plain(R.parseHash('#/component?runtime=nope')), { kind: 'component', id: '' });
  assert.equal(R.routeHash({ kind: 'component', id: '', query: { runtime: 'codex', kind: 'hook' } }), '#/component?kind=hook&runtime=codex');
});

test('T19e: the Catalog has a Runtime segmented control (All, Claude Code, Codex) that keeps the kind in each link', async () => {
  const env = await boot('#/component?kind=hook', ROUTES);
  const nav = navs(env).find((n) => n.getAttribute('aria-label') === 'Runtime');
  assert.ok(nav, 'a segmented control named Runtime');
  assert.deepEqual(links(nav).map((a) => a.textContent), ['All', 'Claude Code', 'Codex']);
  assert.deepEqual(links(nav).map((a) => a.getAttribute('href')), ['#/component?kind=hook', '#/component?kind=hook&runtime=claude', '#/component?kind=hook&runtime=codex']);
  assert.deepEqual(links(nav).filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.textContent), ['All']);
});

test('T19e: Codex keeps what applies to Codex, an entry for both runtimes shows under either, and the kind counts follow the filter', async () => {
  const codex = await boot('#/component?runtime=codex', ROUTES);
  assert.deepEqual(ids(codex).sort(), ['both-hook', 'codex-hook', 'cx-skill']);
  const kinds = navs(codex).find((n) => n.getAttribute('aria-label') === 'Component kinds');
  assert.deepEqual(links(kinds).map((a) => a.textContent), ['All (3)', 'Skills (1)', 'Hooks (2)', 'Agents (0)']);
  assert.deepEqual(links(kinds).map((a) => a.getAttribute('href')), ['#/component?runtime=codex', '#/component?kind=skill&runtime=codex',
    '#/component?kind=hook&runtime=codex', '#/component?kind=agent&runtime=codex']);
  const rt = navs(codex).find((n) => n.getAttribute('aria-label') === 'Runtime');
  assert.deepEqual(links(rt).filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.textContent), ['Codex']);
  const claude = await boot('#/component?runtime=claude', ROUTES);
  assert.deepEqual(ids(claude).sort(), ['an-agent', 'both-hook', 'claude-hook', 'old-agent'], 'an entry without runtimes counts as Claude Code');
  assert.equal(ids(await boot('#/component', ROUTES)).length, 6, 'no filter lists everything');
});

test('T19e: an empty kind under a runtime says no component of that kind applies to it', async () => {
  const env = await boot('#/component?kind=agent&runtime=codex', ROUTES);
  assert.match(text(env), /No component of this kind applies to Codex\./);
  assert.deepEqual(ids(env), []);
  const es = await boot('#/component?kind=agent&runtime=codex', ROUTES, ES);
  assert.match(text(es), /Ningún componente de este tipo se aplica a Codex\./);
});

test('T19e: the Spanish control reads Todos, Claude Code, Codex', async () => {
  const env = await boot('#/component', ROUTES, ES);
  const nav = navs(env).find((n) => n.getAttribute('aria-label') === 'Entorno');
  assert.deepEqual(links(nav).map((a) => a.textContent), ['Todos', 'Claude Code', 'Codex']);
});

test('T19e: the runtime strings exist in both languages', () => {
  for (const key of ['catalog.runtimes', 'catalog.runtimeAll', 'catalog.noRuntimeKind', 'catalog.noRuntime']) {
    assert.ok(EN[key] && ES_DICT[key], key);
  }
  assert.doesNotMatch(ES_DICT['catalog.noRuntimeKind'], /—/);
});
