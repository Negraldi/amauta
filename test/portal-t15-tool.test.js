// T15 W1 (D4, D3, C11): a tool page says "20 of 45" for its sessions and offers the rest; each call count names its window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const sessions = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'session', id: `s${i}`, title: `session ${i}` }));
const daily = Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, value: i === 29 ? 3 : 0 }));
const PAGE = (extra = {}) => ({ kind: 'tool', id: 'Bash', title: 'Bash', body_md: null, links: [], backlinks: sessions(30), backlinks_more: 15, sections: [], missing: [],
  meta: [{ label: 'Calls', value: '7163', fmt: 'number' }, { label: 'Sessions', value: '45', fmt: 'number' }], usage: { daily, days: 30 }, ...extra });

async function boot(page) {
  const env = makeEnv({ '/api/wiki/page': page, '/api/overview': { available: false } });
  env.location.hash = '#/tool/Bash';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env.document.getElementById('view');
}
const sessionLinks = (v) => tree(v).filter((e) => e.tagName === 'a' && /^#\/session\//.test(e.attrs.href));

test('the sessions rail shows 20, says "20 of 45", and Show more reveals the rest of what was sent', async () => {
  const v = await boot(PAGE());
  assert.equal(sessionLinks(v).length, 20);
  assert.match(v.textContent, /Showing 20 of 45/);
  tree(v).find((e) => e.tagName === 'button' && e.textContent === 'Show more').click();
  assert.equal(sessionLinks(v).length, 30);
  assert.match(v.textContent, /Showing 30 of 45/);
  assert.equal(tree(v).find((e) => e.tagName === 'button' && e.textContent === 'Show more'), undefined);
});

test('a list that was not cut says nothing about counts', async () => {
  const v = await boot(PAGE({ backlinks: sessions(5), backlinks_more: 0 }));
  assert.equal(sessionLinks(v).length, 5);
  assert.doesNotMatch(v.textContent, /Showing/);
});

test('the all-time count is labelled "Calls in total" and the chart sentence names its window', async () => {
  const v = await boot(PAGE());
  assert.match(v.textContent, /Calls in total/);
  assert.match(v.textContent, /3 calls in the last 30 days \(up to 2026-09-30\)/);
});

const EMPTY_TOOLS = { available: true, tools: [], skills: [], subagents: [], mcp_servers: [], mcp_tools: [] };
async function tools(runtime) {
  const env = makeEnv({ '/api/tools': EMPTY_TOOLS, '/api/sessions': { available: true, sessions: [], projects: [] }, '/api/overview': { available: false } });
  env.location.hash = '#/tool';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const select = env.document.getElementById('runtime');
  select.value = runtime;
  for (const fn of select.listeners.change ?? []) fn({ target: select });
  await tick();
  return env.document.getElementById('view').textContent;
}

test('D6: an empty Tools page under the Codex filter says no Codex tool calls were found in the range', async () => {
  const text = await tools('codex');
  assert.match(text, /No tool calls were found in Codex sessions in this range/);
  assert.doesNotMatch(text, /Nothing recorded in this range/);
});

test('D6: other runtimes keep the plain empty state', async () => {
  assert.match(await tools('claude'), /Nothing recorded in this range/);
  assert.match(await tools(''), /Nothing recorded in this range/);
});
