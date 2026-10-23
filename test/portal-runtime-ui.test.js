import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const win = (days, input) => ({ days, input, output: 1, cache_read: 0, cache_write: 0 });
const SESSIONS = { available: true, projects: [{ project: 'amauta', sessions: 2, messages: 2, input: 1, output: 1, cache_read: 0, cache_write: 0 }],
  sessions: [
    { session_id: 'claudesess1', runtime: 'claude', project: 'amauta', first_ts: 'a', last_ts: 'b', messages: 1, input: 1, output: 1, cache_read: 0, cache_write: 0, model: 'claude-x' },
    { session_id: 'codexsess01', runtime: 'codex', project: 'amauta', first_ts: 'a', last_ts: 'c', messages: 1, input: 1, output: 1, cache_read: 0, cache_write: 0, model: 'gpt-x' }] };
const USAGE = { available: true, totals: { messages: 2, sessions: 2, input: 2, output: 2, cache_read: 0, cache_write: 0, thinking: 0 }, cache_hit_ratio: 0, events: 0, dropped_events: 0,
  daily: [], models: [],
  runtimes: [{ runtime: 'claude', messages: 1, sessions: 1, input: 1, output: 1, cache_read: 0, cache_write: 0 }, { runtime: 'codex', messages: 1, sessions: 1, input: 1, output: 1, cache_read: 0, cache_write: 0 }] };
const HOME = { activity: [], impact: null, health: { installed: false },
  spending: { available: true, windows: [win(7, 3), win(30, 3)], cache_hit_ratio: null, top_models: [],
    runtimes: [{ runtime: 'claude', windows: [win(7, 1), win(30, 1)] }, { runtime: 'codex', windows: [win(7, 2), win(30, 2)] }] } };

async function boot(hash, { language = 'en-US' } = {}) {
  const env = makeEnv({ '/api/sessions': SESSIONS, '/api/tools': { available: true, tools: [], skills: [], subagents: [], mcp_servers: [], mcp_tools: [] }, '/api/overview': USAGE, '/api/costs': { enabled: false, models: [] }, '/api/wiki/home': HOME, '/api/wiki/recent': { items: [] }, '/api/themes': { themes: [], tokens: [], max: 50 } });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask, navigator: { language }, localStorage: { getItem: () => null, setItem: () => {} } });
  await tick();
  return env;
}
const text = (env) => env.document.getElementById('view').textContent;

test('the runtime filter is sent to the API with the other filters', async () => {
  const env = await boot('#sessions');
  const select = env.document.getElementById('runtime');
  select.value = 'codex';
  for (const fn of select.listeners.change ?? []) fn({ target: select });
  await tick();
  const last = env.calls.filter((c) => String(c.url).startsWith('/api/sessions') && !/limit=1$/.test(String(c.url))).pop();
  assert.match(String(last.url), /runtime=codex/);
});

test('sessions show a runtime badge per row; the usage page splits totals by runtime', async () => {
  const env = await boot('#sessions');
  const badges = tree(env.document.getElementById('view')).filter((e) => /\bbadge\b/.test(e.className || e.attrs.class || ''));
  assert.deepEqual(badges.map((b) => b.textContent).sort(), ['Claude Code', 'Codex']);
  const usage = await boot('#/usage');
  assert.match(text(usage), /By runtime/);
  assert.match(text(usage), /Codex/);
});

test('home spending splits by runtime, in Spanish too', async () => {
  const en = await boot('#/');
  assert.match(en.document.getElementById('view').textContent, /By runtime/);
  assert.match(en.document.getElementById('view').textContent, /Codex/);
  const es = await boot('#/', { language: 'es-ES' });
  assert.match(es.document.getElementById('view').textContent, /Por entorno/);
  assert.match(es.document.getElementById('runtime-label').textContent, /Entorno/);
});
