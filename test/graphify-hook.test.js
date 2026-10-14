import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installHook, uninstallHook, BEGIN, END } from '../src/graphify/hook.js';
import { main } from '../src/cli.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const GRAPH = JSON.stringify({ nodes: [{ id: 'a', label: 'A', file_type: 'code', source_file: 'a.py' }, { id: 'b', label: 'B', file_type: 'code', source_file: 'b.py' }], links: [{ source: 'a', target: 'b', relation: 'calls' }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sandbox({ graphify = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-gfy-'));
  const t = { root, repo: path.join(root, 'repo'), state: path.join(root, 'state'), bin: path.join(root, 'bin'), log: path.join(root, 'graphify.log') };
  await mkdir(t.repo, { recursive: true });
  await mkdir(t.bin);
  const git = (...args) => spawnSync('git', args, { cwd: t.repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...t.env } });
  t.git = git;
  git('init', '-q', '.');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  t.hook = path.join(t.repo, '.git', 'hooks', 'post-commit');
  if (graphify) {
    await writeFile(path.join(t.bin, 'graphify'), `#!/bin/sh\necho "args=$* log_disable=$GRAPHIFY_QUERY_LOG_DISABLE" >> "${t.log}"\n${graphify}\n`);
    await chmod(path.join(t.bin, 'graphify'), 0o755);
  }
  t.env = { PATH: `${t.bin}${path.delimiter}${process.env.PATH}` };
  t.commit = async (msg = 'x') => {
    await writeFile(path.join(t.repo, `f${Date.now()}${Math.random()}.txt`), msg);
    git('add', '-A');
    const started = Date.now();
    const r = git('commit', '-q', '-m', msg);
    return { ms: Date.now() - started, status: r.status, stderr: r.stderr };
  };
  t.opts = (extra = {}) => ({ cwd: t.repo, stateDir: t.state, ...extra });
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}
const executable = async (p) => ((await stat(p)).mode & 0o111) !== 0;
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  return null;
}

test('install creates an executable post-commit hook with only the marked block', async () => {
  const t = await sandbox();
  const r = await installHook(t.opts());
  assert.equal(r.changed, true);
  const text = await readFile(t.hook, 'utf8');
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.equal(text.split(BEGIN).length - 1, 1);
  assert.equal(text.split(END).length - 1, 1);
  assert.ok(await executable(t.hook));
  assert.match(text, /export GRAPHIFY_QUERY_LOG_DISABLE=1/);
  assert.match(text, /command -v graphify >\/dev\/null 2>&1 && graphify update \. >\/dev\/null 2>&1 \|\| true/);
  assert.match(text, new RegExp(`PYTHONPATH='?${path.join(repoRoot, 'python').replaceAll('/', '\\/')}'? .*python3 -P -m gentle_lite\\.graph sync --repo`));
  assert.ok(text.includes(`GENTLE_LITE_STATE_DIR=${t.state}`));
  assert.match(text, /\) >\/dev\/null 2>&1 &\n/);
  await t.cleanup();
});

test('install appends to an existing hook, keeps its content and mode, and is idempotent', async () => {
  const t = await sandbox();
  const original = '#!/bin/sh\necho "user hook"\nexit 0\n';
  await mkdir(path.dirname(t.hook), { recursive: true });
  await writeFile(t.hook, original);
  await chmod(t.hook, 0o750);
  await installHook(t.opts());
  const once = await readFile(t.hook, 'utf8');
  assert.ok(once.startsWith(original));
  assert.equal((await stat(t.hook)).mode & 0o777, 0o750);
  const again = await installHook(t.opts());
  assert.equal(again.changed, false);
  assert.equal(await readFile(t.hook, 'utf8'), once);
  await t.cleanup();
});

test('uninstall removes only the marked block and restores the original bytes', async () => {
  const t = await sandbox();
  const original = '#!/bin/sh\necho "user hook"\n';
  await writeFile(t.hook, original);
  await chmod(t.hook, 0o755);
  await installHook(t.opts());
  const r = await uninstallHook(t.opts());
  assert.equal(r.changed, true);
  assert.equal(await readFile(t.hook, 'utf8'), original);
  assert.equal((await uninstallHook(t.opts())).changed, false);
  await t.cleanup();
});

test('uninstall deletes a hook file that only we created', async () => {
  const t = await sandbox();
  await installHook(t.opts());
  await uninstallHook(t.opts());
  await assert.rejects(stat(t.hook), /ENOENT/);
  await t.cleanup();
});

test('a hook that is not a shell script is refused and left untouched', async () => {
  const t = await sandbox();
  await writeFile(t.hook, '#!/usr/bin/env python3\nprint("hi")\n');
  await assert.rejects(installHook(t.opts()), /not a shell script/);
  assert.equal(await readFile(t.hook, 'utf8'), '#!/usr/bin/env python3\nprint("hi")\n');
  await t.cleanup();
});

test('outside a git repository nothing is written', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-nogit-'));
  await assert.rejects(installHook({ cwd: root, stateDir: path.join(root, 's') }), /not a git repository/);
  await rm(root, { recursive: true, force: true });
});

test('honours core.hooksPath', async () => {
  const t = await sandbox();
  t.git('config', 'core.hooksPath', '.husky');
  const r = await installHook(t.opts());
  assert.equal(r.file, path.join(t.repo, '.husky', 'post-commit'));
  assert.match(await readFile(r.file, 'utf8'), new RegExp(BEGIN));
  await t.cleanup();
});

test('a commit returns immediately while graphify runs in the background, then the graph is mirrored', async () => {
  const t = await sandbox({ graphify: `sleep 3\nmkdir -p graphify-out\ncat > graphify-out/graph.json <<'JSON'\n${GRAPH}\nJSON` });
  await installHook(t.opts());
  const c = await t.commit('first');
  assert.equal(c.status, 0, c.stderr);
  assert.ok(c.ms < 2500, `commit took ${c.ms} ms`);
  const db = path.join(t.state, 'memory.db');
  const synced = await waitFor(async () => {
    const r = spawnSync('python3', ['-P', '-c', `import sqlite3,sys\nc=sqlite3.connect(${JSON.stringify(db)})\nprint(c.execute("select nodes, edges from graph_sync").fetchone())`], { encoding: 'utf8' });
    return r.status === 0 && r.stdout.trim() === '(2, 1)' ? r.stdout.trim() : null;
  });
  assert.equal(synced, '(2, 1)');
  const log = await readFile(t.log, 'utf8');
  assert.match(log, /args=update \. log_disable=1/);
  await t.cleanup();
});

test('without graphify on PATH the commit still succeeds and an existing graph.json is mirrored', async () => {
  const t = await sandbox();
  t.env = { PATH: path.dirname(process.execPath) + path.delimiter + '/usr/bin:/bin' }; // no graphify anywhere
  await mkdir(path.join(t.repo, 'graphify-out'));
  await writeFile(path.join(t.repo, 'graphify-out', 'graph.json'), GRAPH);
  await installHook(t.opts());
  const c = await t.commit('second');
  assert.equal(c.status, 0, c.stderr);
  assert.equal(c.stderr.trim(), '');
  const db = path.join(t.state, 'memory.db');
  const ok = await waitFor(async () => spawnSync('python3', ['-P', '-c', `import sqlite3\nprint(sqlite3.connect(${JSON.stringify(db)}).execute("select count(*) from graph_nodes").fetchone()[0])`], { encoding: 'utf8' }).stdout.trim() === '2');
  assert.ok(ok);
  await t.cleanup();
});

test('a failing graphify never breaks the commit', async () => {
  const t = await sandbox({ graphify: 'exit 9' });
  await installHook(t.opts());
  const c = await t.commit('third');
  assert.equal(c.status, 0, c.stderr);
  await t.cleanup();
});

test('CLI: graphify hook install and uninstall', async () => {
  const t = await sandbox();
  const out = sink();
  assert.equal(await main(['graphify', 'hook', 'install', '--cwd', t.repo, '--state-dir', t.state], { stdout: out, stderr: sink() }), 0);
  assert.match(out.text, /installed/);
  assert.match(await readFile(t.hook, 'utf8'), new RegExp(BEGIN));
  const out2 = sink();
  assert.equal(await main(['graphify', 'hook', 'uninstall', '--cwd', t.repo], { stdout: out2, stderr: sink() }), 0);
  assert.match(out2.text, /removed/);
  const err = sink();
  assert.equal(await main(['graphify', 'hook', 'bogus', '--cwd', t.repo], { stdout: sink(), stderr: err }), 1);
  assert.match(err.text, /usage/);
  await t.cleanup();
});

test('re-install with another state dir refreshes the block in place, keeping surrounding content', async () => {
  const t = await sandbox();
  await mkdir(path.dirname(t.hook), { recursive: true });
  await writeFile(t.hook, '#!/bin/sh\necho before\n');
  await installHook({ cwd: t.repo, stateDir: path.join(t.root, 'one') });
  const r = await installHook({ cwd: t.repo, stateDir: path.join(t.root, 'two') });
  assert.equal(r.changed, true);
  const text = await readFile(t.hook, 'utf8');
  assert.equal(text.split(BEGIN).length - 1, 1);
  assert.ok(text.includes(path.join(t.root, 'two')) && !text.includes(path.join(t.root, 'one')));
  assert.ok(text.startsWith('#!/bin/sh\necho before\n'));
  await uninstallHook({ cwd: t.repo });
  assert.equal(await readFile(t.hook, 'utf8'), '#!/bin/sh\necho before\n');
  await t.cleanup();
});
