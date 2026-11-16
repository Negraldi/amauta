// T15 W3b group A (E3, C3, E5, D19): settings preview focus, lifecycle order of hooks, A-Z defaults, tool segments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element } from './helpers/fakedom.js';
import { boot, text, view, tree, tick, ES } from './helpers/t15w3.js';

Element.prototype.scrollIntoView = function scrollIntoView() { this.scrolled = true; };

const CURRENT = { persona: 'gentleman', review_mode: 'off', telemetry: 'on', privacy: 'on', checks: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } };
const SETTINGS = { installed: true, current: CURRENT, allowed: {}, undo: { available: false } };
const PLAN = { changes: [{ key: 'persona', from: 'gentleman', to: 'neutral' }], repair: false, plan: { changed: true, files: ['a'], removed: [], skipped: [] }, apply_token: 'T', expires_in: 300 };
const settingsRoutes = { '/api/settings': SETTINGS, '/api/settings/preview': PLAN, '/api/overview': { available: false } };
const btn = (env, label) => tree(view(env)).find((e) => e.tagName === 'button' && e.textContent === label);
const field = (env, id) => tree(view(env)).find((e) => e.attrs.id === id);
const choose = (env, id, v) => { const f = field(env, id); f.value = v; for (const fn of f.listeners.change ?? []) fn({ target: f }); };

test('E3: after Preview changes the result heading takes focus and is scrolled into view', async () => {
  const env = await boot('#/settings', settingsRoutes);
  choose(env, 'set-persona', 'neutral');
  btn(env, 'Preview changes').click();
  await tick();
  const h2 = tree(view(env)).find((e) => e.tagName === 'h2' && e.textContent === 'Preview: what would change');
  assert.ok(h2, 'the result heading exists');
  assert.equal(h2.attrs.tabindex, '-1');
  assert.equal(h2.focused, true);
  assert.equal(h2.scrolled, true);
});

test('E3: Discard preview resets the changed control to the saved value and focuses it', async () => {
  const env = await boot('#/settings', settingsRoutes);
  choose(env, 'set-persona', 'neutral');
  btn(env, 'Preview changes').click();
  await tick();
  btn(env, 'Discard preview').click();
  await tick();
  const select = field(env, 'set-persona');
  assert.equal(select.value, 'gentleman');
  assert.equal(select.focused, true);
  assert.doesNotMatch(text(env), /changed, was/);
});

const hs = { installed: true, version: '1', rdd_mode: 'on', telemetry: true, managed_files: 0, persona: 'neutral', components: [], hooks: [], mcp_servers: [] };
const hookItem = (event) => ({ kind: 'hook', id: `${event}:abc`, title: `${event} · h-${event}`, description: null, source: 'Your Claude home', uses: 0 });
test('C3: the hooks table opens in lifecycle order, not alphabetical', async () => {
  const events = ['Stop', 'PostToolUse', 'SessionStart', 'PreToolUse', 'UserPromptSubmit', 'SessionEnd'];
  const env = await boot('#/harness', { '/api/harness': hs, '/api/archify': { installed: false, available: false, fallback: '' },
    '/api/harness/components': { total: 6, pending: 0, refresh: { servers: 0 }, groups: [{ kind: 'hook', label: 'Hooks', items: events.map(hookItem) }] } });
  const body = tree(view(env)).find((e) => e.tagName === 'table' && /h-Stop/.test(e.textContent));
  const rows = tree(body).filter((e) => e.tagName === 'tr').slice(1).map((r) => r.children[0].textContent);
  assert.deepEqual(rows, ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']);
});

const PROJECTS = { config_repos: ['/z/zeta', '/a/alpha', '/m/mid'], auto_discover: false, projects: [], siblings: [] };
test('E5: the saved projects table opens ascending by name', async () => {
  const env = await boot('#/settings?tab=projects', { '/api/projects': PROJECTS, '/api/siblings': { siblings: [] } });
  const t0 = tree(view(env)).find((e) => e.tagName === 'table' && /alpha/.test(e.textContent));
  const rows = tree(t0).filter((e) => e.tagName === 'tr').slice(1).map((r) => r.children[0].textContent);
  assert.deepEqual(rows, ['/a/alpha', '/m/mid', '/z/zeta']);
});

const TOOLS = { available: true, tools: [{ name: 'Bash', count: 3, sessions: 1, last_used: '2026-11-01' }], skills: [], mcp_servers: [], mcp_tools: [],
  subagents: [{ name: 'my-agent', count: 2, sessions: 1, last_used: '2026-11-01', page: true }, { name: 'Explore', count: 1, sessions: 1, last_used: '2026-11-01', page: false }] };
test('D19: the Tools segment says MCP tools are counted elsewhere; subagent rows link only where a page exists', async () => {
  const env = await boot('#/tool', { '/api/tools': TOOLS });
  assert.match(text(env), /MCP tools are counted under MCP tools/);
  const sub = await boot('#/tool?seg=subagents', { '/api/tools': TOOLS });
  const hrefs = tree(view(sub)).filter((e) => e.tagName === 'a').map((e) => e.attrs.href);
  assert.ok(hrefs.includes('#/agent/my-agent'));
  assert.ok(!hrefs.some((h) => /Explore/.test(h)));
});
