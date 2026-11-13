// The harness wiki names the runtimes (T10): a "Runtime" line per catalog row, both runtimes on the Overview, the Codex
// switches on Security, and one plain sentence when no Codex home was found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const view = (env) => env.document.getElementById('view');

const HS = { installed: true, version: '0.3.0', rdd_mode: 'on', telemetry: false, managed_files: 3, persona: 'neutral', components: ['core'],
  hooks: [], mcp_servers: [] };
const comp = (kind, id, runtimes) => ({ kind, id, title: id, description: null, source: 'Your Claude home', uses: 0, runtimes });
const RUNTIMES = { claude: { found: true, home: '/h/.claude', installed: true, blocks: ['core'], hooks: 5, mcp_servers: 3, skills: 20 },
  codex: { found: true, home: '/h/.codex', installed: true, blocks: ['core', 'odd'], hooks: 3, mcp_servers: 2, skills: 18 } };
const COMPS = { total: 2, pending: 0, groups: [{ kind: 'mcp', label: 'MCP servers', items: [comp('mcp', 'engram', ['claude', 'codex']), comp('mcp', 'cx', ['codex'])] },
  { kind: 'agent', label: 'Agents', items: [comp('agent', 'reviewer', ['claude'])] }], runtimes: RUNTIMES };
const NO_CODEX = { ...COMPS, runtimes: { claude: RUNTIMES.claude, codex: { found: false } } };
const SKILLS = { total: 1, groups: [{ source: 'installed', label: 'Installed by amauta', items: [{ id: 'chained-pr', uses: 0, runtimes: ['claude', 'codex'] }] }] };
const SEC = { protections: { memory_guard: 'on', privacy: 'on', checks: 'on', installed: true }, checkers: [], trusted: [],
  profiles: { names: ['default'], drafts: 0, selected: [] }, redacted: {}, codex: { found: true, installed: true, privacy: 'on', checks: 'off' } };

async function boot(hash, over = {}) {
  const env = makeEnv({ '/api/harness': HS, '/api/harness/components': COMPS, '/api/skills': SKILLS, '/api/archify': { installed: false },
    '/api/security': SEC, '/api/wiki/recent': { items: [] }, '/api/overview': { available: false }, ...over });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}

test('every catalog row names its runtimes as plain text, skills included', async () => {
  const text = view(await boot('#/component')).textContent;
  assert.match(text, /engram[^]*Runtime: Claude Code, Codex/);
  assert.match(text, /cx[^]*Runtime: Codex/);
  assert.match(text, /reviewer[^]*Runtime: Claude Code/);
  assert.match(text, /chained-pr[^]*Runtime: Claude Code, Codex/);
  assert.doesNotMatch(text, /No Codex home was found/);
  assert.match(view(await boot('#/component', { '/api/harness/components': NO_CODEX })).textContent, /No Codex home was found, so only Claude Code is listed\./);
});

test('the overview shows the install state of both runtimes, or says that no Codex home was found', async () => {
  const v = view(await boot('#/harness'));
  const rows = tree(v).filter((e) => e.tagName === 'tr').map((e) => e.textContent);
  assert.ok(rows.some((r) => /^Claude Code/.test(r) && r.includes('/h/.claude') && r.includes('core')), rows.join(' | '));
  assert.ok(rows.some((r) => /^Codex/.test(r) && r.includes('/h/.codex') && r.includes('core, odd')), rows.join(' | '));
  assert.match(v.textContent, /Agents, commands, plugins and output styles are Claude Code only\./);
  assert.match(view(await boot('#/harness', { '/api/harness/components': NO_CODEX })).textContent, /No Codex home was found, so only Claude Code is listed\./);
});

test('Security lists the Codex switches and what differs there, or says the page covers Claude Code only', async () => {
  const text = view(await boot('#/security')).textContent;
  assert.match(text, /Codex: privacy hook on, checks off\./);
  assert.match(text, /prompts only/);
  const none = view(await boot('#/security', { '/api/security': { ...SEC, codex: { found: false } } })).textContent;
  assert.match(none, /No Codex home was found, so these protections cover Claude Code only\./);
});
