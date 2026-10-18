import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, chmod, access } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmp.js';
import { installHook, uninstallHook, BEGIN, EVENTS } from '../src/graphify/hook.js';
import { graphifyConnect } from '../src/graphify/connect.js';
import { desiredHooks } from '../src/install/servers.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');
const GRAPH = JSON.stringify({ nodes: [{ id: 'a', label: 'A', file_type: 'code', source_file: 'a.py' }], links: [] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  return null;
}

async function sandbox({ graph = true } = {}) {
  const root = await tempDir('gl-conn-');
  const t = { root, repo: path.join(root, 'repo'), state: path.join(root, 'state'), bin: path.join(root, 'bin'), log: path.join(root, 'graphify.log') };
  await mkdir(t.repo, { recursive: true });
  await mkdir(t.bin);
  t.git = (...args) => spawnSync('git', args, { cwd: t.repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  t.git('init', '-q', '.');
  t.git('config', 'user.email', 'a@b.c');
  t.git('config', 'user.name', 'T');
  await writeFile(path.join(t.bin, 'graphify'), `#!/bin/sh\necho "args=$*" >> "${t.log}"\n`);
  await chmod(path.join(t.bin, 'graphify'), 0o755);
  if (graph) {
    await mkdir(path.join(t.repo, 'graphify-out'));
    await writeFile(path.join(t.repo, 'graphify-out', 'graph.json'), GRAPH);
  }
  t.env = { ...process.env, PATH: `${t.bin}${path.delimiter}${process.env.PATH}`, AMAUTA_STATE_DIR: t.state, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  t.hookFile = (event) => path.join(t.repo, '.git', 'hooks', event);
  t.hasBlock = async (event) => (await readFile(t.hookFile(event), 'utf8').catch(() => '')).includes(BEGIN);
  t.connect = (cwd = t.repo) => graphifyConnect({ cwd, hook_event_name: 'SessionStart', session_id: 's' }, t.env);
  t.synced = () => spawnSync('python3', ['-P', '-c', `import sqlite3\nprint(sqlite3.connect(${JSON.stringify(path.join(t.state, 'memory.db'))}).execute("select nodes from graph_sync").fetchone())`], { encoding: 'utf8' }).stdout.trim() === '(1,)';
  return t;
}

test('SessionStart in a repo with graph.json and no block installs the event hooks and refreshes in the background', async () => {
  const t = await sandbox();
  assert.equal(await t.connect(), null);
  for (const event of EVENTS) assert.ok(await t.hasBlock(event), event);
  assert.ok(await waitFor(() => t.synced()), 'graph mirrored by the background refresh');
  assert.match(await readFile(t.log, 'utf8'), /args=update \./);
});

test('it returns without waiting for the refresh (a slow graphify never blocks the session)', async () => {
  const t = await sandbox();
  await writeFile(path.join(t.bin, 'graphify'), `#!/bin/sh\nsleep 3\necho "args=$*" >> "${t.log}"\n`);
  const started = Date.now();
  await t.connect();
  assert.ok(Date.now() - started < 2500, `took ${Date.now() - started} ms`);
  assert.ok(await waitFor(() => t.synced(), 20000));
});

test('a session started in a subdirectory connects the repository root', async () => {
  const t = await sandbox();
  await mkdir(path.join(t.repo, 'src'));
  await t.connect(path.join(t.repo, 'src'));
  assert.ok(await t.hasBlock('post-commit'));
});

test('a repo that already has the block is left alone: no rewrite, no refresh', async () => {
  const t = await sandbox();
  await installHook({ cwd: t.repo, stateDir: t.state });
  const before = await readFile(t.hookFile('post-commit'), 'utf8');
  await t.connect();
  await sleep(500);
  assert.equal(await readFile(t.hookFile('post-commit'), 'utf8'), before);
  assert.equal(await exists(t.log), false);
});

test('a repo without graphify-out/graph.json is never touched', async () => {
  const t = await sandbox({ graph: false });
  await t.connect();
  for (const event of EVENTS) assert.equal(await exists(t.hookFile(event)), false, event);
  assert.equal(await exists(t.log), false);
});

test('outside a git repository, or without a cwd, nothing happens', async () => {
  const t = await sandbox();
  const plain = path.join(t.root, 'plain');
  await mkdir(path.join(plain, 'graphify-out'), { recursive: true });
  await writeFile(path.join(plain, 'graphify-out', 'graph.json'), GRAPH);
  assert.equal(await t.connect(plain), null);
  assert.equal(await graphifyConnect({}, t.env), null);
  assert.equal(await exists(path.join(plain, '.git')), false);
  assert.equal(await exists(t.log), false);
});

test('uninstall records an opt-out that the auto-connect honours; an explicit install clears it', async () => {
  const t = await sandbox();
  await installHook({ cwd: t.repo, stateDir: t.state });
  await uninstallHook({ cwd: t.repo });
  assert.equal(t.git('config', '--get', 'amauta.graphifyHook').stdout.trim(), 'false');
  await t.connect();
  await sleep(500);
  assert.equal(await t.hasBlock('post-commit'), false, 'opted out');
  assert.equal(await exists(t.log), false);
  await installHook({ cwd: t.repo, stateDir: t.state });
  assert.equal(t.git('config', '--get', 'amauta.graphifyHook').stdout.trim(), '');
  assert.ok(await t.hasBlock('post-commit'));
});

test('the hook entrypoint fails open: exit 0, empty stdout, also with bad input', async () => {
  const t = await sandbox();
  for (const input of ['not json', '', '[]', '{}', JSON.stringify({ cwd: 42 })]) {
    const r = spawnSync(process.execPath, [bin, 'hook', 'graphify-connect'], { input, encoding: 'utf8', env: t.env });
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '');
  }
  const r = spawnSync(process.execPath, [bin, 'hook', 'graphify-connect'], { input: JSON.stringify({ cwd: t.repo, hook_event_name: 'SessionStart' }), encoding: 'utf8', env: t.env });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(await t.hasBlock('post-commit'));
  assert.ok(await waitFor(() => t.synced()));
});

test('amauta install registers graphify-connect on SessionStart with a timeout', () => {
  const entries = desiredHooks({ stateDir: '/x' }).SessionStart.flatMap((e) => e.hooks);
  const h = entries.find((x) => /hook graphify-connect$/.test(x.command));
  assert.ok(h, 'registered');
  assert.ok(h.timeout > 0);
});
