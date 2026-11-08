// The Pipelines tab (plan S1b, ADR 0010): cards per project, a confirmation before a run, the live console fed by
// polling the run's events, step statuses with a mark (not color alone), cancel; untrusted projects cannot run.
// Plan S1b': filters, one step, history, the schedule's state, a timer, a notice at the end, a console that finds errors.
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
      types: ['python', 'command'], typical: 75, schedule: { at: '07:30', days: ['mon'] }, schedule_state: 'missed',
      last: { status: 'failed', started: '2026-11-08T10:00:00+00:00', seconds: 1.6, trigger: 'schedule', run: 'weekly-1.jsonl' },
      history: [
        { run: 'weekly-1.jsonl', status: 'failed', started: '2026-11-08T10:00:00+00:00', seconds: 1.6, trigger: 'schedule', failure: 'connection lost',
          steps: [{ name: 'Extract', status: 'ok', seconds: 1.2 }, { name: 'Report', status: 'failed', seconds: 0.4 }],
          outputs: [{ path: 'out/sales.parquet', bytes: 2048, modified: '2026-11-08T10:00:01+00:00' }] },
        { run: 'weekly-0.jsonl', status: 'ok', started: '2026-11-01T10:00:00+00:00', seconds: 1.4, trigger: 'portal', failure: null, steps: [], outputs: [] }] },
    { id: 'monthly', name: 'Monthly close', description: '', category: 'Finance', steps: ['Close'], types: ['r'], typical: null,
      schedule: { at: '06:00', day_of_month: 1 }, schedule_state: 'never', last: null, history: [] }] },
  { name: 'other', path: '/work/other', trusted: false, error: null, pipelines: [{ id: 'p', name: 'P', description: '', steps: ['S'], last: null }] },
] };
const EVENTS = [
  { kind: 'run-start', pipeline: 'weekly', steps: ['Extract', 'Report'] },
  { kind: 'step-start', step: 0, name: 'Extract' }, { kind: 'line', step: 0, name: 'Extract', text: XSS },
  { kind: 'step-end', step: 0, name: 'Extract', status: 'ok', seconds: 1.2 },
  { kind: 'step-start', step: 1, name: 'Report' }, { kind: 'line', step: 1, name: 'Report', text: 'wrote out/report.xlsx' },
  { kind: 'line', step: 1, name: 'Report', text: 'Traceback (most recent call last): boom' },
  { kind: 'step-end', step: 1, name: 'Report', status: 'failed', seconds: 0.4 }, { kind: 'run-end', status: 'failed', seconds: 1.6 },
];

async function boot(setup = () => {}) {
  const copied = [];
  const posts = [];
  const polls = [];
  const polled = [];
  const env = makeEnv({
    '/api/pipelines/check': async (opts, url) => ({ findings: new URL(url, 'http://x').searchParams.get('id') === 'weekly'
      ? [{ pipeline: 'weekly', step: 'Report', level: 'error', message: 'etl/report.py does not exist' }] : [] }),
    '/api/wiki/home': { activity: [], spending: { available: false }, impact: null, health: { installed: false } },
    '/api/pipelines': LIST, '/api/wiki/recent': { items: [] }, '/api/sessions': { projects: [] }, '/api/projects': { projects: [], auto_discover: true, config_repos: [] },
    '/api/pipelines/run': async (opts) => { posts.push({ path: 'run', headers: opts.headers, body: JSON.parse(opts.body) }); return { run: 'weekly-2.jsonl' }; },
    '/api/pipelines/cancel': async (opts) => { posts.push({ path: 'cancel', body: JSON.parse(opts.body) }); return { ok: true }; },
    '/api/pipelines/events': async (opts, url) => {
      const after = Number(new URL(url, 'http://x').searchParams.get('after'));
      polls.push(after);
      polled.push(new URL(url, 'http://x').searchParams.get('run'));
      const upto = after === 0 ? 3 : EVENTS.length; // the run arrives in two polls
      return { events: EVENTS.slice(after, upto), done: upto === EVENTS.length };
    },
  });
  env.location.hash = '#/pipelines';
  setup(env);
  const navigator = { clipboard: { writeText: async (text) => { copied.push(text); } } };
  await runPortal(env, { DOMParser: class {}, queueMicrotask, navigator });
  await tick();
  return { env, posts, polls, polled, copied, view: env.document.getElementById('view') };
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

test('a summary line counts what needs attention', async () => {
  const { view } = await boot();
  const summary = tree(view).find((e) => e.className === 'pipe-summary');
  assert.match(summary.textContent, /3 pipelines/);
  assert.match(summary.textContent, /1 failed last time/);
  assert.match(summary.textContent, /1 missed a scheduled run/);
});

test('history marks, the first failure, step types and durations, outputs and the schedule state are on the card', async () => {
  const { view, polled } = await boot();
  const [weekly, monthly] = cards(view);
  const hist = tree(weekly).find((e) => e.tagName === 'ol' && e.attrs['aria-label'] === 'Recent runs');
  const marks = tree(hist).filter((e) => e.tagName === 'button');
  assert.equal(marks.length, 2);
  assert.match(marks[1].attrs['aria-label'], /failed/, 'newest on the right');
  assert.match(weekly.textContent, /connection lost/);
  assert.match(weekly.textContent, /Python/);
  assert.match(weekly.textContent, /1\.2 s/);
  const flow = tree(weekly).filter((e) => e.tagName === 'li' && e.attrs['data-status']);
  assert.deepEqual(flow.map((e) => e.attrs['data-status']), ['ok', 'failed'], 'the flow row starts from the last run');
  assert.match(weekly.textContent, /out\/sales\.parquet/);
  assert.match(weekly.textContent, /Mondays at 07:30/);
  assert.match(weekly.textContent, /did not happen/);
  assert.match(monthly.textContent, /day 1 of each month at 06:00/);
  assert.ok(tree(monthly).some((e) => e.tagName === 'code' && e.textContent === 'amauta pipeline schedule-hint monthly'));
  marks[0].click();
  await tick(60);
  assert.equal(polled.at(-1), 'weekly-0.jsonl', 'a mark opens that run in the console');
});

test('a running pipeline shows its time against the usual one; the end leaves a notice and marks the tab title', async () => {
  const { view, env } = await boot((e) => { e.document.hidden = true; });
  buttons(view, 'Run')[0].click();
  buttons(view, 'Run now')[0].click();
  await tick(80);
  assert.match(cards(view)[0].textContent, /usually about 1:15/);
  await tick(1800);
  const toast = tree(env.document.getElementById('toasts')).find((e) => e.className?.startsWith('toast '));
  assert.ok(toast, 'a notice');
  assert.match(toast.textContent, /Weekly sales/);
  assert.match(toast.textContent, /failed/);
  assert.match(env.document.title, /^✗ /);
});

test('the console marks error lines, jumps to the first one and filters by step', async () => {
  const { view } = await boot();
  buttons(view, 'Run')[0].click();
  buttons(view, 'Run now')[0].click();
  await tick(1800);
  const pre = tree(view).find((e) => e.tagName === 'pre');
  const lines = tree(pre).filter((e) => e.tagName === 'span');
  const errors = lines.filter((e) => e.attrs['data-level'] === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].textContent, /Traceback/);
  buttons(view, 'First error')[0].click();
  assert.ok(errors[0].focused || errors[0].scrolled, 'brought into view');
  const filter = tree(view).find((e) => e.tagName === 'select' && e.attrs['aria-label'] === 'Show lines of');
  filter.value = '0';
  filter.listeners.change[0]({ target: filter });
  assert.deepEqual(lines.filter((e) => !e.hidden).map((e) => e.attrs['data-step']), ['0']);
});

test('check reports what would stop a run, without running it', async () => {
  const { view, posts } = await boot();
  buttons(view, 'Check')[0].click();
  await tick(40);
  assert.match(cards(view)[0].textContent, /etl\/report\.py does not exist/);
  buttons(view, 'Check')[1].click();
  await tick(40);
  assert.match(cards(view)[1].textContent, /Nothing would stop a run/);
  assert.equal(posts.length, 0);
});

test('the home page carries the same summary, linked to the tab', async () => {
  const { view } = await boot((env) => { env.location.hash = '#/'; });
  const rail = tree(view).find((e) => e.tagName === 'aside');
  assert.match(rail.textContent, /3 pipelines · 1 failed last time/);
  assert.ok(tree(rail).some((e) => e.tagName === 'a' && e.attrs.href === '#/pipelines'));
});
