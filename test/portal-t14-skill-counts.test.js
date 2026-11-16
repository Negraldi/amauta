// T14 cross-page agreement, skill counts: the Catalog (every skill the portal knows), the Overview runtime table (skill folders
// in each runtime's skills directory) and Tools and skills (skills called in the range) count different things, so each count
// says which it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const HS = { installed: true, version: '0.3.0', rdd_mode: 'on', telemetry: false, managed_files: 3, persona: 'neutral', components: ['core'], hooks: [], mcp_servers: [] };
const RUNTIMES = { claude: { found: true, home: '/h/.claude', installed: true, blocks: ['core'], hooks: 5, mcp_servers: 3, skills: 34 },
  codex: { found: true, home: '/h/.codex', installed: true, blocks: ['core'], hooks: 3, mcp_servers: 2, skills: 34 } };
const TOOLS = { available: true, tools: [], skills: [{ name: 's', count: 3, sessions: 1, last_used: '2026-11-11T09:00:00Z' }], subagents: [], mcp_servers: [], mcp_tools: [] };

async function boot(hash) {
  const env = makeEnv({ '/api/harness': HS, '/api/harness/components': { total: 0, pending: 0, groups: [], runtimes: RUNTIMES },
    '/api/skills': { total: 0, groups: [] }, '/api/archify': { installed: false }, '/api/tools': TOOLS, '/api/sessions': { available: false } });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env.document.getElementById('view');
}

test('the Overview runtime table says its skill count is the skill folders of that runtime', async () => {
  const v = await boot('#/harness');
  const heads = tree(v).filter((e) => e.tagName === 'th').map((e) => e.textContent.replace(/ [▲▼]$/, ''));
  assert.ok(heads.includes('Skills in its folder'), heads.join(' | '));
  assert.match(v.textContent, /the Catalog also lists plugin, project and built-in skills/);
});

test('Tools and skills says its counts are what was used in the range', async () => {
  const v = await boot('#/tool');
  const segs = tree(v).filter((e) => e.tagName === 'a' && /\(1 used\)$/.test(e.textContent)).map((e) => e.textContent);
  assert.ok(segs.includes('Skills (1 used)'), tree(v).filter((e) => e.tagName === 'a').map((e) => e.textContent).join(' | '));
});
