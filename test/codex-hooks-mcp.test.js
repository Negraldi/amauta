import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installCodex, uninstallCodex, statusCodex } from '../src/install/codex.js';
import { install } from '../src/install/installer.js';
import { desiredHooks, isAmautaHook } from '../src/install/servers.js';
import { readMcpServer } from '../src/core/toml.js';
import { codexSandbox, exists } from './helpers/codex.js';
import { tempDir } from './helpers/tmp.js';

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const commandsOf = (hooks) => Object.entries(hooks).flatMap(([event, entries]) => entries.flatMap((e) => e.hooks.map((h) => ({ event, command: h.command, timeout: h.timeout }))));

test('hooks.json carries the amauta hooks with the codex runtime tag, in Claude hook schema', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts());
  const { hooks } = await readJson(t.p('hooks.json'));
  const got = commandsOf(hooks);
  const want = commandsOf(desiredHooks({ stateDir: t.stateDir, telemetry: true, sdd: false }));
  assert.deepEqual(got.map((h) => h.event), want.map((h) => h.event));
  assert.deepEqual(got.map((h) => h.command), want.map((h) => `AMAUTA_RUNTIME=codex ${h.command}`));
  assert.deepEqual(got.map((h) => h.timeout), want.map((h) => h.timeout));
  assert.ok(got.every((h) => isAmautaHook(h.command)));
  assert.equal(hooks.SessionStart[0].hooks[0].type, 'command');
  assert.ok(!('PreToolUse' in hooks), 'the SDD preflight guards the Claude Agent tool; Codex has no such dispatch');
  assert.ok(!(await t.read('config.toml')).includes('[hooks.state]'), 'hook trust is Codex own business');
});

test('--no-telemetry installs only the harness hooks; withSdd adds no PreToolUse', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts({ telemetry: false, withSdd: true }));
  const { hooks } = await readJson(t.p('hooks.json'));
  assert.deepEqual(Object.keys(hooks).sort(), ['SessionStart', 'Stop', 'UserPromptSubmit']);
});

test('foreign hooks survive install and uninstall; ours are idempotent and removed alone', async () => {
  const mine = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-own-stop' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }] }, extra: true };
  const t = await codexSandbox({ 'hooks.json': `${JSON.stringify(mine, null, 2)}\n` });
  await installCodex(t.opts());
  const after = await readJson(t.p('hooks.json'));
  assert.equal(after.extra, true);
  assert.equal(after.hooks.Stop[0].hooks[0].command, 'my-own-stop');
  assert.deepEqual(after.hooks.PreToolUse, mine.hooks.PreToolUse);
  const once = await t.read('hooks.json');
  assert.equal((await installCodex(t.opts())).changed, false);
  assert.equal(await t.read('hooks.json'), once);
  await uninstallCodex(t.opts());
  assert.deepEqual(await readJson(t.p('hooks.json')), mine);
});

test('uninstall deletes a hooks.json and config.toml amauta created', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts());
  await uninstallCodex(t.opts());
  assert.ok(!(await exists(t.p('hooks.json'))));
  assert.ok(!(await exists(t.p('config.toml'))));
});

test('config.toml gets engram and amauta with the same command, args and env as .claude.json', async () => {
  const t = await codexSandbox();
  const claudeJson = path.join(t.root, 'c.json');
  await install({ claudeHome: path.join(t.root, 'claude'), claudeJson, stateDir: t.stateDir, searchPath: '' });
  await installCodex(t.opts());
  const claude = (await readJson(claudeJson)).mcpServers;
  const toml = await t.read('config.toml');
  for (const name of ['engram', 'amauta']) {
    const { type, ...expected } = claude[name];
    assert.equal(type, 'stdio');
    if (name === 'engram') expected.env = { ...expected.env, AMAUTA_RUNTIME: 'codex' }; // the only difference: the runtime tag
    assert.deepEqual(readMcpServer(toml, name).value, expected, name);
  }
  assert.equal(readMcpServer(toml, 'codegraph').found, false, 'codegraph is not on PATH');
  assert.equal(readMcpServer(toml, 'context7').found, false, 'opt-in');
});

test('codegraph, context7 and rea follow PATH and the opt-in flags', async () => {
  const bin = await tempDir('gl-codex-bin-');
  await writeFile(path.join(bin, 'codegraph'), '#!/bin/sh\n');
  await chmod(path.join(bin, 'codegraph'), 0o755);
  const t = await codexSandbox();
  await installCodex(t.opts({ searchPath: bin, withContext7: true, withRea: true }));
  const toml = await t.read('config.toml');
  assert.deepEqual(readMcpServer(toml, 'codegraph').value, { command: 'codegraph', args: ['serve', '--mcp'] });
  assert.equal(readMcpServer(toml, 'context7').found, true);
  assert.equal(readMcpServer(toml, 'rea').found, true);
  await installCodex(t.opts({ searchPath: bin, withRea: false }));
  assert.equal(readMcpServer(await t.read('config.toml'), 'rea').found, false);
  assert.equal(readMcpServer(await t.read('config.toml'), 'context7').found, true, 'sticky');
});

const FOREIGN_TOML = [
  '# my codex config',
  'model = "gpt-5"',
  '',
  '[projects."/home/u/proj"]',
  'trust_level = "trusted"',
  '',
  '[hooks.state]',
  '"/home/u/.codex/hooks.json:stop:0:0" = { trusted_hash = "sha256:abc" }',
  '',
  '[mcp_servers.mine]',
  'command = "my-server"   # keep this comment',
  '',
].join('\n');

test('foreign config.toml content is preserved byte for byte through install, re-install and uninstall', async () => {
  const t = await codexSandbox({ 'config.toml': FOREIGN_TOML });
  await installCodex(t.opts());
  const after = await t.read('config.toml');
  assert.ok(after.startsWith(FOREIGN_TOML));
  assert.equal((await installCodex(t.opts())).changed, false);
  assert.equal(await t.read('config.toml'), after);
  await uninstallCodex(t.opts());
  assert.equal(await t.read('config.toml'), FOREIGN_TOML);
});

test('a foreign or edited engram table is never overwritten or removed', async () => {
  const foreign = `${FOREIGN_TOML}\n[mcp_servers.engram]\ncommand = "their-engram"\n`;
  const t = await codexSandbox({ 'config.toml': foreign });
  const res = await installCodex(t.opts());
  assert.ok(res.skipped.some((s) => s.includes('engram')));
  assert.deepEqual(readMcpServer(await t.read('config.toml'), 'engram').value, { command: 'their-engram' });
  assert.equal(readMcpServer(await t.read('config.toml'), 'amauta').found, true);

  const u = await codexSandbox();
  await installCodex(u.opts());
  const edited = (await u.read('config.toml')).replace('command = "python3"', 'command = "python3.12"');
  await writeFile(u.p('config.toml'), edited);
  const again = await installCodex(u.opts());
  assert.ok(again.skipped.some((s) => s.includes('engram')));
  await uninstallCodex(u.opts());
  assert.equal(readMcpServer(await u.read('config.toml'), 'engram').value.command, 'python3.12');
  assert.equal(readMcpServer(await u.read('config.toml'), 'amauta').found, false);
});

test('an unparseable config.toml entry is treated as foreign', async () => {
  const t = await codexSandbox({ 'config.toml': '[mcp_servers]\nengram = { command = "x" }\n' });
  const res = await installCodex(t.opts());
  assert.ok(res.skipped.some((s) => s.includes('engram')));
  assert.ok((await t.read('config.toml')).startsWith('[mcp_servers]\nengram = { command = "x" }\n'));
});

test('status checks hooks and mcp per runtime and says hooks need trust in Codex', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts());
  const s = await statusCodex(t.opts());
  assert.equal(s.ok, true, JSON.stringify(s.items.filter((i) => !i.ok)));
  assert.ok(s.items.some((i) => i.name === 'hook SessionStart' && i.ok));
  assert.ok(s.items.some((i) => i.name === 'mcp engram' && i.ok));
  assert.ok(s.notes.some((n) => /trust/i.test(n.detail)));
  await writeFile(t.p('hooks.json'), '{}\n');
  await mkdir(t.p('x'), { recursive: true });
  assert.equal((await statusCodex(t.opts())).ok, false);
});

test('install backs up hooks.json and config.toml and restore puts them back', async () => {
  const { restore } = await import('../src/install/installer.js');
  const t = await codexSandbox({ 'config.toml': FOREIGN_TOML, 'hooks.json': '{}\n' });
  const res = await installCodex(t.opts());
  await restore(t.opts({ backup: path.basename(res.backup) }));
  assert.equal(await t.read('config.toml'), FOREIGN_TOML);
  assert.equal(await t.read('hooks.json'), '{}\n');
});
