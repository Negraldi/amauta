import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, stat, utimes, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
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
  // The post-commit hook keeps running in the background: let it release its lock first, and retry on ENOTEMPTY,
  // otherwise it can create files in .git while the directory is being removed (an intermittent cleanup failure).
  t.cleanup = async () => {
    const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
    const end = Date.now() + 5000;
    while (Date.now() < end && ((await access(lock).then(() => true, () => false)) || (await access(`${lock}.pending`).then(() => true, () => false)))) await sleep(50);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
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
  assert.match(text, /command -v graphify >\/dev\/null 2>&1/);
  assert.match(text, /graphify update \./);
  assert.match(text, /gentle-lite-graphify\.lock/);
  assert.ok(text.includes(path.join(t.state, 'graphify-hook.log')), 'failures are logged under the state dir');
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

const exists = (p) => access(p).then(() => true, () => false);
const lines = async (p) => ((await exists(p)) ? (await readFile(p, 'utf8')).split('\n').filter(Boolean) : []);
const runHook = (t) => spawn('sh', [t.hook], { cwd: t.repo, env: { ...process.env, ...t.env }, stdio: 'ignore' });

test('concurrent triggers never overlap: every graphify start is followed by its end before the next start', async () => {
  const t = await sandbox({ graphify: `echo S >> "$(dirname "$0")/../trace.log"\nsleep 1\nmkdir -p graphify-out\necho '${GRAPH}' > graphify-out/graph.json\necho E >> "$(dirname "$0")/../trace.log"` });
  await installHook(t.opts());
  const trace = path.join(t.root, 'trace.log');
  for (let i = 0; i < 6; i += 1) runHook(t);
  const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
  // Quiescence, not a fixed sleep: a coalesced re-run can grab the lock right after it is released, so wait
  // until there is no lock, no pending marker and the trace has stopped changing for longer than one run.
  let last = '';
  let stableSince = Date.now();
  const quiet = await waitFor(async () => {
    const now = (await lines(trace)).join('');
    if (now !== last) { last = now; stableSince = Date.now(); return false; }
    return now.length >= 2 && !(await exists(lock)) && !(await exists(`${lock}.pending`)) && Date.now() - stableSince > 1500;
  }, 20000);
  assert.ok(quiet, `hook never went quiet: ${last}`);
  const seq = (await lines(trace)).join('');
  assert.match(seq, /^(SE)+$/, `runs must not overlap (each start is followed by its end): ${seq}`);
  assert.equal(await exists(lock), false, 'lock is released');
  await t.cleanup();
});

test('a fresh lock makes a trigger leave a pending marker instead of running', async () => {
  const t = await sandbox({ graphify: 'true' });
  await installHook(t.opts());
  const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
  await mkdir(lock);
  runHook(t);
  assert.ok(await waitFor(() => exists(`${lock}.pending`)), 'pending marker written');
  await sleep(300);
  assert.equal(await exists(t.log), false, 'graphify did not run while the lock is held');
  await t.cleanup();
});

test('a stale lock is taken over', async () => {
  const t = await sandbox({ graphify: 'true' });
  await installHook(t.opts());
  const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
  await mkdir(lock);
  const old = new Date(Date.now() - 3600_000);
  await utimes(lock, old, old);
  runHook(t);
  assert.ok(await waitFor(() => exists(t.log)), 'graphify ran despite the old lock');
  assert.ok(await waitFor(async () => !(await exists(lock))));
  await t.cleanup();
});

test('failures are appended to <state>/graphify-hook.log instead of being discarded', async () => {
  const t = await sandbox({ graphify: 'echo boom-marker >&2\nexit 9' });
  await installHook(t.opts());
  runHook(t);
  const logFile = path.join(t.state, 'graphify-hook.log');
  const text = await waitFor(async () => { const l = await lines(logFile); return l.length ? l.join('\n') : null; });
  assert.ok(text, 'log written');
  assert.match(text, /graphify update failed/);
  assert.match(text, /boom-marker/);
  await t.cleanup();
});

test('a stale lock that is not a directory is taken over (the old rmdir-only takeover spun forever)', async () => {
  const t = await sandbox({ graphify: 'true' });
  await installHook(t.opts());
  const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
  await writeFile(lock, 'x');
  const old = new Date(Date.now() - 3600_000);
  await utimes(lock, old, old);
  runHook(t);
  assert.ok(await waitFor(() => exists(t.log), 10000), 'graphify ran after the takeover');
  await t.cleanup();
});

test('a stale lock that cannot be removed ends in a pending marker after bounded attempts instead of looping forever', async () => {
  const t = await sandbox({ graphify: 'true' });
  await writeFile(path.join(t.bin, 'rm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await installHook(t.opts());
  const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
  await mkdir(lock);
  const old = new Date(Date.now() - 3600_000);
  await utimes(lock, old, old);
  runHook(t);
  assert.ok(await waitFor(() => exists(`${lock}.pending`), 10000), 'gave up and left a marker');
  assert.equal(await exists(t.log), false);
  await t.cleanup();
});

test('a lock older than the stale limit whose owner is still alive is never taken over', async () => {
  const t = await sandbox({ graphify: 'true' });
  await installHook(t.opts());
  const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
  const owner = spawn('sleep', ['30'], { stdio: 'ignore' });
  await mkdir(lock);
  await writeFile(path.join(lock, 'pid'), `${owner.pid}\n`);
  const old = new Date(Date.now() - 3600_000);
  await utimes(lock, old, old);
  runHook(t);
  assert.ok(await waitFor(() => exists(`${lock}.pending`)), 'a live run is left alone and the trigger leaves a pending marker');
  await sleep(300);
  assert.equal(await exists(t.log), false, 'graphify did not run');
  assert.equal(await exists(lock), true, 'the live lock stays');
  owner.kill();
  await t.cleanup();
});

test('a trigger that finds the lock held re-tries it after leaving its marker (the holder may have released in between)', async () => {
  const t = await sandbox({ graphify: 'true' });
  const realMkdir = spawnSync('sh', ['-c', 'command -v mkdir'], { encoding: 'utf8' }).stdout.trim();
  const counter = path.join(t.root, 'mkdir.count');
  // First attempt sees "lock held" (as if a runner held it), the retry succeeds (as if it released meanwhile).
  await writeFile(path.join(t.bin, 'mkdir'), `#!/bin/sh\nc=$(cat '${counter}' 2>/dev/null || echo 0)\necho $((c + 1)) > '${counter}'\n[ "$c" = 0 ] && exit 1\nexec '${realMkdir}' "$@"\n`, { mode: 0o755 });
  await installHook(t.opts());
  runHook(t);
  assert.ok(await waitFor(() => exists(t.log), 10000), 'the trigger ran itself instead of leaving an unconsumed marker');
  await t.cleanup();
});

// Start token the hook stores next to the pid: "<boot_id>:<starttime field of /proc/PID/stat>" (Linux only).
async function procToken(pid) {
  const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  return `${boot}:${stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]}`;
}
const hasProc = () => exists('/proc/self/stat');
const ageLock = async (lock) => { const old = new Date(Date.now() - 3600_000); await utimes(lock, old, old); };

test('a running hook records its pid and a start token in the lock', async (ctx) => {
  if (!(await hasProc())) return ctx.skip('no /proc');
  const t = await sandbox({ graphify: 'sleep 3' });
  await installHook(t.opts());
  const pidFile = path.join(t.repo, '.git', 'gentle-lite-graphify.lock', 'pid');
  runHook(t);
  const text = await waitFor(async () => { const l = await lines(pidFile); return l.length ? l[0] : null; });
  assert.ok(text, 'pid file written');
  const [pid, token] = text.split(' ');
  assert.match(pid, /^\d+$/);
  assert.equal(token, await procToken(pid), 'token identifies this very process instance');
  await t.cleanup();
});

test('a lock whose recorded pid was reused by another live process (start token differs) is stale and taken over after the age limit', async (ctx) => {
  if (!(await hasProc())) return ctx.skip('no /proc');
  const t = await sandbox({ graphify: 'true' });
  await installHook(t.opts());
  const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
  const stranger = spawn('sleep', ['30'], { stdio: 'ignore' });
  await mkdir(lock);
  await writeFile(path.join(lock, 'pid'), `${stranger.pid} not-the-same-boot:1\n`);
  await ageLock(lock);
  runHook(t);
  assert.ok(await waitFor(() => exists(t.log), 10000), 'graphify ran: the reused pid did not wedge the hook');
  assert.ok(await waitFor(async () => !(await exists(lock))));
  stranger.kill();
  await t.cleanup();
});

test('an old lock whose pid and start token both match a live process is never taken over', async (ctx) => {
  if (!(await hasProc())) return ctx.skip('no /proc');
  const t = await sandbox({ graphify: 'true' });
  await installHook(t.opts());
  const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
  const owner = spawn('sleep', ['30'], { stdio: 'ignore' });
  await mkdir(lock);
  await writeFile(path.join(lock, 'pid'), `${owner.pid} ${await procToken(owner.pid)}\n`);
  await ageLock(lock);
  runHook(t);
  assert.ok(await waitFor(() => exists(`${lock}.pending`)), 'live owner: the trigger only leaves a marker');
  await sleep(300);
  assert.equal(await exists(t.log), false);
  assert.equal(await exists(lock), true);
  owner.kill();
  await t.cleanup();
});

test('the lock owner pid is the live background subshell even when `sh -c` is a forking wrapper (no command-substitution pid trick)', async (ctx) => {
  if (!(await hasProc())) return ctx.skip('no /proc');
  const t = await sandbox({ graphify: 'sleep 3' });
  // A non-exec `sh`: its child shell reports the wrapper as $PPID, and the wrapper exits right after. The old
  // `me="$(sh -c 'echo $PPID')"` recorded exactly such a short-lived pid; the owner must be the hook's own subshell.
  await writeFile(path.join(t.bin, 'sh'), '#!/bin/sh\n/bin/sh "$@"\n', { mode: 0o755 });
  await installHook(t.opts());
  const pidFile = path.join(t.repo, '.git', 'gentle-lite-graphify.lock', 'pid');
  spawn('/bin/sh', [t.hook], { cwd: t.repo, env: { ...process.env, ...t.env }, stdio: 'ignore' });
  const text = await waitFor(async () => { const l = await lines(pidFile); return l.length ? l[0] : null; });
  assert.ok(text, 'pid file written');
  await sleep(700); // a short-lived helper pid would be gone by now; graphify (sleep 3) is still running
  const [pid, token] = text.split(' ');
  assert.doesNotThrow(() => process.kill(Number(pid), 0), `owner pid ${pid} must still be alive while graphify runs`);
  assert.equal(token, await procToken(pid));
  await t.cleanup();
});

const dbValue = (db, sql) => {
  const r = spawnSync('python3', ['-P', '-c', `import sqlite3\nprint(sqlite3.connect(${JSON.stringify(db)}).execute(${JSON.stringify(sql)}).fetchone()[0])`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const writeGraph = 'mkdir -p graphify-out\ncat > graphify-out/graph.json <<\'JSON\'\n' + GRAPH + '\nJSON';

test('the hook runs `graphify check-update .` after update and records a pending semantic pass (never an LLM call)', async () => {
  const t = await sandbox({ graphify: `case "$1" in\n  update) ${writeGraph}\n ;;\n  check-update) echo "[graphify check-update] Pending non-code changes in $2." ;;\nesac` });
  await installHook(t.opts());
  assert.equal((await t.commit('docs')).status, 0);
  const db = path.join(t.state, 'memory.db');
  assert.ok(await waitFor(() => dbValue(db, 'select semantic_pending from graph_sync') === '1'), 'pending recorded');
  const calls = (await readFile(t.log, 'utf8')).split('\n').filter(Boolean).map((l) => l.replace(/ log_disable=.*/, ''));
  assert.deepEqual(calls.slice(0, 2), ['args=update .', 'args=check-update .']);
  assert.ok(!calls.some((c) => /extract/.test(c)), 'the hook never runs the semantic extraction');
  await t.cleanup();
});

test('a clean check-update clears the pending flag, and a failing check-update leaves it as it was', async () => {
  const t = await sandbox({ graphify: `case "$1" in\n  update) ${writeGraph}\n ;;\n  check-update) [ -e "$(dirname "$0")/../pending" ] && echo "Pending non-code changes"; [ -e "$(dirname "$0")/../broken" ] && exit 3; exit 0 ;;\nesac` });
  await installHook(t.opts());
  const db = path.join(t.state, 'memory.db');
  const settle = async () => waitFor(async () => !(await exists(path.join(t.repo, '.git', 'gentle-lite-graphify.lock'))) && !(await exists(path.join(t.repo, '.git', 'gentle-lite-graphify.lock.pending'))));
  await writeFile(path.join(t.root, 'pending'), '');
  await t.commit('one');
  assert.ok(await waitFor(() => dbValue(db, 'select semantic_pending from graph_sync') === '1'));
  await settle();
  await writeFile(path.join(t.root, 'broken'), '');
  await t.commit('two');
  await sleep(1500); await settle();
  assert.equal(dbValue(db, 'select semantic_pending from graph_sync'), '1', 'a failing check-update does not change the flag');
  await rm(path.join(t.root, 'broken'));
  await rm(path.join(t.root, 'pending'));
  await t.commit('three');
  assert.ok(await waitFor(() => dbValue(db, 'select semantic_pending from graph_sync') === '0'), 'nothing pending any more');
  await t.cleanup();
});
