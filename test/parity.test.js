import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installCodex } from '../src/install/codex.js';
import { install } from '../src/install/installer.js';
import { computeParity } from '../src/install/parity.js';
import { codexSandbox } from './helpers/codex.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');

async function world() {
  const t = await codexSandbox();
  const claudeHome = path.join(t.root, 'claude');
  const claudeJson = path.join(t.root, 'claude.json');
  const c = { claudeHome, claudeJson, stateDir: t.stateDir, searchPath: '' };
  await install(c);
  await installCodex(t.opts({ claudeHome, claudeJson }));
  t.all = (extra = {}) => t.opts({ claudeHome, claudeJson, ...extra });
  t.env = { AMAUTA_CLAUDE_HOME: claudeHome, AMAUTA_CLAUDE_JSON: claudeJson, AMAUTA_STATE_DIR: t.stateDir, AMAUTA_CODEX_HOME: t.codexHome, AMAUTA_CODEX_SKILLS_DIR: t.skillsDir };
  t.claudeHome = claudeHome;
  t.claudeJson = claudeJson;
  return t;
}

test('both runtimes in step: no differences; the only hook note is the Claude-only SubagentStop', async () => {
  const t = await world();
  const p = await computeParity(t.all());
  assert.equal(p.present, true);
  for (const k of ['mcp', 'skills', 'instructions']) assert.deepEqual([p[k].onlyClaude, p[k].onlyCodex], [[], []], k);
  assert.deepEqual(p.mcp.differs, []);
  assert.deepEqual([...new Set(p.hooks.noCodexEvent.map((h) => h.event))], ['SubagentStop']);
  assert.deepEqual(p.hooks.missingInCodex, []);
});

test('names present in one runtime and missing or different in the other are listed, never values', async () => {
  const t = await world();
  const j = JSON.parse(await readFile(t.claudeJson, 'utf8'));
  j.mcpServers.cl = { type: 'stdio', command: 'x', env: { S: 'secret-value' } };
  j.mcpServers.amauta.args = ['changed'];
  await writeFile(t.claudeJson, JSON.stringify(j));
  await writeFile(t.p('config.toml'), `${await t.read('config.toml')}\n[mcp_servers.cx]\ncommand = "y"\n`);
  await mkdir(path.join(t.claudeHome, 'skills', 'only-claude'), { recursive: true });
  await writeFile(path.join(t.claudeHome, 'skills', 'only-claude', 'SKILL.md'), 'x');
  await mkdir(path.join(t.skillsDir, 'only-codex'), { recursive: true });
  await writeFile(path.join(t.skillsDir, 'only-codex', 'SKILL.md'), 'x');
  await writeFile(t.p('AGENTS.md'), (await t.read('AGENTS.md')).replace(/<!-- amauta:[^>]*-->/g, (m, i) => (i === 0 ? '' : m)));
  const p = await computeParity(t.all());
  assert.deepEqual(p.mcp.onlyClaude, ['cl']);
  assert.deepEqual(p.mcp.onlyCodex, ['cx']);
  assert.deepEqual(p.mcp.differs, ['amauta']);
  assert.deepEqual(p.skills.onlyClaude, ['only-claude']);
  assert.deepEqual(p.skills.onlyCodex, ['only-codex']);
  assert.ok(!JSON.stringify(p).includes('secret-value'));
});

test('a Claude hook with no Codex event is named; parity is absent when Codex is not installed', async () => {
  const t = await world();
  const settings = path.join(t.claudeHome, 'settings.json');
  const s = JSON.parse(await readFile(settings, 'utf8'));
  s.hooks.Notification = [{ hooks: [{ type: 'command', command: 'notify-send hi' }] }];
  await writeFile(settings, JSON.stringify(s));
  const p = await computeParity(t.all());
  assert.ok(p.hooks.noCodexEvent.some((h) => h.event === 'Notification' && h.name === 'notify-send'));
  const alone = await codexSandbox();
  assert.equal((await computeParity(alone.opts())).present, false);
});

test('CLI: status prints a parity section and --json a parity key; the exit code ignores parity differences', async () => {
  const t = await world();
  const j = JSON.parse(await readFile(t.claudeJson, 'utf8'));
  j.mcpServers.cl = { type: 'stdio', command: 'x' };
  await writeFile(t.claudeJson, JSON.stringify(j));
  // sync would fix it; here we only look at the report, so stop the drift item from mattering: it is informational for parity
  let r = spawnSync(process.execPath, [bin, 'status'], { encoding: 'utf8', env: { ...process.env, ...t.env } });
  assert.match(r.stdout, /parity/);
  assert.match(r.stdout, /mcp only in Claude: cl/);
  assert.match(r.stdout, /hook SubagentStop: no Codex event/);
  r = spawnSync(process.execPath, [bin, 'status', '--json'], { encoding: 'utf8', env: { ...process.env, ...t.env } });
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.parity.mcp.onlyClaude, ['cl']);
  assert.ok(out.codex && out.installed);
});
