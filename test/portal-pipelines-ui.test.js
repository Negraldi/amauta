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
    { id: 'weekly', name: 'Weekly sales', description: 'Refresh and report', category: 'Sales', steps: ['Extract', 'Report'],
      last: { status: 'ok', started: '2026-11-08T10:00:00+00:00', seconds: 1.6, trigger: 'schedule', run: 'weekly-1.jsonl' } },
    { id: 'monthly', name: 'Monthly close', description: '', category: 'Finance', steps: ['Close'], last: null }] },
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
  const copied = [];
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
  const navigator = { clipboard: { writeText: async (text) => { copied.push(text); } } };
  await runPortal(env, { DOMParser: class {}, queueMicrotask, navigator });
  await tick();
  return { env, posts, polls, copied, view: env.document.getElementById('view') };
}
const buttons = (view, label) => tree(view).filter((e) => e.tagName === 'button' && e.textContent === label);

test('cards per project; an untrusted project cannot run and says how to trust it', async () => {
  const { view } = await boot();
  const text = view.textContent;
  for (const needle of ['repo', 'Weekly sales', 'Extract', 'Report', 'other']) assert.ok(text.includes(needle), needle);
  const runs = buttons(view, 'Run');
  assert.equal(runs.length, 3);
  assert.equal(runs[2].getAttribute('disabled'), '', 'untrusted: disabled');
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

const cards = (view) => tree(view).filter((e) => e.tagName === 'article');
const shown = (view) => cards(view).filter((c) => !c.hidden).map((c) => tree(c).find((e) => e.tagName === 'h3').textContent);

test('category pills with counts and a search narrow the cards', async () => {
  const { view } = await boot();
  const pills = tree(view).filter((e) => e.tagName === 'button' && e.attrs['aria-pressed']);
  assert.deepEqual(pills.map((b) => b.textContent), ['All (3)', 'Finance (1)', 'Sales (1)']);
  assert.equal(pills[0].attrs['aria-pressed'], 'true');
  pills[1].click();
  assert.deepEqual(shown(view), ['Monthly close']);
  assert.equal(pills[1].attrs['aria-pressed'], 'true');
  pills[0].click();
  const search = tree(view).find((e) => e.tagName === 'input' && e.attrs.type === 'search');
  search.value = 'report'; // a step name matches too
  search.listeners.input[0]({ target: search });
  assert.deepEqual(shown(view), ['Weekly sales']);
});

test('the last run says how long it took and what started it; a card shows its category', async () => {
  const { view } = await boot();
  const weekly = cards(view)[0];
  assert.match(weekly.textContent, /1\.6 s/);
  assert.match(weekly.textContent, /scheduled/);
  assert.match(weekly.textContent, /Sales/);
});

test('one step runs alone after its own confirmation', async () => {
  const { view, posts } = await boot();
  const only = buttons(view, 'Only this');
  assert.equal(only.length, 4, 'one per step');
  assert.equal(only[3].getAttribute('disabled'), '', 'untrusted: disabled');
  assert.match(only[1].attrs['aria-label'], /Report/);
  only[1].click();
  assert.equal(posts.length, 0);
  assert.match(view.textContent, /only step 2/i);
  buttons(view, 'Run now')[0].click();
  await tick(40);
  assert.deepEqual(posts[0].body, { project: '/work/repo', id: 'weekly', step: 2 });
});

test('the console can be copied and cleared', async () => {
  const { view, copied } = await boot();
  buttons(view, 'Run')[0].click();
  buttons(view, 'Run now')[0].click();
  await tick(1800);
  buttons(view, 'Copy')[0].click();
  await tick(10);
  assert.match(copied[0], /\[Report\] wrote out\/report.xlsx/);
  buttons(view, 'Clear')[0].click();
  assert.equal(tree(view).find((e) => e.tagName === 'pre').textContent, '');
});
