// Critique P3 (T11 i): the Activity pages show imported usage data; a "Data as of" line under the Refresh control says how
// fresh it is from timestamps the API returns (newest message, session or tool use). No polling. Other pages clear it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const T = (x) => ({ messages: 1, sessions: 1, input: 1, output: 1, cache_read: 0, cache_write: 0, ...x });
const ROUTES = {
  '/api/overview': { available: true, totals: T({ latest: '2026-11-09T21:10:00Z' }), cache_hit_ratio: 0, daily: [], models: [], runtimes: [], events: 0 },
  '/api/costs': { enabled: false, models: [] },
  '/api/sessions': { available: true, projects: [], sessions: [T({ session_id: 'a', last_ts: '2026-11-08T10:00:00Z' }), T({ session_id: 'b', last_ts: '2026-11-10T08:00:00Z' })] },
  '/api/tools': { available: true, tools: [{ name: 'Bash', count: 1, sessions: 1, last_used: '2026-11-07T09:00:00Z' }], skills: [{ name: 's', count: 1, sessions: 1, last_used: '2026-11-11T09:00:00Z' }],
    subagents: [], mcp_servers: [], mcp_tools: [] },
  '/api/memories': { available: true, items: [], types: [] },
};

async function dataAt(hash) {
  const env = makeEnv(ROUTES);
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env.document.getElementById('data-at').textContent;
}

test('Usage, Sessions and Tools say how fresh their data is', async () => {
  assert.match(await dataAt('#/usage'), /^Data as of 2026-11-09 \d\d:\d\d; Refresh imports newer activity\.$/);
  assert.match(await dataAt('#/session'), /2026-11-10/);
  assert.match(await dataAt('#/tool'), /2026-11-11/);
});

test('pages without imported data show no line', async () => {
  assert.equal(await dataAt('#/memory'), '');
});

test('the line sits in the filter bar, under the Refresh control, and is not a live region', async () => {
  const html = await readFile(path.join(STATIC, 'index.html'), 'utf8');
  const bar = html.slice(html.indexOf('id="filters"'), html.indexOf('<div id="toasts"')); // the bar holds the folded filters too (T13)
  assert.match(bar, /<p id="data-at" class="data-at muted"><\/p>/);
  assert.doesNotMatch(bar, /data-at[^>]*aria-live/);
});
