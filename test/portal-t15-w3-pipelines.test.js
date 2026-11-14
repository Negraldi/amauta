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
