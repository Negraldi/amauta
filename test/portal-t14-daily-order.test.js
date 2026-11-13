// T14 cross-page agreement, table order: a daily table opens newest day first, and Usage > Sessions opens by last activity
// like a project's Sessions tab (a header click still re-sorts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const T = (x) => ({ messages: 1, sessions: 1, input: 1, output: 1, cache_read: 0, cache_write: 0, ...x });
const OVERVIEW = { available: true, totals: T({ latest: '2026-11-12T10:00:00Z' }), cache_hit_ratio: 0, models: [], runtimes: [], events: 0,
  daily: [T({ day: '2026-11-10', sessions: 9 }), T({ day: '2026-11-11', sessions: 2 }), T({ day: '2026-11-12', sessions: 5 })] };
const SESSIONS = { available: true, projects: [], sessions: [T({ session_id: 'old-but-big', messages: 900, last_ts: '2026-11-01T10:00:00Z' }),
  T({ session_id: 'new-small', messages: 3, last_ts: '2026-11-12T10:00:00Z' })] };

async function view(hash) {
  const env = makeEnv({ '/api/overview': OVERVIEW, '/api/costs': { enabled: false, models: [] }, '/api/sessions': SESSIONS });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env.document.getElementById('view');
}
const firstCells = (table) => tree(table).filter((e) => e.tagName === 'tr').slice(1).map((r) => r.children[0].textContent);

test('Sessions per day opens newest day first', async () => {
  const v = await view('#/usage');
  const table = tree(v).filter((e) => e.tagName === 'table' && /2026-11-1/.test(e.textContent)).pop(); // the chart's own data table comes first
  assert.deepEqual(firstCells(table), ['2026-11-12', '2026-11-11', '2026-11-10']);
});

test('Usage > Sessions opens by last activity, newest first', async () => {
  const v = await view('#/session');
  const table = tree(v).find((e) => e.tagName === 'table');
  assert.deepEqual(firstCells(table).map((s) => s.slice(0, 3)), ['new', 'old']);
});
