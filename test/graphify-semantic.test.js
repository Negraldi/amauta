import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { capture, runSemantic, streamMasker } from '../src/graphify/semantic.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(repoRoot, 'bin', 'gentle-lite.js');
const CANARY = 'sk-ant-CANARY-0123456789abcdef';
const GRAPH = JSON.stringify({ nodes: [{ id: 'a', label: 'A', file_type: 'code', source_file: 'a.py' }], links: [] });

async function sandbox(fake) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-sem-'));
  const t = { root, repo: path.join(root, 'repo'), state: path.join(root, 'state'), bin: path.join(root, 'bin'), calls: path.join(root, 'calls.log') };
  await mkdir(t.repo, { recursive: true });
  await mkdir(t.bin);
  spawnSync('git', ['init', '-q', '.'], { cwd: t.repo });
  if (fake !== null) {
    // Records argv and two env facts (never the key value itself), then runs the scenario body.
    await writeFile(path.join(t.bin, 'graphify'), `#!/bin/sh\necho "argv=$* log_disable=$GRAPHIFY_QUERY_LOG_DISABLE key_set=\${ANTHROPIC_API_KEY:+yes} cwd=$(pwd)" >> "${t.calls}"\n${fake}\n`, { mode: 0o755 });
    await chmod(path.join(t.bin, 'graphify'), 0o755);
  }
  t.run = (args, env = {}) => spawnSync(process.execPath, [BIN, 'graphify', 'semantic', '--cwd', t.repo, '--state-dir', t.state, ...args], {
    encoding: 'utf8',
    env: { PATH: `${t.bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin:/bin`, HOME: root, ...env },
  });
  t.db = (sql) => {
    const r = spawnSync('python3', ['-P', '-c', `import sqlite3\nprint(sqlite3.connect(${JSON.stringify(path.join(t.state, 'memory.db'))}).execute(${JSON.stringify(sql)}).fetchone())`], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  return t;
}
const calls = (t) => readFile(t.calls, 'utf8').then((x) => x.split('\n').filter(Boolean), () => []);
const WRITE_GRAPH = `mkdir -p graphify-out\ncat > graphify-out/graph.json <<'JSON'\n${GRAPH}\nJSON`;

async function filesContaining(dir, needle) {
  const hits = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const p = path.join(e.parentPath ?? e.path, e.name);
    if ((await readFile(p)).includes(needle)) hits.push(p);
  }
  return hits;
}

test('without ANTHROPIC_API_KEY it refuses clearly, exits non-zero and never calls graphify', async () => {
  const t = await sandbox(WRITE_GRAPH);
  for (const env of [{}, { ANTHROPIC_API_KEY: '' }]) {
    const r = t.run([], env);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ANTHROPIC_API_KEY/);
    assert.match(r.stderr, /graphify update|local/i, 'says what still works without a key');
  }
  assert.deepEqual(await calls(t), []);
  await rm(t.root, { recursive: true, force: true });
});

test('with a key it runs `graphify extract <repo> --backend claude --model claude-haiku-5-5`, then mirrors the graph and records the run', async () => {
  const t = await sandbox(WRITE_GRAPH);
  const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.equal(r.status, 0, r.stderr);
  const [call] = await calls(t);
  assert.equal(call, `argv=extract ${t.repo} --backend claude --model claude-haiku-5-5 log_disable=1 key_set=yes cwd=${t.repo}`);
  assert.equal(t.db('select nodes, semantic_pending, semantic_model from graph_sync'), "(1, 0, 'claude-haiku-5-5')");
  assert.match(t.db('select semantic_at from graph_sync'), /\d{4}-\d\d-\d\dT/);
  await rm(t.root, { recursive: true, force: true });
});

test('the model comes from --model, else AMAUTA_GRAPHIFY_MODEL, else the Haiku default', async () => {
  const t = await sandbox(WRITE_GRAPH);
  const env = { ANTHROPIC_API_KEY: CANARY };
  assert.equal(t.run(['--model', 'm-flag'], { ...env, AMAUTA_GRAPHIFY_MODEL: 'm-env' }).status, 0);
  assert.equal(t.run([], { ...env, AMAUTA_GRAPHIFY_MODEL: 'm-env' }).status, 0);
  const models = (await calls(t)).map((c) => c.match(/--model (\S+)/)[1]);
  assert.deepEqual(models, ['m-flag', 'm-env']);
  assert.equal(t.db('select semantic_model from graph_sync'), "('m-env',)");
  await rm(t.root, { recursive: true, force: true });
});

test('the key value is never printed, logged or written, even when graphify echoes its environment', async () => {
  const t = await sandbox(`echo "leak: $ANTHROPIC_API_KEY"\necho "leak: $ANTHROPIC_API_KEY" >&2\n${WRITE_GRAPH}`);
  const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(CANARY) && !r.stderr.includes(CANARY), 'not in the command output');
  assert.deepEqual(await filesContaining(t.root, CANARY), [], 'not in any file under the sandbox');
  const bad = await sandbox('exit 4');
  const f = bad.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.ok(!f.stdout.includes(CANARY) && !f.stderr.includes(CANARY));
  assert.deepEqual(await filesContaining(bad.root, CANARY), []);
  await rm(t.root, { recursive: true, force: true });
  await rm(bad.root, { recursive: true, force: true });
});

test('a failing extraction exits non-zero, mirrors nothing and records no run', async () => {
  const t = await sandbox('echo "extract exploded" >&2\nexit 4');
  const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /graphify extract failed/);
  assert.equal(t.db('select count(*) from graph_sync'), null, 'no database was created');
  await rm(t.root, { recursive: true, force: true });
});

test('a missing graphify binary is reported with an install hint', async () => {
  const t = await sandbox(null);
  const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /graphify not found on PATH/);
  await rm(t.root, { recursive: true, force: true });
});

const LOCK = (t) => path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
const pathExists = (p) => readFile(p).then(() => true, (e) => (e.code === 'EISDIR' ? true : false));

test('it holds the hook\'s per-repo lock while graphify extract runs and releases it afterwards', async () => {
  const t = await sandbox(`if [ -d .git/gentle-lite-graphify.lock ]; then echo LOCK_HELD_DURING_EXTRACT >> "$(dirname "$0")/../seen"; fi\n${WRITE_GRAPH}`);
  const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.equal(r.status, 0, r.stderr);
  assert.match(await readFile(path.join(t.root, 'seen'), 'utf8'), /LOCK_HELD_DURING_EXTRACT/);
  assert.equal(await pathExists(LOCK(t)), false, 'lock released after success');
  const bad = await sandbox('exit 4');
  bad.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.equal(await pathExists(LOCK(bad)), false, 'lock released after a failure');
  await rm(t.root, { recursive: true, force: true });
  await rm(bad.root, { recursive: true, force: true });
});

test('while a hook (or another pass) holds the lock it fails fast, never calls graphify and keeps the lock', async () => {
  const t = await sandbox(WRITE_GRAPH);
  await mkdir(LOCK(t));
  const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already running|in progress/i);
  assert.deepEqual(await calls(t), []);
  assert.equal(await pathExists(LOCK(t)), true, 'someone else\'s lock is left alone');
  await rm(t.root, { recursive: true, force: true });
});

test('a hook trigger that arrived during the pass is reported, not silently dropped', async () => {
  const t = await sandbox(`: > .git/gentle-lite-graphify.lock.pending\n${WRITE_GRAPH}`);
  const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /commit|hook/i);
  assert.match(r.stdout + r.stderr, /graphify update/);
  await rm(t.root, { recursive: true, force: true });
});

test('a stuck extraction is killed after the timeout: non-zero exit, lock released, nothing mirrored', async () => {
  const t = await sandbox('exec sleep 60');
  const started = Date.now();
  const r = t.run(['--timeout', '1'], { ANTHROPIC_API_KEY: CANARY });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /timed out after 1s/);
  assert.ok(Date.now() - started < 30000, 'did not wait for the 60s sleep');
  assert.equal(await pathExists(LOCK(t)), false);
  assert.equal(t.db('select count(*) from graph_sync'), null);
  await rm(t.root, { recursive: true, force: true });
});

test('the timeout comes from AMAUTA_GRAPHIFY_TIMEOUT too and a bad value is rejected before anything runs', async () => {
  const t = await sandbox(WRITE_GRAPH);
  for (const [args, env] of [[['--timeout', 'soon'], {}], [['--timeout', '0'], {}], [[], { AMAUTA_GRAPHIFY_TIMEOUT: '-5' }]]) {
    const r = t.run(args, { ANTHROPIC_API_KEY: CANARY, ...env });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /invalid timeout/i);
  }
  assert.deepEqual(await calls(t), []);
  const slow = await sandbox('exec sleep 60');
  const r = slow.run([], { ANTHROPIC_API_KEY: CANARY, AMAUTA_GRAPHIFY_TIMEOUT: '1' });
  assert.match(r.stderr, /timed out after 1s/);
  await rm(slow.root, { recursive: true, force: true });
  await rm(t.root, { recursive: true, force: true });
});

test('output is streamed (masked) and a huge error stream is bounded, not held whole', async () => {
  const t = await sandbox('i=0; while [ $i -lt 40000 ]; do echo "noise noise noise noise noise noise noise noise noise noise noise noise $ANTHROPIC_API_KEY" >&2; i=$((i+1)); done\nexit 4');
  const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.length < 200000, `stderr bounded (${r.stderr.length})`);
  assert.match(r.stderr, /truncated/);
  assert.ok(!r.stderr.includes(CANARY));
  await rm(t.root, { recursive: true, force: true });
});

// --- T19: masking on the raw stream and interrupt cleanup -------------------------------------------------------------

const fragments = (secret, min = 8) => {
  const out = [];
  for (let i = 0; i + min <= secret.length; i += 1) for (let j = i + min; j <= secret.length; j += 1) out.push(secret.slice(i, j));
  return out;
};
async function assertNoFragment(t, r) {
  const hay = [r.stdout, r.stderr];
  for (const e of await readdir(t.root, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) hay.push((await readFile(path.join(e.parentPath ?? e.path, e.name), 'utf8')));
  }
  for (const f of fragments(CANARY, 8)) {
    for (const h of hay) assert.ok(!h.includes(f), `fragment ${JSON.stringify(f)} leaked`);
  }
}
const PAD = 'pad=$(head -c 977 /dev/zero | tr "\\0" x)';

test('the key is never emitted, even unterminated, split across writes, or in a truncated stream', async () => {
  const K = '"$ANTHROPIC_API_KEY"';
  const scenarios = {
    'whole key, no newline': (fd) => `printf "%s" ${K} ${fd}; exit 4`,
    'key split across writes': (fd) => `printf "%.10s" ${K} ${fd}; sleep 0.3; printf "%s" "\${ANTHROPIC_API_KEY#??????????}" ${fd}; exit 4`,
    'key at the very end after padding': (fd) => `${PAD}; printf "%s%s" "$pad" ${K} ${fd}; exit 4`,
    'truncated newline-free stream': (fd) => `${PAD}; i=0; while [ $i -lt 150 ]; do printf "%s%s" "$pad" ${K} ${fd}; i=$((i+1)); done; exit 4`,
    'truncated stream ending in a key prefix': (fd) => `${PAD}; i=0; while [ $i -lt 90 ]; do printf "%s" "$pad" ${fd}; i=$((i+1)); done; printf "%.12s" ${K} ${fd}; exit 4`,
  };
  for (const [name, body] of Object.entries(scenarios)) {
    for (const fd of ['', '>&2']) {
      const t = await sandbox(body(fd));
      const r = t.run([], { ANTHROPIC_API_KEY: CANARY });
      assert.notEqual(r.status, 0, name);
      await assertNoFragment(t, r).catch((e) => { e.message = `${name} ${fd}: ${e.message}`; throw e; });
      await rm(t.root, { recursive: true, force: true });
    }
  }
});

const waitFor = async (fn, what, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

const SIGNO = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };
for (const signal of Object.keys(SIGNO)) {
  test(`${signal} on the CLI kills graphify's whole process group and releases the lock`, async () => {
    const t = await sandbox('placeholder');
    const pidFile = path.join(t.root, 'fake.pid');
    const gcFile = path.join(t.root, 'grandchild.pid');
    await writeFile(path.join(t.bin, 'graphify'), `#!/bin/sh\nsleep 300 &\necho $! > "${gcFile}.tmp"; mv "${gcFile}.tmp" "${gcFile}"\necho $$ > "${pidFile}.tmp"; mv "${pidFile}.tmp" "${pidFile}"\nwait\n`, { mode: 0o755 });
    const cli = spawn(process.execPath, [BIN, 'graphify', 'semantic', '--cwd', t.repo, '--state-dir', t.state], {
      env: { PATH: `${t.bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin:/bin`, HOME: t.root, ANTHROPIC_API_KEY: CANARY }, stdio: 'ignore',
    });
    const exited = new Promise((res) => cli.on('close', (code, sig) => res({ code, sig })));
    const lock = path.join(t.repo, '.git', 'gentle-lite-graphify.lock');
    const readPid = async (f) => waitFor(() => readFile(f, 'utf8').then((x) => Number.parseInt(x, 10) || 0, () => 0), f);
    const pid = await readPid(pidFile);
    const gc = await readPid(gcFile);
    assert.ok(await stat(lock).then(() => true, () => false), 'lock held while running');
    cli.kill(signal);
    const { code } = await exited;
    assert.equal(code, 128 + SIGNO[signal], 'the CLI itself exits 128+n');
    await waitFor(() => !alive(pid) && !alive(gc), 'graphify and its child to be gone');
    await waitFor(() => stat(lock).then(() => false, () => true), 'the lock to be released');
    await rm(t.root, { recursive: true, force: true });
  });
}

// --- T22: masker end(), unbounded stdout, signal ownership --------------------------------------------------------------

const feed = (secret, chunks) => {
  const m = streamMasker(secret);
  return chunks.map((c) => m.push(c)).join('') + m.end();
};

test('end() keeps a legitimate tail that only matches the key\'s public prefix, and still drops a real key fragment', () => {
  assert.equal(feed(CANARY, ['2 errors']), '2 errors', 'a trailing "s" is not key material');
  assert.equal(feed(CANARY, ['see sk-ant-']), 'see sk-ant-', 'the public vendor prefix is not secret');
  assert.equal(feed('plain-secret-value', ['status: sk']), 'status: sk', 'a 2-character match is not a fragment worth dropping');
  const dropped = feed(CANARY, ['see ', CANARY.slice(0, 12)]);
  assert.equal(dropped, 'see ', 'a held fragment beyond the public prefix is dropped, never emitted');
  assert.ok(!feed(CANARY, [`x ${CANARY}`, ' y']).includes(CANARY));
});

test('capture streams newline-free stdout while the child is still running (the partial buffer is bounded by the key length)', async () => {
  const t = await sandbox(null);
  const go = path.join(t.root, 'go');
  const chunks = [];
  const run = capture('sh', ['-c', `i=0; while [ $i -lt 100 ]; do printf '%01000d' 0; i=$((i+1)); done; while [ ! -f '${go}' ]; do sleep 0.05; done`], {
    cwd: t.root, env: process.env, secret: CANARY, onOut: (text) => chunks.push(text),
  });
  await waitFor(() => chunks.join('').length >= 90000, 'streamed output before the child ended');
  assert.equal((await stat(go).catch(() => null)), null, 'the child is still running');
  await writeFile(go, '');
  const r = await run;
  assert.equal(r.code, 0);
  await rm(t.root, { recursive: true, force: true });
});

const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };

test('runSemantic installs no process-wide signal handlers; an abort signal stops the pass, kills graphify and releases the lock', async () => {
  const t = await sandbox(null);
  const pidFile = path.join(t.root, 'fake.pid');
  await writeFile(path.join(t.bin, 'graphify'), `#!/bin/sh\necho $$ > "${pidFile}.tmp"; mv "${pidFile}.tmp" "${pidFile}"\nexec sleep 300\n`, { mode: 0o755 });
  const before = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map((n) => [n, process.listenerCount(n)]));
  const ac = new AbortController();
  const io = { stdout: sink(), stderr: sink() };
  const run = runSemantic({ cwd: t.repo, stateDir: t.state, env: { ANTHROPIC_API_KEY: CANARY, PATH: process.env.PATH }, searchPath: t.bin, signal: ac.signal }, io);
  const pid = await waitFor(() => readFile(pidFile, 'utf8').then((x) => Number.parseInt(x, 10) || 0, () => 0), 'graphify to start');
  for (const n of Object.keys(before)) assert.equal(process.listenerCount(n), before[n], `${n}: the library must not install handlers`);
  ac.abort('SIGTERM');
  assert.equal(await run, 128 + 15);
  await waitFor(() => !alive(pid), 'graphify to be gone');
  assert.equal(await pathExists(LOCK(t)), false, 'lock released');
  await rm(t.root, { recursive: true, force: true });
});
