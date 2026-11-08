// The Pipelines tab (plan S1b, ADR 0010): cards per project, a confirmation before a run, the live console fed by
// polling the run's events, step statuses with a mark (not color alone), cancel; untrusted projects cannot run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const XSS = '<img src=x onerror=alert(1)>';

const LIST = { available: true, projects: [
  { name: 'repo', path: '/work/repo', trusted: true, error: null, pipelines: [
    { id: 'weekly', name: 'Weekly sales', description: 'Refresh and report', steps: ['Extract', 'Report'], last: { status: 'ok', started: '2026-11-08T10:00:00+00:00', run: 'weekly-1.jsonl' } }] },
  { name: 'other', path: '/work/other', trusted: false, error: null, pipelines: [{ id: 'p', name: 'P', description: '', steps: ['S'], last: null }] },
] };
const EVENTS = [
  { kind: 'run-start', pipeline: 'weekly', steps: ['Extract', 'Report'] },
  { kind: 'step-start', step: 0, name: 'Extract' }, { kind: 'line', step: 0, name: 'Extract', text: XSS },
  { kind: 'step-end', step: 0, name: 'Extract', status: 'ok', seconds: 1.2 },
  { kind: 'step-start', step: 1, name: 'Report' }, { kind: 'line', step: 1, name: 'Report', text: 'wrote out/report.xlsx' },
  { kind: 'step-end', step: 1, name: 'Report', status: 'failed', seconds: 0.4 }, { kind: 'run-end', status: 'failed', seconds: 1.6 },
];

async function boot() {
  const posts = [];
  const polls = [];
  const env = makeEnv({
    '/api/pipelines': LIST, '/api/wiki/recent': { items: [] }, '/api/sessions': { projects: [] }, '/api/projects': { projects: [], auto_discover: true, config_repos: [] },
    '/api/pipelines/run': async (opts) => { posts.push({ path: 'run', headers: opts.headers, body: JSON.parse(opts.body) }); return { run: 'weekly-2.jsonl' }; },
    '/api/pipelines/cancel': async (opts) => { posts.push({ path: 'cancel', body: JSON.parse(opts.body) }); return { ok: true }; },
    '/api/pipelines/events': async (opts, url) => {
      const after = Number(new URL(url, 'http://x').searchParams.get('after'));
      polls.push(after);
      const upto = after === 0 ? 3 : EVENTS.length; // the run arrives in two polls
      return { events: EVENTS.slice(after, upto), done: upto === EVENTS.length };
    },
  });
  env.location.hash = '#/pipelines';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return { env, posts, polls, view: env.document.getElementById('view') };
}
const buttons = (view, label) => tree(view).filter((e) => e.tagName === 'button' && e.textContent === label);

test('cards per project; an untrusted project cannot run and says how to trust it', async () => {
  const { view } = await boot();
  const text = view.textContent;
  for (const needle of ['repo', 'Weekly sales', 'Extract', 'Report', 'other']) assert.ok(text.includes(needle), needle);
  const runs = buttons(view, 'Run');
  assert.equal(runs.length, 2);
  assert.equal(runs[1].getAttribute('disabled'), '', 'untrusted: disabled');
  assert.ok(tree(view).some((e) => e.tagName === 'code' && e.textContent === 'amauta check trust'));
});

test('run asks first, posts only the project and id with the token, then streams the console until the end', async () => {
  const { view, posts, polls } = await boot();
  buttons(view, 'Run')[0].click();
  assert.equal(posts.length, 0, 'a confirmation comes first');
  assert.match(view.textContent, /with your permissions/);
  buttons(view, 'Run now')[0].click();
  await tick(1800);
  assert.deepEqual(posts[0].body, { project: '/work/repo', id: 'weekly' });
  assert.equal(posts[0].headers['X-Portal-Token'], 'TOKEN-123');
  assert.deepEqual(polls.slice(0, 2), [0, 3], 'polls continue after the events already shown');
  const consoleBox = tree(view).find((e) => e.tagName === 'pre');
  assert.ok(consoleBox.textContent.includes(`[Extract] ${XSS}`), `output is text, never markup: ${consoleBox.textContent.slice(0, 120)}`);
  assert.equal(tree(consoleBox).filter((e) => e.tagName === 'img').length, 0);
  assert.match(view.textContent, /failed/i);
  const steps = tree(view).filter((e) => e.tagName === 'li' && e.attrs['data-status']);
  assert.deepEqual(steps.slice(0, 2).map((e) => e.attrs['data-status']), ['ok', 'failed']);
  assert.match(steps[1].textContent, /✗/);
});

test('cancel posts the run to stop', async () => {
  const { view, posts } = await boot();
  buttons(view, 'Run')[0].click();
  buttons(view, 'Run now')[0].click();
  await tick(80);
  buttons(view, 'Cancel run')[0].click();
  await tick(40);
  assert.deepEqual(posts.find((p) => p.path === 'cancel').body, { project: '/work/repo', run: 'weekly-2.jsonl' });
});
