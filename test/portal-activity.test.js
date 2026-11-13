// Activity pages (portal redesign T5): spending sentence and chart, sessions, tools and skills, filter state in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const view = (env) => env.document.getElementById('view');
const read = (f) => readFile(path.join(STATIC, f), 'utf8');

const DAILY = [{ day: '2026-10-01', messages: 1, sessions: 1, input: 100, output: 50, cache_read: 800, cache_write: 100 },
  { day: '2026-10-04', messages: 2, sessions: 2, input: 60, output: 35, cache_read: 100, cache_write: 50 }];
const OVERVIEW = { available: true, totals: { messages: 3, sessions: 2, input: 160, output: 85, cache_read: 900, cache_write: 150 }, cache_hit_ratio: 0.5,
  events: 4, dropped_events: 0, daily: DAILY, models: [{ model: 'm', messages: 3, input: 160, output: 85, cache_read: 900, cache_write: 150 }] };
const SESSIONS = { available: true, sessions: [{ session_id: 'abcdef123456', runtime: 'claude', project: 'alpha', last_ts: '2026-10-01T10:00:00Z', model: 'm', messages: 1, input: 1, output: 1, cache_read: 0, cache_write: 0 }],
  projects: [{ project: 'alpha', sessions: 1, messages: 1, input: 1, output: 1, cache_read: 0, cache_write: 0 }] };
const TOOLS = { available: true, tools: [{ name: 'Bash', count: 2, sessions: 1, last_used: 'x' }], skills: [{ name: 'work-unit-commits', count: 1, sessions: 1, last_used: 'x' }],
  subagents: [], mcp_servers: [], mcp_tools: [] };
async function boot(hash, over = {}, extra = {}) {
  const env = makeEnv({ '/api/overview': OVERVIEW, '/api/costs': { enabled: false, models: [] }, '/api/sessions': SESSIONS, '/api/tools': TOOLS,
    '/api/memories': { available: true, items: [], facets: { types: [] } }, ...over });
  env.location.hash = hash;
  if (extra.language) env.navigator = { language: extra.language, languages: [extra.language] };
  await runPortal(env, { DOMParser: class {}, queueMicrotask, ...(extra.language ? { navigator: env.navigator } : {}) });
  await tick();
  return env;
}
const rectKinds = (env) => [...new Set(tree(view(env)).filter((e) => e.tagName === 'rect').map((e) => e.getAttribute('class')))].sort();

test('Usage leads with one plain sentence about what was spent in the filtered range', async () => {
  const env = await boot('#/usage');
  const lead = tree(view(env)).find((e) => e.tagName === 'p' && e.className === 'lead');
  assert.equal(lead.textContent, 'You spent 160 input and 85 output tokens in 3 messages across 2 sessions; the cache served 50.0% of the input.');
  const cost = await boot('#/usage', { '/api/costs': { enabled: true, label: 'Estimate', models: [{ model: 'm', cost: 1.5 }], total: 1.5 } });
  assert.match(tree(view(cost)).find((e) => e.className === 'lead').textContent, /Estimated cost: 1\.50\.$/);
});

// T8 final polish (3): the filter bar is the one statement of the filters; the page head no longer repeats it in words.
test('the Activity routes show the filter bar and the page head does not repeat it', async () => {
  for (const hash of ['#/usage', '#/session', '#/tool']) {
    const env = await boot(hash);
    assert.equal(env.document.getElementById('filters').hidden, false, hash);
    assert.doesNotMatch(tree(view(env)).find((e) => e.className === 'page-head').textContent, /all projects/, hash);
  }
  const mem = await boot('#/memory');
  assert.equal(mem.document.getElementById('filters').hidden, true);
});

test('the chart shows input and output by default; cache read and write sit behind a visible Include cache toggle', async () => {
  const env = await boot('#/usage');
  assert.deepEqual(rectKinds(env), ['f-input', 'f-output']);
  const box = tree(view(env)).find((e) => e.tagName === 'input' && e.attrs.type === 'checkbox');
  assert.ok(box, 'a checkbox');
  const label = tree(view(env)).find((e) => e.tagName === 'label' && e.children.includes(box));
  assert.match(label.textContent, /Include cache/);
  const legend = () => tree(view(env)).find((e) => e.className === 'legend').textContent;
  assert.doesNotMatch(legend(), /Cache/i);
  box.checked = true;
  for (const fn of box.listeners.change) fn({ target: box });
  assert.deepEqual(rectKinds(env), ['f-cache_read', 'f-cache_write', 'f-input', 'f-output']);
  assert.match(legend(), /Cache read/);
});

test('the date axis is continuous (empty days included) and every day is readable in a collapsible table', async () => {
  const env = await boot('#/usage');
  const details = tree(view(env)).find((e) => e.tagName === 'details');
  assert.ok(details, 'a details block');
  assert.match(details.children[0].tagName, /summary/);
  const days = tree(details).filter((e) => e.tagName === 'tr').slice(1).map((r) => r.children[0].textContent);
  assert.deepEqual(days, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'g' && e.attrs['data-day']).length, 4, 'one column per day, empty ones too');
});

test('axis labels are HTML text, not SVG text, so they keep their size when the chart shrinks on a phone', async () => {
  const env = await boot('#/usage');
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'text').length, 0);
  const x = tree(view(env)).find((e) => e.className === 'chart-x');
  assert.match(x.textContent, /2026-10-01.*2026-10-04/);
  const css = (await read('style.css')) + (await read('style-pages.css'));
  assert.match(css, /\.chart-x \{[^}]*font-size: 0\.75rem/);
  assert.match(css, /\.chart-y \{[^}]*font-size: 0\.75rem/);
  assert.doesNotMatch(css.match(/\.f-input[^}]*\}/)[0], /--accent/);
});

test('Sessions use the shared session columns and no longer carry a projects table that sets the filter', async () => {
  const env = await boot('#/session');
  assert.equal(tree(view(env)).filter((e) => e.attrs['data-row']).length, 0, 'no row button that silently filters');
  assert.equal(tree(view(env)).filter((e) => e.tagName === 'table').length, 1);
  const src = await read('page-activity.js');
  assert.match(src, /sessionColumns\(\)/);
  assert.doesNotMatch(src, /cache_write", t\("tok\.cache_write"\)/, 'no second copy of the session columns');
});

test('Tools and skills: the title matches the tab and the segments are links with aria-current, state in ?seg=', async () => {
  const env = await boot('#/tool?seg=skills');
  assert.equal(tree(view(env)).find((e) => e.tagName === 'h1').textContent, 'Tools and skills');
  const seg = tree(view(env)).find((e) => e.tagName === 'nav' && e.className === 'segmented');
  const links = tree(seg).filter((e) => e.tagName === 'a');
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['#/tool?seg=skills', '#/tool?seg=tools', '#/tool?seg=mcp', '#/tool?seg=mcptools', '#/tool?seg=subagents']);
  assert.deepEqual(links.filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.textContent), ['Skills (1 used)']);
  const es = JSON.parse(await read('i18n/es.json'));
  assert.equal(es['nav.toolsSkills'], 'Herramientas y skills');
});
