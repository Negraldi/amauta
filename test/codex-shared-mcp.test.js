import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installCodex, syncCodex } from '../src/install/codex.js';
import { install } from '../src/install/installer.js';
import { computeParity, parityLines } from '../src/install/parity.js';
import { readMcpServer } from '../src/core/toml.js';
import { codexSandbox } from './helpers/codex.js';

async function world(claudeOpts = {}) {
  const t = await codexSandbox();
  const claudeHome = path.join(t.root, 'claude');
  const claudeJson = path.join(t.root, 'claude.json');
  await install({ claudeHome, claudeJson, stateDir: t.stateDir, searchPath: '', ...claudeOpts });
  t.all = (extra = {}) => t.opts({ claudeHome, claudeJson, ...extra });
  t.claudeJson = claudeJson;
  t.editClaude = async (fn) => {
    const j = JSON.parse(await readFile(claudeJson, 'utf8'));
    fn(j);
    await writeFile(claudeJson, `${JSON.stringify(j)}\n`);
  };
  t.claude = async () => JSON.parse(await readFile(claudeJson, 'utf8')).mcpServers;
  t.codex = async (name) => readMcpServer(await t.read('config.toml'), name).value;
  return t;
}

const REA_ENV = { GHIDRA_INSTALL_DIR: '/opt/ghidra', JAVA_HOME: '/opt/jdk' };

test('opt-in third-party servers take the other runtime entry (command, args, env), not the template', async () => {
  const t = await world({ withRea: true });
  await t.editClaude((j) => { j.mcpServers.rea.env = { ...REA_ENV }; });
  await installCodex(t.all({ withRea: true }));
  const rea = await t.codex('rea');
  assert.deepEqual(rea.env, REA_ENV);
  assert.deepEqual(rea.args, ['-y', 'rea-agents@6.4.0', 'mcp']);
  assert.deepEqual((await computeParity(t.all())).mcp.differs, []);
  const again = await installCodex(t.all({ withRea: true }));
  assert.deepEqual((await t.codex('rea')).env, REA_ENV, 'a second install keeps it');
  assert.ok(!JSON.stringify(again).includes('/opt/ghidra'), 'env values are never printed');
});

test('a Codex-side edit of a shared server after the sync travels back to Claude (3-way)', async () => {
  const t = await world({ withRea: true });
  await t.editClaude((j) => { j.mcpServers.rea.env = { ...REA_ENV }; });
  await installCodex(t.all({ withRea: true }));
  const toml = await t.read('config.toml');
  await writeFile(t.p('config.toml'), toml.replace('/opt/jdk', '/opt/jdk21'));
  await syncCodex(t.all());
  assert.equal((await t.claude()).rea.env.JAVA_HOME, '/opt/jdk21');
  assert.equal((await t.codex('rea')).env.JAVA_HOME, '/opt/jdk21');
  await t.editClaude((j) => { j.mcpServers.rea.env.JAVA_HOME = '/opt/jdk17'; });
  await syncCodex(t.all());
  assert.equal((await t.codex('rea')).env.JAVA_HOME, '/opt/jdk17', 'and Claude edits go forward');
});

test('the template is used only when neither runtime has the server; engram and amauta stay one-way', async () => {
  const t = await world();
  await installCodex(t.all({ withRea: true }));
  assert.deepEqual(await t.codex('rea'), { command: 'npx', args: ['-y', 'rea-agents@6.4.0', 'mcp'] });
  await t.editClaude((j) => { j.mcpServers.amauta.args = ['elsewhere']; });
  await installCodex(t.all({ withRea: true }));
  assert.notDeepEqual((await t.codex('amauta')).args, ['elsewhere'], 'amauta is not mirrored from Claude');
  assert.ok((await t.codex('engram')).env.AMAUTA_RUNTIME === 'codex');
});

test('a server with another transport in the two runtimes is left alone and reported', async () => {
  const t = await world();
  await t.editClaude((j) => { j.mcpServers.context7 = { type: 'stdio', command: 'npx', args: ['-y', 'ctx'] }; });
  await writeFile(t.p('config.toml'), `${await t.read('config.toml').catch(() => '')}\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n`);
  const before = await t.read('config.toml');
  const claudeBefore = await readFile(t.claudeJson, 'utf8');
  await installCodex(t.all({ withContext7: true }));
  await syncCodex(t.all());
  assert.equal((await t.codex('context7')).url, 'https://mcp.context7.com/mcp');
  assert.equal((await t.codex('context7')).command, undefined);
  assert.equal((await t.claude()).context7.command, 'npx');
  assert.equal(JSON.parse(claudeBefore).mcpServers.context7.command, 'npx');
  assert.ok(before.includes('mcp.context7.com'));
  const p = await computeParity(t.all());
  assert.deepEqual(p.mcp.transport, ['context7']);
  assert.ok(!p.mcp.onlyClaude.includes('context7') && !p.mcp.differs.includes('context7'));
  assert.ok(parityLines(p).some((l) => /different transport/.test(l) && l.includes('context7')));
});
