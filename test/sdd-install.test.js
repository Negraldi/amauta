import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, uninstall, status } from '../src/install/installer.js';
import { desiredHooks } from '../src/install/servers.js';
import { chmod } from 'node:fs/promises';
import { loadManifest, assetPath, readAssetText } from '../src/install/assets.js';
import { main } from '../src/cli.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const PHASES = ['init', 'explore', 'research', 'propose', 'spec', 'design', 'tasks', 'apply', 'verify', 'archive', 'onboard'];

async function sandbox({ settings, claudeJson } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-sdd-'));
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state') };
  await mkdir(t.claudeHome, { recursive: true });
  if (settings) await writeFile(path.join(t.claudeHome, 'settings.json'), JSON.stringify(settings));
  if (claudeJson) await writeFile(t.claudeJson, JSON.stringify(claudeJson));
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: '', ...extra });
  t.settings = () => readJson(path.join(t.claudeHome, 'settings.json'));
  t.state = () => readJson(path.join(t.stateDir, 'state.json'));
  t.read = (rel) => readFile(path.join(t.claudeHome, rel), 'utf8');
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}
const sddHooks = (settings) =>
  (settings.hooks?.PreToolUse ?? []).flatMap((e) => (e.hooks ?? []).filter((h) => /amauta\.sdd preflight-hook/.test(h.command)).map((h) => ({ matcher: e.matcher, ...h })));
const tree = async (dir) => {
  const out = [];
  const walk = async (d) => { for (const e of await readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() || (e.isSymbolicLink() && (await stat(p)).isDirectory())) await walk(p); else out.push(path.relative(dir, p)); } };
  await walk(dir);
  return out.sort();
};

test('without --with-sdd nothing SDD is installed and state says so', async () => {
  const t = await sandbox();
  await install(t.opts());
  assert.equal((await t.state()).sdd, false);
  assert.ok(!existsSync(path.join(t.claudeHome, 'skills', 'sdd-apply')));
  assert.ok(!existsSync(path.join(t.claudeHome, 'agents', 'sdd-apply.md')));
  assert.ok(!existsSync(path.join(t.claudeHome, 'commands')));
  assert.equal(sddHooks(await t.settings()).length, 0);
  await t.cleanup();
});

test('--with-sdd installs skills, agents, commands, shared contracts and the PreToolUse(Agent) preflight hook', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  assert.equal((await t.state()).sdd, true);
  for (const p of PHASES) {
    assert.ok(existsSync(path.join(t.claudeHome, 'skills', `sdd-${p}`, 'SKILL.md')), `skill sdd-${p}`);
    assert.ok(existsSync(path.join(t.claudeHome, 'agents', `sdd-${p}.md`)), `agent sdd-${p}`);
  }
  for (const c of ['new', 'continue', 'ff', 'status', 'apply', 'verify', 'archive', 'explore', 'init', 'onboard', 'research']) {
    assert.ok(existsSync(path.join(t.claudeHome, 'commands', `amauta-sdd-${c}.md`)), `command amauta-sdd-${c}`);
  }
  for (const s of ['sdd-orchestrator-workflow', 'sdd-phase-common', 'sdd-status-contract', 'openspec-convention']) {
    assert.ok(existsSync(path.join(t.claudeHome, 'skills', '_shared', `${s}.md`)), s);
  }
  const hooks = sddHooks(await t.settings());
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].matcher, 'Agent');
  assert.equal(hooks[0].timeout, 30);
  assert.ok(hooks[0].command.includes(`env PYTHONPATH=${path.join(repo, 'python')} python3 -P -m amauta.sdd preflight-hook`), hooks[0].command);
  await t.cleanup();
});

test('no placeholder survives rendering and commands point at our status module', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const files = (await tree(t.claudeHome)).filter((f) => /sdd/.test(f));
  assert.ok(files.length > 30);
  for (const f of files) assert.ok(!(await t.read(f)).includes('{{'), `placeholder left in ${f}`);
  const status_ = await t.read('commands/amauta-sdd-status.md');
  assert.ok(status_.includes(`env PYTHONPATH=${path.join(repo, 'python')} python3 -P -m amauta.sdd status [change] --cwd <repo> --json --instructions`));
  assert.ok(!(await t.read('skills/_shared/sdd-status-contract.md')).includes('gentle-ai sdd-'));
  for (const f of files.filter((x) => x.startsWith('commands/'))) assert.ok(!/gentle-sdd-/.test(await t.read(f)), `${f} still names /gentle-sdd-*`);
  await t.cleanup();
});

test('agents get the assigned model, the active engram prefix (no duplicates) and the codegraph tool', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const propose = await t.read('agents/sdd-propose.md');
  const archive = await t.read('agents/sdd-archive.md');
  assert.match(propose, /^model: opus$/m);
  assert.match(archive, /^model: haiku$/m);
  const tools = propose.match(/^tools: (.+)$/m)[1].split(', ');
  assert.equal(new Set(tools).size, tools.length, 'no duplicate tool entries');
  assert.ok(tools.includes('mcp__engram__mem_save'));
  assert.ok(!propose.includes('mcp__plugin_engram_engram__'));
  assert.ok(tools.includes('mcp__codegraph__codegraph_explore'));
  assert.match(propose, /<!-- amauta:codegraph-guidance -->/);
  await t.cleanup();

  const plugin = await sandbox({ settings: { enabledPlugins: { 'engram@engram': true } } });
  await install(plugin.opts({ withSdd: true }));
  assert.match(await plugin.read('agents/sdd-apply.md'), /mcp__plugin_engram_engram__mem_save/);
  await plugin.cleanup();

  const foreign = await sandbox({ claudeJson: { mcpServers: { engram: { command: 'engram', args: ['mcp'] } } } });
  await install(foreign.opts({ withSdd: true }));
  assert.match(await foreign.read('agents/sdd-apply.md'), /mcp__amauta-memory__mem_save/);
  await foreign.cleanup();
});

test('model assignments recorded in state are honoured, including effort', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const state = await t.state();
  state.model_assignments['sdd-apply'] = { model: 'opus', effort: 'high' };
  await writeFile(path.join(t.stateDir, 'state.json'), JSON.stringify(state));
  await install(t.opts({ withSdd: true, force: true }));
  const apply = await t.read('agents/sdd-apply.md');
  assert.match(apply, /^model: opus$/m);
  assert.match(apply, /^effort: high$/m);
  await t.cleanup();
});

test('install is idempotent, sdd is sticky across re-installs, and status is healthy', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  assert.equal((await install(t.opts({ withSdd: true }))).changed, false);
  assert.equal((await install(t.opts())).changed, false, 'a plain re-install keeps the module');
  assert.equal((await t.state()).sdd, true);
  const s = await status(t.opts());
  assert.ok(s.ok, JSON.stringify(s.items.filter((i) => !i.ok)));
  assert.ok(s.items.some((i) => i.name === 'hook PreToolUse' && i.ok));
  assert.ok(s.items.some((i) => i.name === 'sdd module' && i.ok));
  await t.cleanup();
});

test('status reports a missing preflight hook and a removed SDD file as problems', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const settings = await t.settings();
  delete settings.hooks.PreToolUse;
  await writeFile(path.join(t.claudeHome, 'settings.json'), JSON.stringify(settings));
  await rm(path.join(t.claudeHome, 'agents', 'sdd-apply.md'));
  const s = await status(t.opts());
  assert.equal(s.ok, false);
  const bad = s.items.filter((i) => !i.ok).map((i) => i.name);
  assert.ok(bad.includes('hook PreToolUse'));
  assert.ok(bad.includes('file agents/sdd-apply.md'));
  await t.cleanup();
});

test('uninstall removes the whole module and restores the pre-install tree and settings', async () => {
  const original = { theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  const t = await sandbox({ settings: original });
  await mkdir(path.join(t.claudeHome, 'commands'), { recursive: true });
  await writeFile(path.join(t.claudeHome, 'commands', 'mine.md'), 'my command');
  await install(t.opts({ withSdd: true }));
  assert.ok((await tree(t.claudeHome)).some((f) => f.startsWith('skills/sdd-apply/')));
  await uninstall(t.opts());
  assert.deepEqual(await tree(t.claudeHome), ['commands/mine.md', 'settings.json']);
  assert.deepEqual(await t.settings(), original);
  await t.cleanup();
});

test('a user-edited SDD file is kept on uninstall', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  await writeFile(path.join(t.claudeHome, 'commands', 'amauta-sdd-new.md'), 'edited by me');
  const r = await uninstall(t.opts());
  assert.ok(r.kept.includes('commands/amauta-sdd-new.md'));
  assert.equal(await t.read('commands/amauta-sdd-new.md'), 'edited by me');
  assert.ok(!existsSync(path.join(t.claudeHome, 'agents', 'sdd-apply.md')));
  await t.cleanup();
});

test('CLI: --with-sdd is accepted by install and dry-run lists SDD files', async () => {
  const t = await sandbox();
  const out = sink();
  const args = ['--claude-home', t.claudeHome, '--claude-json', t.claudeJson, '--state-dir', t.stateDir];
  assert.equal(await main(['install', ...args, '--with-sdd', '--dry-run'], { stdout: out, stderr: sink() }), 0);
  assert.match(out.text, /skills\/sdd-apply\/SKILL\.md/);
  assert.ok(!existsSync(path.join(t.claudeHome, 'skills')));
  const real = sink();
  assert.equal(await main(['install', ...args, '--with-sdd'], { stdout: real, stderr: sink() }), 0);
  assert.equal((await t.state()).sdd, true);
  await t.cleanup();
});

test('the registered hook command really runs: sdd subagent without preflight is denied, others pass silently', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const [hook] = sddHooks(await t.settings());
  const run = (payload) => spawnSync('sh', ['-c', hook.command], { input: JSON.stringify(payload), encoding: 'utf8', cwd: t.root });
  const sid = 'abc-123';
  const base = { session_id: sid, transcript_path: path.join(t.root, `${sid}.jsonl`), hook_event_name: 'PreToolUse', tool_name: 'Agent' };
  const denied = run({ ...base, tool_input: { subagent_type: 'sdd-apply', prompt: 'x' } });
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const other = run({ ...base, tool_input: { subagent_type: 'general-purpose', prompt: 'x' } });
  assert.equal(other.status, 0);
  assert.equal(other.stdout, '');
  await t.cleanup();
});

test('manifest lists every SDD asset and nothing in assets/sdd is left unreferenced', async () => {
  const m = await loadManifest();
  assert.ok(m.sdd, 'manifest has an sdd block');
  for (const s of m.sdd.skills) assert.ok(existsSync(assetPath(`${m.sdd.skillsDir}/${s}/SKILL.md`)), s);
  for (const a of m.sdd.agents) assert.ok(existsSync(assetPath(`${m.sdd.agentsDir}/${a.name}.md`)), a.name);
  assert.deepEqual(m.sdd.agents.map((a) => a.name).sort(), PHASES.map((p) => `sdd-${p}`).sort());
  assert.match(await readAssetText('sdd/commands/amauta-sdd-new.md'), /amauta-sdd|sdd-orchestrator-workflow/);
});

const AGENT_PAYLOAD = { session_id: 'abc-123', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'sdd-apply', prompt: 'x' } };
const assertDeny = (r) => {
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.length > 0);
};

test('preflight hook fails closed at shell level: broken PYTHONPATH', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const [hook] = sddHooks(await t.settings());
  const broken = hook.command.replace(/PYTHONPATH=\S+/, 'PYTHONPATH=/nonexistent-gl-dir');
  assert.notEqual(broken, hook.command);
  assertDeny(spawnSync('sh', ['-c', broken], { input: JSON.stringify(AGENT_PAYLOAD), encoding: 'utf8', cwd: t.root }));
  await t.cleanup();
});

test('preflight hook fails closed at shell level: python3 shadowed by a failing script', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const [hook] = sddHooks(await t.settings());
  const bin = path.join(t.root, 'fakebin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'python3'), '#!/bin/sh\nexit 127\n');
  await chmod(path.join(bin, 'python3'), 0o755);
  const r = spawnSync('sh', ['-c', hook.command], { input: JSON.stringify(AGENT_PAYLOAD), encoding: 'utf8', cwd: t.root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assertDeny(r);
  await t.cleanup();
});

test('desiredHooks registers the SDD hook as one PreToolUse(Agent) entry (appending to user entries is covered below)', () => {
  const hooks = desiredHooks({ stateDir: '/s', sdd: true });
  assert.equal(hooks.PreToolUse.length, 1);
  assert.match(hooks.PreToolUse[0].hooks[0].command, /preflight-hook/);
});

test('a pre-existing user PreToolUse hook survives install and uninstall with --with-sdd', async () => {
  const userHook = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] };
  const t = await sandbox({ settings: { hooks: { PreToolUse: [userHook] } } });
  await install(t.opts({ withSdd: true }));
  let pre = (await t.settings()).hooks.PreToolUse;
  assert.deepEqual(pre[0], userHook);
  assert.equal(pre.length, 2);
  await install(t.opts({ withSdd: true }));
  assert.equal((await t.settings()).hooks.PreToolUse.length, 2, 'idempotent');
  await uninstall(t.opts());
  assert.deepEqual((await t.settings()).hooks.PreToolUse, [userHook]);
  await t.cleanup();
});

const withFakePython = async (t, body) => {
  const bin = path.join(t.root, 'fakebin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'python3'), `#!/bin/sh\n${body}\n`);
  await chmod(path.join(bin, 'python3'), 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
};

test('preflight guard: partial stdout from a failing hook never hides the deny decision', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const [hook] = sddHooks(await t.settings());
  const env = await withFakePython(t, `printf '{"hookSpecificOutput": {"permissionDecision": "al'\nexit 1`);
  assertDeny(spawnSync('sh', ['-c', hook.command], { input: JSON.stringify(AGENT_PAYLOAD), encoding: 'utf8', cwd: t.root, env }));
  await t.cleanup();
});

test('preflight guard: a broken launcher denies only sdd-* dispatches and stays silent for other agents', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const [hook] = sddHooks(await t.settings());
  const env = await withFakePython(t, 'exit 127');
  const other = { ...AGENT_PAYLOAD, tool_input: { subagent_type: 'general-purpose', prompt: 'x' } };
  const r = spawnSync('sh', ['-c', hook.command], { input: JSON.stringify(other), encoding: 'utf8', cwd: t.root, env });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assertDeny(spawnSync('sh', ['-c', hook.command], { input: JSON.stringify(AGENT_PAYLOAD), encoding: 'utf8', cwd: t.root, env }));
  await t.cleanup();
});

test('preflight guard: a hung hook is cut off by the inner timeout and still denies sdd-* (before the 30 s hook timeout kills the shell)', async (ctx) => {
  if (spawnSync('sh', ['-c', 'command -v timeout']).status !== 0) return ctx.skip('no timeout(1) on this system');
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  const [hook] = sddHooks(await t.settings());
  assert.match(hook.command, /timeout 20/);
  const env = await withFakePython(t, 'exec sleep 30');
  const started = Date.now();
  assertDeny(spawnSync('sh', ['-c', hook.command.replace('timeout 20', 'timeout 1')], { input: JSON.stringify(AGENT_PAYLOAD), encoding: 'utf8', cwd: t.root, env }));
  assert.ok(Date.now() - started < 10000);
  await t.cleanup();
});

test('preflight command is an explicit if/then/else (no `A && {..} || {..}` list whose branches can fall through) and is valid sh', async () => {
  const { sddPreflightCommand } = await import('../src/install/servers.js');
  const cmd = sddPreflightCommand();
  assert.match(cmd, /if out=\$\(printf '%s' "\$in" \| \$T .*preflight-hook\); then /);
  assert.match(cmd, /; else .*; fi; true$/);
  assert.ok(!/&& \{|\|\| \{/.test(cmd), `no and-or lists around the branches: ${cmd}`);
  assert.equal(spawnSync('sh', ['-n', '-c', cmd]).status, 0);
});
