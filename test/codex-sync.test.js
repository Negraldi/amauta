import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installCodex, statusCodex, syncCodex } from '../src/install/codex.js';
import { install } from '../src/install/installer.js';
import { sourceFingerprint, syncIfChanged } from '../src/install/fingerprint.js';
import { desiredHooks } from '../src/install/servers.js';
import { readMcpServer } from '../src/core/toml.js';
import { codexSandbox } from './helpers/codex.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');

async function world() {
  const t = await codexSandbox();
  const claudeHome = path.join(t.root, 'claude');
  const claudeJson = path.join(t.root, 'claude.json');
  const c = { claudeHome, claudeJson, stateDir: t.stateDir, searchPath: '' };
  await install(c);
  t.all = (extra = {}) => t.opts({ claudeHome, claudeJson, ...extra });
  t.edit = async (fn) => {
    const j = JSON.parse(await readFile(claudeJson, 'utf8'));
    fn(j);
    await writeFile(claudeJson, `${JSON.stringify(j)}\n`);
  };
  t.env = { AMAUTA_CLAUDE_HOME: claudeHome, AMAUTA_CLAUDE_JSON: claudeJson, AMAUTA_STATE_DIR: t.stateDir, AMAUTA_CODEX_HOME: t.codexHome, AMAUTA_CODEX_SKILLS_DIR: t.skillsDir };
  return t;
}

test('the fingerprint moves with MCP servers and skills of either runtime, not with unrelated Claude keys', async () => {
  const t = await world();
  await installCodex(t.all());
  const f0 = await sourceFingerprint(t.all());
  assert.equal(await sourceFingerprint(t.all()), f0);
  await t.edit((j) => { j.numStartups = 99; });
  assert.equal(await sourceFingerprint(t.all()), f0, 'unrelated .claude.json keys do not count');
  await t.edit((j) => { j.mcpServers.mine = { type: 'stdio', command: 'm' }; });
  const f1 = await sourceFingerprint(t.all());
  assert.notEqual(f1, f0);
  await writeFile(t.p('config.toml'), `${await t.read('config.toml')}\n[mcp_servers.other]\ncommand = "o"\n`);
  const f2 = await sourceFingerprint(t.all());
  assert.notEqual(f2, f1);
  await mkdir(path.join(t.skillsDir, 'mine-skill'), { recursive: true });
  assert.notEqual(await sourceFingerprint(t.all()), f2);
});

test('syncCodex propagates in both directions, records the fingerprint, and does nothing without a Codex install', async () => {
  const t = await world();
  assert.equal((await syncCodex(t.all())).synced, false);
  await installCodex(t.all());
  await t.edit((j) => { j.mcpServers.mine = { type: 'stdio', command: 'm' }; });
  await writeFile(t.p('config.toml'), `${await t.read('config.toml')}\n[mcp_servers.other]\ncommand = "o"\n`);
  const r = await syncCodex(t.all());
  assert.equal(r.synced, true);
  assert.equal(readMcpServer(await t.read('config.toml'), 'mine').value.command, 'm');
  assert.equal(JSON.parse(await readFile(t.all().claudeJson, 'utf8')).mcpServers.other.command, 'o');
  const rec = JSON.parse(await readFile(path.join(t.stateDir, 'sync.json'), 'utf8'));
  assert.equal(rec.fingerprint, await sourceFingerprint(t.all()));
  assert.equal((await syncCodex(t.all())).changed, false);
});

test('syncIfChanged is silent and fast when nothing changed, and syncs when a source changed', async () => {
  const t = await world();
  assert.deepEqual(await syncIfChanged(t.all()), { ran: false, reason: 'no codex install' });
  await installCodex(t.all());
  const start = performance.now();
  const same = await syncIfChanged(t.all());
  assert.deepEqual(same, { ran: false, reason: 'unchanged' });
  assert.ok(performance.now() - start < 200, `check took ${performance.now() - start} ms`);
  await t.edit((j) => { j.mcpServers.late = { type: 'stdio', command: 'l' }; });
  assert.equal((await syncIfChanged(t.all())).ran, true);
  assert.equal(readMcpServer(await t.read('config.toml'), 'late').value.command, 'l');
  assert.equal((await syncIfChanged(t.all())).ran, false);
});

test('status reports drift until a sync, and keeps the exit code logic of problems', async () => {
  const t = await world();
  await installCodex(t.all());
  assert.equal((await statusCodex(t.all())).ok, true);
  await t.edit((j) => { j.mcpServers.fresh = { type: 'stdio', command: 'f' }; });
  const st = await statusCodex(t.all());
  assert.equal(st.ok, false);
  assert.ok(st.items.some((i) => i.name === 'sync' && /Codex out of sync/.test(i.detail)));
  await syncCodex(t.all());
  assert.equal((await statusCodex(t.all())).ok, true);
});

test('SessionStart carries the sync-check step in both runtimes, after the existing steps', async () => {
  const hooks = desiredHooks({ stateDir: '/s', telemetry: false });
  const cmds = hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(cmds.at(-1).endsWith('hook sync-check'));
  const t = await world();
  await installCodex(t.all());
  const codexHooks = JSON.parse(await t.read('hooks.json')).hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(codexHooks.some((c) => c.startsWith('AMAUTA_RUNTIME=codex ') && c.endsWith('hook sync-check')));
});

test('CLI: the sync-check hook prints nothing and exits 0; `amauta sync` reports and --dry-run changes nothing', async () => {
  const t = await world();
  await installCodex(t.all());
  await t.edit((j) => { j.mcpServers.viahook = { type: 'stdio', command: 'h' }; });
  let r = spawnSync(process.execPath, [bin, 'hook', 'sync-check'], { encoding: 'utf8', input: '{}', env: { ...process.env, ...t.env } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(readMcpServer(await t.read('config.toml'), 'viahook').value.command, 'h');
  await t.edit((j) => { j.mcpServers.manual = { type: 'stdio', command: 'x' }; });
  r = spawnSync(process.execPath, [bin, 'sync', '--dry-run'], { encoding: 'utf8', env: { ...process.env, ...t.env } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /manual/);
  assert.equal(readMcpServer(await t.read('config.toml'), 'manual').found, false);
  r = spawnSync(process.execPath, [bin, 'sync'], { encoding: 'utf8', env: { ...process.env, ...t.env } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Claude -> Codex: .*manual/);
  r = spawnSync(process.execPath, [bin, 'sync', '--json'], { encoding: 'utf8', env: { ...process.env, ...t.env } });
  assert.equal(JSON.parse(r.stdout).synced, true);
});
