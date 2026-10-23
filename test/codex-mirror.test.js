import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installCodex, uninstallCodex, statusCodex, mirrorServers } from '../src/install/codex.js';
import { install } from '../src/install/installer.js';
import { memoryServer } from '../src/install/servers.js';
import { resolveClaudeSource } from '../src/install/paths.js';
import { readMcpServer } from '../src/core/toml.js';
import { codexSandbox } from './helpers/codex.js';

/** A Codex sandbox plus a Claude user config with the given mcpServers (Claude paths passed explicitly). */
async function world(servers) {
  const t = await codexSandbox();
  const claudeHome = path.join(t.root, 'claude');
  const claudeJson = path.join(t.root, 'claude.json');
  await mkdir(claudeHome, { recursive: true });
  await writeFile(claudeJson, `${JSON.stringify({ numStartups: 3, mcpServers: servers })}\n`);
  t.opts = ((base) => (extra = {}) => base({ claudeHome, claudeJson, ...extra }))(t.opts);
  return { t, claudeHome, claudeJson };
}

const USER_SERVERS = {
  codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
  rea: { command: 'npx', args: ['-y', 'rea-agents@6.4.0', 'mcp'] },
  context7: { type: 'stdio', command: 'npx', args: ['-y', 'ctx'], env: { TOKEN: 'secret-value' } },
  remote: { type: 'http', url: 'https://example.invalid/mcp' },
  fancy: { command: 'x', cwd: '/somewhere' },
};

test('mirrorServers keeps stdio command/args/env, drops type, and names what it cannot carry', () => {
  const { servers, unsupported } = mirrorServers(USER_SERVERS);
  assert.deepEqual(servers.codegraph, { command: 'codegraph', args: ['serve', '--mcp'] });
  assert.deepEqual(servers.context7, { command: 'npx', args: ['-y', 'ctx'], env: { TOKEN: 'secret-value' } });
  assert.deepEqual(Object.keys(servers).sort(), ['codegraph', 'context7', 'rea']);
  assert.deepEqual(unsupported.map((u) => u.name).sort(), ['fancy', 'remote']);
  assert.ok(unsupported.every((u) => typeof u.reason === 'string' && !u.reason.includes('example.invalid')));
});

test('every stdio server of the Claude user config lands in config.toml by default', async () => {
  const { t } = await world(USER_SERVERS);
  const res = await installCodex(t.opts());
  const toml = await t.read('config.toml');
  for (const name of ['codegraph', 'rea', 'context7']) {
    const want = mirrorServers(USER_SERVERS).servers[name];
    assert.deepEqual(readMcpServer(toml, name).value, want, name);
  }
  assert.equal(readMcpServer(toml, 'remote').found, false);
  assert.deepEqual(res.mirror.unsupported.map((u) => u.name).sort(), ['fancy', 'remote']);
  assert.ok(res.mirror.mirrored.includes('codegraph'));
  const st = await statusCodex(t.opts());
  assert.ok(st.notes.some((n) => n.name === 'mcp not mirrored' && n.detail.includes('remote')));
  assert.ok(!JSON.stringify(st.notes).includes('secret-value'), 'status prints names, never env values');
  assert.equal((await installCodex(t.opts())).changed, false);
});

test('--no-mirror-mcp keeps only the amauta servers, and removes mirrored tables we wrote', async () => {
  const { t } = await world(USER_SERVERS);
  await installCodex(t.opts());
  assert.equal(readMcpServer(await t.read('config.toml'), 'rea').found, true);
  await installCodex(t.opts({ mirrorMcp: false }));
  const toml = await t.read('config.toml');
  assert.equal(readMcpServer(toml, 'rea').found, false);
  assert.equal(readMcpServer(toml, 'context7').found, false);
  assert.equal(readMcpServer(toml, 'engram').found, true);
  assert.equal(readMcpServer(toml, 'amauta').found, true);
});

test('a mirrored table the user edited in Codex is left alone and reported; uninstall removes only ours', async () => {
  const { t } = await world(USER_SERVERS);
  await installCodex(t.opts());
  const edited = (await t.read('config.toml')).replace('"rea-agents@6.4.0"', '"rea-agents@9.9.9"');
  await writeFile(t.p('config.toml'), edited);
  const res = await installCodex(t.opts());
  assert.ok(res.skipped.includes('config.toml:mcp_servers.rea'));
  assert.ok(res.mirror.differs.includes('rea'));
  assert.deepEqual(readMcpServer(await t.read('config.toml'), 'rea').value.args, ['-y', 'rea-agents@9.9.9', 'mcp']);
  await uninstallCodex(t.opts());
  const toml = await t.read('config.toml');
  assert.equal(readMcpServer(toml, 'rea').found, true);
  assert.equal(readMcpServer(toml, 'codegraph').found, false);
});

test('a server the user already had in Codex under the same name is not overwritten', async () => {
  const { t } = await world(USER_SERVERS);
  await writeFile(t.p('config.toml'), '[mcp_servers.rea]\ncommand = "mine"\n');
  const res = await installCodex(t.opts());
  assert.ok(res.skipped.includes('config.toml:mcp_servers.rea'));
  assert.equal(readMcpServer(await t.read('config.toml'), 'rea').value.command, 'mine');
});

test('the memory server is the same engram entry; only the runtime tag differs between the two runtimes', async () => {
  const { t, claudeHome, claudeJson } = await world({});
  await install({ claudeHome, claudeJson, stateDir: t.stateDir, searchPath: '' });
  const claudeEntry = JSON.parse(await (await import('node:fs/promises')).readFile(claudeJson, 'utf8')).mcpServers.engram;
  assert.equal(claudeEntry.env.AMAUTA_RUNTIME, 'claude');
  await installCodex(t.opts());
  const codexEntry = readMcpServer(await t.read('config.toml'), 'engram').value;
  assert.equal(codexEntry.env.AMAUTA_RUNTIME, 'codex');
  const { AMAUTA_RUNTIME: _a, ...codexRest } = codexEntry.env;
  const { AMAUTA_RUNTIME: _b, ...claudeRest } = claudeEntry.env;
  assert.deepEqual(codexRest, claudeRest, 'same db (AMAUTA_STATE_DIR) and same code');
  assert.equal(codexEntry.command, claudeEntry.command);
  assert.deepEqual(codexEntry.args, claudeEntry.args);
  assert.deepEqual(memoryServer('/s').env.AMAUTA_RUNTIME, 'claude');
});

test('Claude entry amauta-memory (a foreign engram existed there) is published as engram in Codex', async () => {
  const mem = { ...memoryServer('/s'), env: { ...memoryServer('/s').env } };
  const { t } = await world({ 'amauta-memory': mem });
  await installCodex(t.opts());
  const toml = await t.read('config.toml');
  assert.equal(readMcpServer(toml, 'engram').value.env.AMAUTA_RUNTIME, 'codex');
  assert.equal(readMcpServer(toml, 'amauta-memory').found, false);
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
