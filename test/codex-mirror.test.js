import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installCodex, uninstallCodex, statusCodex } from '../src/install/codex.js';
import { install } from '../src/install/installer.js';
import { memoryServer } from '../src/install/servers.js';
import { resolveClaudeSource } from '../src/install/paths.js';
import { readMcpServer, setMcpServer } from '../src/core/toml.js';
import { codexSandbox, exists } from './helpers/codex.js';

/** A Codex sandbox plus a Claude user config with the given mcpServers (Claude paths passed explicitly). */
async function world(servers) {
  const t = await codexSandbox();
  const claudeHome = path.join(t.root, 'claude');
  const claudeJson = path.join(t.root, 'claude.json');
  await mkdir(claudeHome, { recursive: true });
  await writeFile(claudeJson, `${JSON.stringify({ numStartups: 3, mcpServers: servers })}\n`);
  t.opts = ((base) => (extra = {}) => base({ claudeHome, claudeJson, ...extra }))(t.opts);
  t.claudeServers = async () => JSON.parse(await readFile(claudeJson, 'utf8')).mcpServers ?? {};
  t.setClaude = async (name, value) => {
    const j = JSON.parse(await readFile(claudeJson, 'utf8'));
    j.mcpServers ??= {};
    if (value === null) delete j.mcpServers[name];
    else j.mcpServers[name] = value;
    await writeFile(claudeJson, `${JSON.stringify(j)}\n`);
  };
  t.setCodex = async (name, value) => {
    const text = await t.read('config.toml').catch(() => '');
    const { removeMcpServer } = await import('../src/core/toml.js');
    await writeFile(t.p('config.toml'), value === null ? removeMcpServer(text, name) : setMcpServer(text, name, value));
  };
  t.codexServer = async (name) => readMcpServer(await t.read('config.toml'), name).value;
  return { t, claudeHome, claudeJson };
}

const USER_SERVERS = {
  codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
  rea: { command: 'npx', args: ['-y', 'rea-agents@6.4.0', 'mcp'] },
  context7: { type: 'stdio', command: 'npx', args: ['-y', 'ctx'], env: { TOKEN: 'secret-value' } },
  remote: { type: 'http', url: 'https://example.invalid/mcp' },
  fancy: { command: 'x', cwd: '/somewhere' },
};

test('every stdio server of the Claude user config lands in config.toml by default; others are named, never valued', async () => {
  const { t } = await world(USER_SERVERS);
  const res = await installCodex(t.opts());
  assert.deepEqual(await t.codexServer('codegraph'), { command: 'codegraph', args: ['serve', '--mcp'] });
  assert.deepEqual(await t.codexServer('context7'), { command: 'npx', args: ['-y', 'ctx'], env: { TOKEN: 'secret-value' } });
  assert.equal(readMcpServer(await t.read('config.toml'), 'remote').found, false);
  assert.deepEqual(res.mirror.unsupported.map((u) => u.name), ['remote']);
  assert.deepEqual(res.mirror.mirrored.sort(), ['codegraph', 'context7', 'fancy', 'rea'], 'command/args/env travel; Claude-only keys (cwd) stay behind');
  const st = await statusCodex(t.opts());
  assert.ok(st.notes.some((n) => n.name === 'mcp not mirrored' && n.detail.includes('remote')));
  assert.ok(!JSON.stringify(st).includes('secret-value'), 'status prints names, never env values');
  assert.equal((await installCodex(t.opts())).changed, false);
  const base = await readFile(path.join(t.stateDir, 'mcp-sync.json'), 'utf8');
  assert.ok(!base.includes('secret-value') && !base.includes('rea-agents'), 'the base keeps hashes only');
});

test('--no-mirror-mcp syncs nothing', async () => {
  const { t } = await world(USER_SERVERS);
  await installCodex(t.opts({ mirrorMcp: false }));
  const toml = await t.read('config.toml');
  assert.equal(readMcpServer(toml, 'rea').found, false);
  assert.equal(readMcpServer(toml, 'engram').found, true);
  assert.ok(!(await exists(path.join(t.stateDir, 'mcp-sync.json'))));
});

test('add, change and remove propagate from Codex to Claude and from Claude to Codex', async () => {
  const { t } = await world({ keep: { type: 'stdio', command: 'k' } });
  await installCodex(t.opts());
  // Codex side: add, then change, then remove
  await t.setCodex('fromcodex', { command: 'c1', startup_timeout_sec: 20 });
  let res = await installCodex(t.opts());
  assert.deepEqual(res.mirror.toClaude, ['fromcodex']);
  assert.deepEqual((await t.claudeServers()).fromcodex, { type: 'stdio', command: 'c1' });
  assert.equal((await t.codexServer('fromcodex')).startup_timeout_sec, 20, 'Codex-only keys stay');
  await t.setCodex('fromcodex', { command: 'c2', startup_timeout_sec: 20 });
  await installCodex(t.opts());
  assert.equal((await t.claudeServers()).fromcodex.command, 'c2');
  await t.setCodex('fromcodex', null);
  res = await installCodex(t.opts());
  assert.ok(!('fromcodex' in (await t.claudeServers())));
  assert.deepEqual(res.mirror.removed, ['claude:fromcodex']);
  // Claude side: add, change, remove
  await t.setClaude('fromclaude', { type: 'stdio', command: 'a1', alwaysLoad: true });
  await installCodex(t.opts());
  assert.equal((await t.codexServer('fromclaude')).command, 'a1');
  await t.setClaude('fromclaude', { type: 'stdio', command: 'a2', alwaysLoad: true });
  await installCodex(t.opts());
  assert.equal((await t.codexServer('fromclaude')).command, 'a2');
  assert.equal((await t.claudeServers()).fromclaude.alwaysLoad, true, 'Claude-only keys stay');
  await t.setClaude('fromclaude', null);
  res = await installCodex(t.opts());
  assert.equal(readMcpServer(await t.read('config.toml'), 'fromclaude').found, false);
  assert.deepEqual(res.mirror.removed, ['codex:fromclaude']);
  assert.equal((await installCodex(t.opts())).changed, false);
});

test('changed differently on both sides: nothing overwritten, conflict reported by install and status until resolved', async () => {
  const { t } = await world({ shared: { type: 'stdio', command: 'v0' } });
  await installCodex(t.opts());
  await t.setClaude('shared', { type: 'stdio', command: 'claude-v1' });
  await t.setCodex('shared', { command: 'codex-v1' });
  const res = await installCodex(t.opts());
  assert.deepEqual(res.mirror.conflicts, ['shared']);
  assert.equal((await t.claudeServers()).shared.command, 'claude-v1');
  assert.equal((await t.codexServer('shared')).command, 'codex-v1');
  const st = await statusCodex(t.opts());
  assert.equal(st.ok, false);
  assert.ok(st.items.some((i) => i.name === 'mcp conflict shared' && !i.ok));
  await t.setCodex('shared', { command: 'claude-v1' }); // the user resolves it
  assert.equal((await statusCodex(t.opts())).items.some((i) => i.name.startsWith('mcp conflict')), false);
  assert.deepEqual((await installCodex(t.opts())).mirror.conflicts, []);
});

test('a table already in Codex with different content and no common history is a conflict, not overwritten', async () => {
  const { t } = await world(USER_SERVERS);
  await writeFile(t.p('config.toml'), '[mcp_servers.rea]\ncommand = "mine"\n');
  const res = await installCodex(t.opts());
  assert.deepEqual(res.mirror.conflicts, ['rea']);
  assert.equal((await t.codexServer('rea')).command, 'mine');
});

test('uninstall removes amauta-managed tables only; synced servers belong to the user in both runtimes', async () => {
  const { t } = await world(USER_SERVERS);
  await installCodex(t.opts());
  await uninstallCodex(t.opts());
  const toml = await t.read('config.toml');
  assert.equal(readMcpServer(toml, 'engram').found, false);
  assert.equal(readMcpServer(toml, 'rea').found, true);
  assert.ok(!(await exists(path.join(t.stateDir, 'mcp-sync.json'))));
  assert.ok('rea' in (await t.claudeServers()));
});

test('the memory server is the same engram entry; only the runtime tag differs between the two runtimes', async () => {
  const { t, claudeHome, claudeJson } = await world({});
  await install({ claudeHome, claudeJson, stateDir: t.stateDir, searchPath: '' });
  const claudeEntry = (await t.claudeServers()).engram;
  assert.equal(claudeEntry.env.AMAUTA_RUNTIME, 'claude');
  await installCodex(t.opts());
  const codexEntry = await t.codexServer('engram');
  assert.equal(codexEntry.env.AMAUTA_RUNTIME, 'codex');
  const { AMAUTA_RUNTIME: _a, ...codexRest } = codexEntry.env;
  const { AMAUTA_RUNTIME: _b, ...claudeRest } = claudeEntry.env;
  assert.deepEqual(codexRest, claudeRest, 'same db (AMAUTA_STATE_DIR) and same code');
  assert.equal(codexEntry.command, claudeEntry.command);
  assert.deepEqual(codexEntry.args, claudeEntry.args);
  assert.equal(memoryServer('/s').env.AMAUTA_RUNTIME, 'claude');
});

test('Claude entry amauta-memory (a foreign engram existed there) is not copied; Codex keeps its own engram', async () => {
  const { t } = await world({ 'amauta-memory': memoryServer('/s') });
  await installCodex(t.opts());
  assert.equal((await t.codexServer('engram')).env.AMAUTA_RUNTIME, 'codex');
  assert.equal(readMcpServer(await t.read('config.toml'), 'amauta-memory').found, false);
});

test('Claude source paths never fall back to the real home inside a sandbox', () => {
  const home = '/real/home';
  const s = resolveClaudeSource({ codexHome: '/sandbox/codex' }, {}, home);
  assert.ok(s.claudeJson.startsWith('/sandbox/codex'));
  assert.ok(s.claudeHome.startsWith('/sandbox/codex'));
  const real = resolveClaudeSource({}, {}, home);
  assert.equal(real.claudeJson, '/real/home/.claude.json');
  assert.equal(resolveClaudeSource({ claudeHome: '/c/.claude' }, {}, home).claudeJson, '/c/.claude/.claude.json');
});
