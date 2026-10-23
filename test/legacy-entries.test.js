import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installCodex, uninstallCodex } from '../src/install/codex.js';
import { install, uninstall } from '../src/install/installer.js';
import { isAmautaHook, isAmautaServer } from '../src/install/servers.js';
import { readMcpServer, setMcpServer, listMcpServers } from '../src/core/toml.js';
import { codexSandbox } from './helpers/codex.js';

const OLD = '/home/someone/amauta-dev';
const PY = `env 'PYTHONPATH=${OLD}/python' 'AMAUTA_STATE_DIR=/home/someone/.amauta' 'AMAUTA_RUNTIME=codex' python3 -P`;
const legacyHooks = {
  SessionStart: [`${PY} -m amauta.telemetry hook`, `${PY} -m amauta.sdd status --hook`, `env 'AMAUTA_RUNTIME=codex' node ${OLD}/bin/amauta.js hook sync-check`, `node ${OLD}/bin/amauta.js hook review-stop`],
  UserPromptSubmit: [`${PY} -m amauta.telemetry hook`, `env 'AMAUTA_RUNTIME=codex' node ${OLD}/bin/amauta.js hook skill-registry`],
  PostToolUse: [`${PY} -m amauta.telemetry hook`],
  Stop: [`${PY} -m amauta.usage hook`, `${PY} -m amauta.telemetry hook`, `node ${OLD}/bin/amauta.js hook review-stop`],
};
const hooksFile = (extra = {}) => `${JSON.stringify({ hooks: { ...Object.fromEntries(Object.entries(legacyHooks).map(([e, cs]) => [e, [{ matcher: '', hooks: cs.map((command) => ({ type: 'command', command })) }]])), ...extra } }, null, 2)}\n`;
const allCommands = (hooks) => Object.values(hooks).flatMap((es) => es.flatMap((e) => e.hooks.map((h) => h.command)));
const legacyServer = { command: '/usr/bin/node', args: [`${OLD}/src/mcp/server.js`], env: { AMAUTA_STATE_DIR: '/home/someone/.amauta', AMAUTA_RUNTIME: 'codex' } };
const legacyMemory = { command: 'python3', args: ['-P', '-m', 'amauta.memory', 'serve'], env: { PYTHONPATH: `${OLD}/python`, AMAUTA_STATE_DIR: '/home/someone/.amauta' } };

test('isAmautaHook recognizes env-prefixed python modules and bin/amauta.js from any checkout, not foreign hooks', () => {
  for (const cs of Object.values(legacyHooks)) for (const c of cs) assert.ok(isAmautaHook(c), c);
  for (const c of ['my-own-stop', 'python3 -m other.module hook', 'node /x/guard.js hook', 'echo amauta']) assert.ok(!isAmautaHook(c), c);
});

test('isAmautaServer recognizes amauta servers from any checkout, not foreign ones', () => {
  assert.ok(isAmautaServer(legacyServer));
  assert.ok(isAmautaServer(legacyMemory));
  assert.ok(!isAmautaServer({ command: 'node', args: ['/srv/app/src/mcp/server.js'] }));
  assert.ok(!isAmautaServer({ command: 'node', args: ['/srv/app/src/mcp/server.js'], env: { OTHER: '1' } }));
  assert.ok(!isAmautaServer({ command: 'codegraph', args: ['serve', '--mcp'] }));
  assert.ok(!isAmautaServer(null));
});

test('Codex install replaces legacy amauta hooks (any path, env prefix) instead of duplicating them, and reports them', async () => {
  const seeded = JSON.parse(hooksFile());
  seeded.hooks.Stop.push({ hooks: [{ type: 'command', command: 'my-own-stop' }] });
  const t = await codexSandbox({ 'hooks.json': JSON.stringify(seeded) });
  const r = await installCodex(t.opts());
  const cmds = allCommands(JSON.parse(await t.read('hooks.json')).hooks);
  assert.ok(cmds.every((c) => !c.includes(OLD)), 'no legacy command remains');
  assert.equal(cmds.filter((c) => c === 'my-own-stop').length, 1);
  const after = JSON.parse(await t.read('hooks.json')).hooks;
  for (const es of Object.values(after)) { const c = allCommands({ x: es }); assert.equal(new Set(c).size, c.length, 'no duplicates within an event'); }
  assert.ok(r.legacy.length >= 10 && r.legacy.every((l) => typeof l === 'string'), `reported: ${r.legacy.length}`);
  assert.ok(r.legacy.some((l) => l.startsWith('hook SessionStart')));
  assert.equal((await installCodex(t.opts())).legacy.length, 0, 'second run has nothing to replace');
  await uninstallCodex(t.opts());
  assert.deepEqual(allCommands(JSON.parse(await t.read('hooks.json')).hooks), ['my-own-stop']);
});

test('Codex uninstall removes legacy amauta hooks even when the install never recorded them', async () => {
  const t = await codexSandbox({ 'hooks.json': hooksFile() });
  await uninstallCodex(t.opts());
  const after = JSON.parse(await t.read('hooks.json'));
  assert.deepEqual(allCommands(after.hooks ?? {}), []);
});

test('Codex install replaces legacy amauta and amauta-memory tables; amauta-memory is dropped; foreign ones stay', async () => {
  let toml = setMcpServer('', 'amauta', legacyServer);
  toml = setMcpServer(toml, 'amauta-memory', legacyMemory);
  toml = setMcpServer(toml, 'mine', { command: 'mine' });
  const t = await codexSandbox({ 'config.toml': toml });
  const r = await installCodex(t.opts());
  const out = await t.read('config.toml');
  assert.ok(!out.includes(OLD), 'no legacy path remains');
  assert.ok(!listMcpServers(out).includes('amauta-memory'));
  assert.ok(readMcpServer(out, 'amauta').value.args[0].endsWith(path.join('src', 'mcp', 'server.js')));
  assert.deepEqual(readMcpServer(out, 'mine').value, { command: 'mine' });
  assert.ok(!r.skipped.some((s) => s.includes('mcp_servers.amauta')), 'not reported as a kept edited file');
  assert.ok(r.legacy.includes('mcp amauta') && r.legacy.includes('mcp amauta-memory'), r.legacy.join('|'));
  assert.equal((await installCodex(t.opts())).changed, false);
});

test('a foreign table that merely shares the name amauta stays untouched', async () => {
  const foreign = { command: 'node', args: ['/srv/other/thing.js'] };
  const t = await codexSandbox({ 'config.toml': setMcpServer('', 'amauta', foreign) });
  const r = await installCodex(t.opts());
  assert.deepEqual(readMcpServer(await t.read('config.toml'), 'amauta').value, foreign);
  assert.ok(r.skipped.includes('config.toml:mcp_servers.amauta'));
  assert.deepEqual(r.legacy, []);
});

test('Codex uninstall removes legacy amauta tables it did not record, keeps foreign ones', async () => {
  let toml = setMcpServer('', 'amauta', legacyServer);
  toml = setMcpServer(toml, 'amauta-memory', legacyMemory);
  toml = setMcpServer(toml, 'engram', legacyMemory);
  toml = setMcpServer(toml, 'mine', { command: 'mine' });
  const t = await codexSandbox({ 'config.toml': toml });
  await uninstallCodex(t.opts());
  assert.deepEqual(listMcpServers(await t.read('config.toml')), ['mine']);
});

test('Claude side: legacy hooks and .claude.json amauta/engram from another checkout are replaced (pinned)', async () => {
  const t = await codexSandbox();
  const claudeHome = path.join(t.root, 'claude');
  const claudeJson = path.join(t.root, 'claude.json');
  const o = { claudeHome, claudeJson, stateDir: t.stateDir, searchPath: '' };
  await install(o);
  const sp = path.join(claudeHome, 'settings.json');
  const s = JSON.parse(await readFile(sp, 'utf8'));
  s.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command: `${PY} -m amauta.telemetry hook` }, { type: 'command', command: 'my-own-stop' }, { type: 'command', command: `env 'X=1' node ${OLD}/bin/amauta.js hook review-stop` }] });
  await writeFile(sp, JSON.stringify(s));
  const j = JSON.parse(await readFile(claudeJson, 'utf8'));
  j.mcpServers.amauta = { type: 'stdio', command: 'node', args: [`${OLD}/src/mcp/server.js`], env: { AMAUTA_STATE_DIR: '/x' } };
  j.mcpServers.engram = { type: 'stdio', ...legacyMemory };
  await writeFile(claudeJson, JSON.stringify(j));
  const r = await install(o);
  const s2 = JSON.parse(await readFile(sp, 'utf8'));
  const cmds = allCommands(s2.hooks);
  assert.ok(cmds.every((c) => !c.includes(OLD)) && cmds.includes('my-own-stop'));
  const j2 = JSON.parse(await readFile(claudeJson, 'utf8'));
  assert.ok(!JSON.stringify(j2.mcpServers).includes(OLD), 'amauta and engram point to this checkout');
  assert.ok(r.skipped.every((x) => !x.includes('mcp')));
  await uninstall(o);
  assert.deepEqual(allCommands(JSON.parse(await readFile(sp, 'utf8')).hooks ?? {}), ['my-own-stop']);
});

// --- runtime-internal MCP servers are not synced ---
import { statusCodex } from '../src/install/codex.js';
import { hashOf } from '../src/install/mcpsync.js';

const NODE_REPL = { command: '/usr/lib/chatgpt/node', args: ['repl.js'], env: { CODEX_HOME: '/h/.codex', CODEX_CLI_PATH: '/x/codex', NODE_REPL_MODE: '1' } };

async function syncWorld(toml) {
  const t = await codexSandbox({ 'config.toml': toml });
  const claudeHome = path.join(t.root, 'claude');
  const claudeJson = path.join(t.root, 'claude.json');
  await writeFile(claudeJson, `${JSON.stringify({ mcpServers: { cmine: { type: 'stdio', command: 'cm' } } })}\n`);
  t.all = (extra = {}) => t.opts({ claudeHome, claudeJson, ...extra });
  t.claude = async () => (JSON.parse(await readFile(claudeJson, 'utf8')).mcpServers ?? {});
  return t;
}

test('install never copies Codex node_repl to Claude, lists it in status, and syncs the rest', async () => {
  const t = await syncWorld(setMcpServer(setMcpServer('', 'node_repl', NODE_REPL), 'cx', { command: 'cx' }));
  const r = await installCodex(t.all());
  const servers = await t.claude();
  assert.ok(!('node_repl' in servers));
  assert.ok('cx' in servers && 'cmine' in servers);
  assert.deepEqual(r.mirror.excluded, ['node_repl']);
  const s = await statusCodex(t.all());
  assert.ok(s.notes.some((n) => n.name === 'mcp excluded from sync' && n.detail.includes('node_repl')));
});

test('a user exclude list in mcp-sync.json is honored and survives sync and uninstall', async () => {
  const t = await syncWorld(setMcpServer('', 'cx', { command: 'cx' }));
  await mkdir(t.stateDir, { recursive: true });
  await writeFile(path.join(t.stateDir, 'mcp-sync.json'), JSON.stringify({ exclude: ['cx', 'cmine'] }));
  await installCodex(t.all());
  assert.deepEqual(Object.keys(await t.claude()), ['cmine']);
  assert.equal(readMcpServer(await t.read('config.toml'), 'cmine').found, false);
  await installCodex(t.all());
  assert.deepEqual(JSON.parse(await readFile(path.join(t.stateDir, 'mcp-sync.json'), 'utf8')).exclude, ['cx', 'cmine']);
  await uninstallCodex(t.all());
  assert.deepEqual(JSON.parse(await readFile(path.join(t.stateDir, 'mcp-sync.json'), 'utf8')).exclude, ['cx', 'cmine']);
});

test('a node_repl copy an earlier sync wrote to Claude is removed when untouched, kept and reported when edited', async () => {
  for (const edited of [false, true]) {
    const t = await syncWorld(setMcpServer('', 'node_repl', NODE_REPL));
    const copy = { type: 'stdio', ...NODE_REPL, ...(edited ? { note: 'mine' } : {}) };
    await writeFile(t.all().claudeJson, `${JSON.stringify({ mcpServers: { node_repl: copy } })}\n`);
    await mkdir(t.stateDir, { recursive: true });
    await writeFile(path.join(t.stateDir, 'mcp-sync.json'), JSON.stringify({ schema: 'amauta.mcp-sync/v1', servers: { node_repl: hashOf(NODE_REPL) } }));
    const r = await installCodex(t.all());
    if (edited) {
      assert.ok('node_repl' in (await t.claude()));
      assert.deepEqual(r.mirror.staleExcluded, ['node_repl']);
    } else {
      assert.ok(!('node_repl' in (await t.claude())));
      assert.deepEqual(r.mirror.removed, ['claude:node_repl']);
    }
    assert.equal(readMcpServer(await t.read('config.toml'), 'node_repl').found, true, 'the Codex original stays');
  }
});
