// T15 W3 group 2 (class 3): English leftovers and server-built strings are translated or mapped; copy leaves internals out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';
import { boot, page, text, tree, view, tick, ES } from './helpers/t15w3.js';

const HOME = { activity: [], spending: { available: false }, health: { installed: false } };
async function search(groups, extra = {}) {
  const env = makeEnv({ '/api/wiki/home': HOME, '/api/pipelines': { projects: [] }, '/api/wiki/search': { groups } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  const input = env.document.getElementById('palette-input');
  input.value = 'x';
  for (const fn of input.listeners.input ?? []) fn({ target: input });
  await tick(400);
  return env.document.getElementById('palette-results');
}

test('D11: palette snippets are translated, task states are words and backticks become code', async () => {
  const groups = [{ kind: 'skill', items: [{ kind: 'skill', id: 'impeccable', title: 'impeccable', snippet: '3 calls' }] },
    { kind: 'feature', items: [{ kind: 'feature', id: 'r/portal-wiki', title: 'Fix `parseHash` now', snippet: 'portal-wiki, done' }] }];
  const results = await search(groups, ES);
  assert.doesNotMatch(results.textContent, /3 calls|, done|`/);
  assert.match(results.textContent, /3 llamadas/);
  assert.match(results.textContent, /portal-wiki, hecha/);
  assert.ok(tree(results).some((e) => e.tagName === 'code' && e.textContent === 'parseHash'));
});

test('B6: "and N more" at the end of a server list is translated whatever the sentence before it', async () => {
  const env = await boot('#/', { '/api/wiki/home': HOME, '/api/pipelines': { projects: [] } }, ES);
  const ts = env.__ctx.AmautaI18n.ts;
  assert.equal(ts('Links to missing pages: [[a]], [[b]] and 5 more'), 'Enlaces a páginas inexistentes: [[a]], [[b]] y 5 más');
  assert.equal(ts('2 of 9 checked tasks have no commit hash in their evidence: T1, T2 and 7 more'), '2 de 9 tareas marcadas no tienen hash de commit en su evidencia: T1, T2 y 7 más');
  assert.equal(ts('Links to missing pages: [[a]]'), 'Enlaces a páginas inexistentes: [[a]]');
});

const NOTE = '## What it does\nRuns things.\n\n## When Claude uses it\nAlways.\n\n## Worth knowing\nCareful.\n\n_Based on: /x/y.md_\n';
const hook = (lang) => boot('#/hook/x', { '/api/wiki/page': page('hook', { explain: { note: { body_md: NOTE, written_at: '2026-11-01T10:00:00Z', stale: false }, pending: null },
  summary: { description: 'd', when: 'w', source: 'Your Claude home', path: null, builtin: false, note: null } }) }, lang);
test('C6: the explanation note headings are in the UI language and do not repeat the portal\'s own', async () => {
  const es = await hook(ES);
  const heads = tree(view(es)).filter((e) => /^h[1-4]$/.test(e.tagName)).map((e) => e.textContent);
  assert.ok(heads.includes('Conviene saber'), heads.join('|'));
  assert.ok(!heads.includes('What it does') && !heads.includes('Worth knowing'), heads.join('|'));
  assert.equal(heads.filter((x) => x === 'Qué hace').length, 1, heads.join('|'));
  assert.match(text(es), /Basado en: \/x\/y\.md/);
  const en = await hook({});
  const enHeads = tree(view(en)).filter((e) => /^h[1-4]$/.test(e.tagName)).map((e) => e.textContent);
  assert.equal(enHeads.filter((x) => x === 'What it does').length, 1, enHeads.join('|'));
});

const PROJECTS = { auto_discover: true, config_repos: [], folders: [], projects: ['flag', 'discovered', 'config', 'discovered', 'discovered'].map((o, i) => ({ name: `p${i}`, path: `/h/p${i}`, origin: [o],
  odd: { features: 0, done: 0, total: 0, percent: 0 }, sessions: 1, last: '2026-11-09T20:00:00Z', memories: 0, graph: { mirrored: false } })) };
test('A6: the found-by column uses short labels and the explanation appears once', async () => {
  const env = await boot('#/project', { '/api/projects': PROJECTS });
  const t = text(env);
  assert.doesNotMatch(t, /--repo/);
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'td' && e.textContent === 'Your sessions').length, 3);
  assert.equal(t.split('found in the folders your sessions ran in').length - 1, 1, 'the legend is said once');
});

test('C12: a long description is cut at a sentence or a word, never in the middle of one', async () => {
  const sentence = 'Loads the design context and applies the shared rules to every screen. ';
  const long = sentence.repeat(2) + 'Then it keeps going with a sentence that is far too long to fit into the catalog row at all, and goes on and on about details nobody asked for here.';
  const row = { kind: 'skill', id: 'x', title: 'x', description: long, source: 'Your skills', uses: 0 };
  const env = await boot('#/component', { '/api/harness/components': { total: 1, pending: 0, groups: [{ kind: 'hook', label: 'Hooks', items: [{ ...row, kind: 'hook' }] }] }, '/api/skills': { groups: [] } });
  const cell = tree(view(env)).find((e) => e.tagName === 'div' && /Loads the design context/.test(e.textContent) && e.children.length === 1);
  assert.ok(cell, text(env));
  assert.ok(/[.…]$/.test(cell.textContent), cell.textContent);
  assert.ok(!/ [a-z]*\.\.\.$/.test(cell.textContent));
});
test('C12: the Spanish diagram label says manejadores, like the diagram itself', async () => {
  const { readDicts } = await import('./helpers/portalboot.js');
  const d = await readDicts();
  assert.doesNotMatch(d.es['harness.installArch'], /handlers/);
});

test('E7: Settings help names the real page (Harness wiki / Overview)', async () => {
  const { readDicts } = await import('./helpers/portalboot.js');
  const d = await readDicts();
  for (const l of ['en', 'es']) assert.doesNotMatch(d[l]['set.mod.archify.help'], /P(ági|ag)na Harness|Harness page/);
});
