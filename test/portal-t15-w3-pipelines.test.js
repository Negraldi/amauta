// T15 W3 (D16, A13): the pipelines page speaks the UI language and leaves internals out of its copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, text, tree, view, ES } from './helpers/t15w3.js';

const pipe = (over = {}) => ({ id: 'p1', name: 'Match', description: '', category: 'Sales', steps: ['Extract', 'Preview the match grouping'], types: ['python', 'python'], typical: null,
  modes: ['process', 'preview'], default_mode: 'process', schedules: [{ at: '07:30', days: ['mon'], state: 'ok', mode: 'preview' }],
  last: { status: 'ok', started: '2026-11-08T10:00:00+00:00', seconds: 1.6, trigger: 'schedule', run: 'p1-1.jsonl' }, history: [], ...over });
const LIST = (p = pipe()) => ({ available: true, projects: [{ name: 'repo', path: '/work/repo', trusted: true, error: null, pipelines: [p] }] });
const routes = (p) => ({ '/api/pipelines': LIST(p), '/api/wiki/home': { activity: [], spending: { available: false }, impact: null, health: { installed: false } }, '/api/pipelines/check': { findings: [] } });

test('D16: mode names are words, in the select and in the schedule line', async () => {
  const env = await boot('#/pipelines', routes(), ES);
  const options = tree(view(env)).filter((e) => e.tagName === 'option').map((o) => o.textContent);
  assert.ok(options.includes('Proceso') && options.includes('Vista previa'), options.join('|'));
  assert.doesNotMatch(text(env), /\bprocess\b|\bpreview\b/);
});
test('D16: an unknown mode name is shown as the user wrote it', async () => {
  const env = await boot('#/pipelines', routes(pipe({ modes: ['nightly'], default_mode: 'nightly', schedules: [] })), ES);
  assert.ok(tree(view(env)).some((e) => e.tagName === 'option' && e.textContent === 'nightly'));
});

const links = (el) => tree(el).filter((e) => e.tagName === 'a').map((a) => a.getAttribute('href'));
test('A13: the pipelines page leaves file names out of its copy and links the guide instead', async () => {
  const env = await boot('#/pipelines', { '/api/pipelines': { available: true, projects: [] } }, ES);
  assert.doesNotMatch(text(env), /pipelines\.json|docs\/pipelines\.md/);
  assert.ok(links(view(env)).includes('#/guide/pipelines'), links(view(env)).join(' '));
});
test('A13: a project without pipelines has no orphan "All pipelines" link and no file names', async () => {
  const env = await boot('#/project/repo?tab=pipelines', { '/api/pipelines': { available: true, projects: [{ name: 'repo', path: '/r', trusted: true, pipelines: [] }] },
    '/api/wiki/page': { kind: 'project', id: 'repo', title: 'repo', body_md: null, meta: [{ label: 'Path', value: '/r' }], links: [], backlinks: [], sections: [] } });
  assert.doesNotMatch(text(env), /pipelines\.json|docs\/pipelines\.md/);
  assert.ok(!links(view(env)).includes('#/pipelines'), links(view(env)).join(' '));
});
test('A13: the memory copy does not name the tool an agent calls', async () => {
  const env = await boot('#/memory', { '/api/memories': { source: 'own', available: true, items: [], facets: { projects: [], types: [] } } });
  assert.doesNotMatch(text(env), /mem_save/);
});
test('A13: the run history says in words what its latest mark means', async () => {
  const env = await boot('#/pipelines', routes(pipe({ history: [{ run: 'p1-1.jsonl', status: 'ok', started: '2026-11-08T10:00:00+00:00', seconds: 1.6, trigger: 'schedule', failure: null, steps: [], outputs: [] }] })));
  assert.match(text(env), /Recent runs:? .*2026-11-08/);
});
