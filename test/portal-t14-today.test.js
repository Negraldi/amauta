// T14 cross-page agreement, Today: a feed row never joins the start date with the last-activity time. "started" carries
// the full start timestamp and the row's own time is labelled as the last activity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const HOME = { health: { installed: false }, spending: { available: false }, impact: null };
const local = (iso) => { const d = new Date(iso), p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };

async function rows(activity) {
  const env = makeEnv({ '/api/wiki/home': { ...HOME, activity }, '/api/pipelines': { projects: [] } });
  env.location.hash = '#/';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return tree(env.document.getElementById('view')).filter((e) => e.tagName === 'li' && /amauta/.test(e.textContent)).map((e) => e.textContent);
}

test('a session that began earlier shows its start date and time, and the row time is the labelled last activity', async () => {
  const start = '2026-11-09T11:26:00Z', end = '2026-11-13T20:40:00Z';
  const [row] = await rows([{ day: '2026-11-13', items: [{ kind: 'session', id: 's1', title: 'amauta · Fix', what: '12 messages', ts: end, started: start }] }]);
  const startDay = new Date(start), p = (n) => String(n).padStart(2, '0');
  const startText = `${startDay.getFullYear()}-${p(startDay.getMonth() + 1)}-${p(startDay.getDate())} ${local(start)}`;
  assert.ok(row.includes(`started ${startText}`), row);
  assert.ok(row.endsWith(`last active ${local(end)}`), row);
});

test('a session from the same day says only when it was last active', async () => {
  const end = '2026-11-13T16:00:00Z';
  const [row] = await rows([{ day: '2026-11-13', items: [{ kind: 'session', id: 's2', title: 'amauta · Same', what: '3 messages', ts: end, started: '2026-11-13T15:00:00Z' }] }]);
  assert.ok(row.endsWith(`3 messages, last active ${local(end)}`), row);
});
