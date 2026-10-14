import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, uninstall, status } from '../src/install/installer.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop'];

async function sandbox({ settings, claudeJson, stateName = 'state' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-mem-'));
  const t = {
    root,
    claudeHome: path.join(root, 'home', '.claude'),
    claudeJson: path.join(root, 'home', 'claude.json'),
    stateDir: path.join(root, stateName),
  };
  await mkdir(t.claudeHome, { recursive: true });
  if (settings) await writeFile(path.join(t.claudeHome, 'settings.json'), JSON.stringify(settings));
  if (claudeJson) await writeFile(t.claudeJson, JSON.stringify(claudeJson));
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, ...extra });
  t.settings = () => readJson(path.join(t.claudeHome, 'settings.json'));
  t.cj = () => readJson(t.claudeJson);
  t.state = () => readJson(path.join(t.stateDir, 'state.json'));
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}

const memoryEntry = (t) => ({
  type: 'stdio',
  command: 'python3',
  args: ['-P', '-m', 'gentle_lite.memory', 'serve'],
  env: { PYTHONPATH: path.join(repo, 'python'), GENTLE_LITE_STATE_DIR: t.stateDir },
});
const telemetryCommands = (settings) =>
  Object.entries(settings.hooks ?? {}).flatMap(([event, es]) => es.flatMap((e) => e.hooks.filter((h) => /gentle_lite\.telemetry hook/.test(h.command)).map((h) => ({ event, command: h.command, matcher: e.matcher }))));

const usageCommands = (settings) =>
  Object.entries(settings.hooks ?? {}).flatMap(([event, es]) => es.flatMap((e) => e.hooks.filter((h) => /gentle_lite\.usage hook/.test(h.command)).map((h) => ({ event, command: h.command, matcher: e.matcher }))));

test('usage hook is registered for Stop and SubagentStop only, same form as telemetry, and removed by uninstall', async () => {
  const t = await sandbox();
  await install(t.opts());
  const found = usageCommands(await t.settings());
  assert.deepEqual(found.map((f) => f.event).sort(), ['Stop', 'SubagentStop']);
  for (const f of found) {
    assert.equal(f.command, `env PYTHONPATH=${path.join(repo, 'python')} GENTLE_LITE_STATE_DIR=${t.stateDir} python3 -P -m gentle_lite.usage hook`);
    assert.equal(f.matcher, '');
  }
  assert.ok((await status(t.opts())).ok);
  await uninstall(t.opts());
  assert.equal(usageCommands(await t.settings().catch(() => ({}))).length, 0); // settings.json is removed when it ends up empty
  await t.cleanup();
});

test('usage hook is skipped with telemetry off and removed on re-install without it', async () => {
  const t = await sandbox();
  await install(t.opts({ telemetry: false }));
  assert.equal(usageCommands(await t.settings()).length, 0);
  await install(t.opts());
  assert.equal(usageCommands(await t.settings()).length, 2);
  await install(t.opts({ telemetry: false }));
  assert.equal(usageCommands(await t.settings()).length, 0);
  await t.cleanup();
});

test('memory MCP server is registered as "engram" when absent', async () => {
  const t = await sandbox();
  await install(t.opts());
  const cj = await t.cj();
  assert.deepEqual(cj.mcpServers.engram, memoryEntry(t));
  assert.equal((await t.state()).memory_server_key, 'engram');
  assert.ok(!('gentle-memory' in cj.mcpServers));
  const judge = await readFile(path.join(t.claudeHome, 'agents', 'jd-judge-a.md'), 'utf8');
  assert.match(judge, /mcp__engram__mem_search/);
  await uninstall(t.opts());
  await t.cleanup();
});

test('a foreign "engram" entry is kept; ours goes to "gentle-memory" and agents use that prefix', async () => {
  const foreign = { command: 'engram', args: ['mcp'] };
  const t = await sandbox({ claudeJson: { mcpServers: { engram: foreign } } });
  await install(t.opts());
  const cj = await t.cj();
  assert.deepEqual(cj.mcpServers.engram, foreign);
  assert.deepEqual(cj.mcpServers['gentle-memory'], memoryEntry(t));
  assert.equal((await t.state()).memory_server_key, 'gentle-memory');
  const judge = await readFile(path.join(t.claudeHome, 'agents', 'jd-judge-a.md'), 'utf8');
  assert.match(judge, /mcp__gentle-memory__mem_search/);
  assert.ok(!/mcp__engram__mem_search/.test(judge));

  await install(t.opts()); // idempotent, key is stable
  assert.equal((await t.state()).memory_server_key, 'gentle-memory');

  await uninstall(t.opts());
  const after = await t.cj();
  assert.deepEqual(after.mcpServers, { engram: foreign });
  await t.cleanup();
});

test('re-install refreshes our stale memory entry and uninstall removes it', async () => {
  const t = await sandbox();
  await install(t.opts());
  const before = await t.cj();
  await install(t.opts({ stateDir: t.stateDir }));
  assert.deepEqual(await t.cj(), before);
  const st = await status(t.opts());
  assert.ok(st.items.find((i) => i.name === 'mcp engram')?.ok);
  await uninstall(t.opts());
  await assert.rejects(readFile(t.claudeJson), /ENOENT/);
  await t.cleanup();
});

test('engram plugin enabled: no memory server is registered', async () => {
  const t = await sandbox({ settings: { enabledPlugins: { 'engram@engram': true } } });
  await install(t.opts());
  const cj = await t.cj();
  assert.ok(!('engram' in cj.mcpServers) && !('gentle-memory' in cj.mcpServers));
  assert.equal((await t.state()).memory_server_key, null);
  await t.cleanup();
});

test('telemetry hooks are registered for five events, marked, and removed by uninstall', async () => {
  const t = await sandbox({ settings: { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo mine' }] }] } } });
  await install(t.opts());
  const settings = await t.settings();
  const found = telemetryCommands(settings);
  assert.deepEqual(found.map((f) => f.event).sort(), [...EVENTS].sort());
  for (const f of found) {
    assert.equal(f.command, `env PYTHONPATH=${path.join(repo, 'python')} GENTLE_LITE_STATE_DIR=${t.stateDir} python3 -P -m gentle_lite.telemetry hook`);
    assert.equal(f.matcher, '');
  }
  assert.equal((await t.state()).telemetry, true);
  assert.ok(settings.hooks.Stop.some((e) => e.hooks.some((h) => h.command === 'echo mine')));
  assert.ok((await status(t.opts())).ok);
  await uninstall(t.opts());
  const after = await t.settings();
  assert.deepEqual(after.hooks, { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo mine' }] }] });
  await t.cleanup();
});

test('telemetry:false skips the hooks and records it; re-install removes earlier telemetry hooks', async () => {
  const t = await sandbox();
  await install(t.opts({ telemetry: false }));
  assert.equal(telemetryCommands(await t.settings()).length, 0);
  assert.equal((await t.state()).telemetry, false);
  await install(t.opts());
  assert.equal(telemetryCommands(await t.settings()).length, 5);
  await install(t.opts({ telemetry: false }));
  assert.equal(telemetryCommands(await t.settings()).length, 0);
  assert.equal((await t.state()).telemetry, false);
  await t.cleanup();
});

test('paths with spaces are shell-quoted in the telemetry hook command', async () => {
  const t = await sandbox({ stateName: 'my state' });
  await install(t.opts());
  const [{ command }] = telemetryCommands(await t.settings());
  assert.ok(command.includes(`'GENTLE_LITE_STATE_DIR=${t.stateDir}'`), command);
  const sh = spawnSync('sh', ['-c', command.replace('python3 -P -m gentle_lite.telemetry hook', 'printenv GENTLE_LITE_STATE_DIR')], { encoding: 'utf8' });
  assert.equal(sh.stdout.trim(), t.stateDir);
  await t.cleanup();
});

test('CLI: --no-telemetry installs without telemetry hooks', async () => {
  const t = await sandbox();
  const bin = path.join(repo, 'bin', 'gentle-lite.js');
  const r = spawnSync(process.execPath, [bin, 'install', '--no-telemetry', '--claude-home', t.claudeHome, '--claude-json', t.claudeJson, '--state-dir', t.stateDir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(telemetryCommands(await t.settings()).length, 0);
  assert.equal((await t.state()).telemetry, false);
  await t.cleanup();
});

test('installed python commands never import modules from the hook cwd (-P)', async () => {
  const t = await sandbox();
  await install(t.opts());
  const evil = await mkdtemp(path.join(os.tmpdir(), 'gl-evil-'));
  const marker = path.join(evil, 'pwned');
  await mkdir(path.join(evil, 'gentle_lite', 'memory'), { recursive: true });
  await writeFile(path.join(evil, 'gentle_lite', '__init__.py'), `open(${JSON.stringify(marker)}, 'w').close()\n`);
  await writeFile(path.join(evil, 'gentle_lite', 'memory', '__init__.py'), '');
  const entry = (await t.cj()).mcpServers.engram;
  spawnSync(entry.command, [...entry.args.slice(0, -1), '--help'], { cwd: evil, env: { ...process.env, ...entry.env }, encoding: 'utf8' });
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await rm(evil, { recursive: true, force: true });
  await t.cleanup();
});
