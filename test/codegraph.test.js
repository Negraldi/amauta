import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, uninstall, status } from '../src/install/installer.js';
import { findOnPath, checkProjectDir, codegraphInit, codegraphStatus, CODEGRAPH_HINT } from '../src/codegraph/index.js';
import { main } from '../src/cli.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');
const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const HOOK = 'codegraph prompt-hook';

async function sandbox({ withCodegraph = true, settings, claudeJson } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-cg-'));
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state'), binDir: path.join(root, 'bin'), log: path.join(root, 'calls.log') };
  await mkdir(t.claudeHome, { recursive: true });
  await mkdir(t.binDir);
  if (withCodegraph) {
    await writeFile(path.join(t.binDir, 'codegraph'), `#!/bin/sh\necho "$PWD|$*" >> "${t.log}"\nexit "\${FAKE_CODEGRAPH_RC:-0}"\n`);
    await chmod(path.join(t.binDir, 'codegraph'), 0o755);
  }
  if (settings) await writeFile(path.join(t.claudeHome, 'settings.json'), JSON.stringify(settings));
  if (claudeJson) await writeFile(t.claudeJson, JSON.stringify(claudeJson));
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: t.binDir, ...extra });
  t.settings = () => readJson(path.join(t.claudeHome, 'settings.json'));
  t.cj = () => readJson(t.claudeJson);
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}
const promptCommands = (s) => (s.hooks?.UserPromptSubmit ?? []).flatMap((e) => e.hooks.map((h) => h.command)).filter((c) => c === HOOK);

test('findOnPath finds executables only on the given search path', async () => {
  const t = await sandbox();
  assert.equal(await findOnPath('codegraph', t.binDir), path.join(t.binDir, 'codegraph'));
  assert.equal(await findOnPath('codegraph', path.join(t.root, 'empty')), null);
  await writeFile(path.join(t.binDir, 'plain'), 'x'); // not executable
  assert.equal(await findOnPath('plain', t.binDir), null);
  await t.cleanup();
});

test('install registers the codegraph MCP entry and the prompt hook when codegraph is on PATH', async () => {
  const t = await sandbox();
  await install(t.opts());
  assert.deepEqual((await t.cj()).mcpServers.codegraph, { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] });
  assert.deepEqual(promptCommands(await t.settings()), [HOOK]);
  const again = await install(t.opts());
  assert.equal(again.changed, false);
  assert.equal(promptCommands(await t.settings()).length, 1);
  await t.cleanup();
});

test('without codegraph on PATH nothing is registered and status gives the install hint', async () => {
  const t = await sandbox({ withCodegraph: false });
  await install(t.opts());
  assert.ok(!('codegraph' in (await t.cj()).mcpServers));
  assert.equal(promptCommands(await t.settings()).length, 0);
  const s = await status(t.opts());
  assert.ok(s.ok, 'optional tool does not make the install unhealthy');
  assert.match(s.notes.find((n) => n.name === 'codegraph').detail, /npm i -g @colbymchenry\/codegraph/);
  assert.match(CODEGRAPH_HINT, /@colbymchenry\/codegraph/);
  await t.cleanup();
});

test('an existing identical prompt hook is never duplicated nor removed on uninstall; ours is removed', async () => {
  const theirs = await sandbox({ settings: { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: HOOK }] }] } } });
  await install(theirs.opts());
  assert.equal(promptCommands(await theirs.settings()).length, 1);
  await uninstall(theirs.opts());
  assert.equal(promptCommands(await theirs.settings()).length, 1, 'user hook survives');
  await theirs.cleanup();

  const ours = await sandbox({ settings: { theme: 'dark' } });
  await install(ours.opts());
  assert.equal(promptCommands(await ours.settings()).length, 1);
  await uninstall(ours.opts());
  assert.equal(promptCommands(await ours.settings()).length, 0);
  await ours.cleanup();
});

test('an existing user codegraph MCP entry is left alone', async () => {
  const mine = { command: 'codegraph', args: ['serve', '--mcp'], env: { X: '1' } };
  const t = await sandbox({ claudeJson: { mcpServers: { codegraph: mine } } });
  await install(t.opts());
  assert.deepEqual((await t.cj()).mcpServers.codegraph, mine);
  await uninstall(t.opts());
  assert.deepEqual((await t.cj()).mcpServers.codegraph, mine);
  await t.cleanup();
});

// ---- init helper ------------------------------------------------------------------------------

const guards = (t) => ({ home: path.join(t.root, 'fakehome'), tmpRoots: [path.join(t.root, 'not-tmp')] });

test('checkProjectDir refuses HOME, root, temp dirs and non-project directories', async () => {
  const t = await sandbox();
  const g = guards(t);
  await mkdir(g.home, { recursive: true });
  await assert.rejects(checkProjectDir(g.home, g), /home directory/);
  await assert.rejects(checkProjectDir('/', g), /filesystem root/);
  await assert.rejects(checkProjectDir(os.tmpdir(), { ...g, tmpRoots: [os.tmpdir()] }), /temporary/);
  const inTmp = t.root; // lives under os.tmpdir()
  await assert.rejects(checkProjectDir(inTmp, { ...g, tmpRoots: [os.tmpdir()] }), /temporary/);
  const plain = path.join(t.root, 'plain');
  await mkdir(plain);
  await assert.rejects(checkProjectDir(plain, g), /not a project/);
  await assert.rejects(checkProjectDir(path.join(t.root, 'missing'), g), /does not exist/);
  await writeFile(path.join(plain, 'package.json'), '{}');
  assert.equal(await checkProjectDir(plain, g), plain);
  await t.cleanup();
});

test('codegraph init runs `codegraph init` in the project via execFile, no shell', async () => {
  const t = await sandbox();
  const proj = path.join(t.root, 'proj; touch pwned');
  await mkdir(path.join(proj, '.git'), { recursive: true });
  const out = sink();
  const code = await codegraphInit({ cwd: proj, searchPath: t.binDir, ...guards(t) }, { stdout: out, stderr: sink() });
  assert.equal(code, 0);
  const [cwd, args] = (await readFile(t.log, 'utf8')).trim().split('|');
  assert.equal(cwd, proj);
  assert.equal(args, 'init -y');
  await t.cleanup();
});

test('codegraph init reports a missing codegraph', async () => {
  const t = await sandbox({ withCodegraph: false });
  const proj = path.join(t.root, 'proj');
  await mkdir(path.join(proj, '.git'), { recursive: true });
  const err = sink();
  assert.equal(await codegraphInit({ cwd: proj, searchPath: t.binDir, ...guards(t) }, { stdout: sink(), stderr: err }), 1);
  assert.match(err.text, /npm i -g @colbymchenry\/codegraph/);
  await t.cleanup();
});

test('codegraph init reports a failing codegraph with its exit code', async () => {
  const t = await sandbox();
  const proj = path.join(t.root, 'proj');
  await mkdir(path.join(proj, '.git'), { recursive: true });
  const err = sink();
  const prev = process.env.FAKE_CODEGRAPH_RC;
  process.env.FAKE_CODEGRAPH_RC = '3';
  try {
    assert.equal(await codegraphInit({ cwd: proj, searchPath: t.binDir, ...guards(t) }, { stdout: sink(), stderr: err }), 3);
  } finally {
    if (prev === undefined) delete process.env.FAKE_CODEGRAPH_RC; else process.env.FAKE_CODEGRAPH_RC = prev;
  }
  assert.match(err.text, /codegraph init failed/);
  await t.cleanup();
});

test('re-install after codegraph left PATH removes the prompt hook we added, and re-adds it when it returns', async () => {
  const t = await sandbox();
  await install(t.opts());
  assert.equal(promptCommands(await t.settings()).length, 1);
  await install(t.opts({ searchPath: path.join(t.root, 'empty') }));
  assert.equal(promptCommands(await t.settings()).length, 0, 'no dangling hook that fails on every prompt');
  assert.equal((await readJson(path.join(t.stateDir, 'state.json'))).codegraph_hook_added, false);
  await install(t.opts());
  assert.equal(promptCommands(await t.settings()).length, 1);
  await t.cleanup();
});

test('re-install without codegraph keeps a prompt hook the user wrote themselves', async () => {
  const t = await sandbox({ settings: { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: HOOK }] }] } } });
  await install(t.opts({ searchPath: path.join(t.root, 'empty') }));
  assert.equal(promptCommands(await t.settings()).length, 1);
  await t.cleanup();
});

test('codegraph status shows whether the project has .codegraph/', async () => {
  const t = await sandbox();
  const proj = path.join(t.root, 'proj');
  await mkdir(proj, { recursive: true });
  assert.deepEqual(await codegraphStatus({ cwd: proj, searchPath: t.binDir }), { onPath: true, path: path.join(t.binDir, 'codegraph'), indexed: false, hint: null });
  await mkdir(path.join(proj, '.codegraph'));
  assert.equal((await codegraphStatus({ cwd: proj, searchPath: t.binDir })).indexed, true);
  await t.cleanup();
});

test('real CLI: `codegraph init --cwd $HOME` is refused with a non-zero exit', async () => {
  const r = spawnSync(process.execPath, [bin, 'codegraph', 'init', '--cwd', os.homedir()], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refus/i);
  const io = { stdout: sink(), stderr: sink() };
  assert.equal(await main(['codegraph', 'init', '--cwd', '/'], io), 1);
  assert.match(io.stderr.text, /filesystem root/);
});
