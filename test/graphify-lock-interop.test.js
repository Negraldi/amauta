import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../src/install/assets.js';
import { takeLock } from '../src/graphify/semantic.js';

const exists = (p) => stat(p).then(() => true, () => false);
const PYTHONPATH = path.join(repoRoot, 'python');
const py = (code, args = [], opts = {}) => ({ cmd: 'python3', args: ['-P', '-c', code, ...args], opts: { env: { ...process.env, PYTHONPATH }, ...opts } });

async function gitRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-lockx-'));
  const repo = path.join(root, 'repo');
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const lock = path.resolve(repo, spawnSync('git', ['-C', repo, 'rev-parse', '--git-path', 'gentle-lite-graphify.lock'], { encoding: 'utf8' }).stdout.trim());
  return { root, repo, lock };
}

test('a lock held by Node makes the Python merge fail fast with a clear message', async () => {
  const { root, repo, lock } = await gitRepo();
  const release = await takeLock(lock);
  assert.ok(release, 'node took the lock');
  try {
    const r = spawnSync('python3', ['-P', '-m', 'gentle_lite.graph.semantic_plan', 'merge', '--repo', repo], { env: { ...process.env, PYTHONPATH }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 75, r.stderr); // EX_TEMPFAIL: lock held, retry later
    assert.match(r.stderr, /already running/);
    assert.ok(await exists(lock), 'the python run did not touch the node-held lock');
  } finally {
    await release();
    await rm(root, { recursive: true, force: true });
  }
});

test('a lock held by Python makes the Node takeLock return null, and Node can take it after release', async () => {
  const { root, repo, lock } = await gitRepo();
  const holder = py('import sys, time\nfrom pathlib import Path\nfrom gentle_lite.graph.lock import graphify_lock\nwith graphify_lock(Path(sys.argv[1])):\n    print("held", flush=True)\n    sys.stdin.readline()\n', [repo], { stdio: ['pipe', 'pipe', 'inherit'] });
  const child = spawn(holder.cmd, holder.args, holder.opts);
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`holder exited early (${code})`)));
    });
    assert.equal(await takeLock(lock), null, 'fails fast, does not steal a live python lock');
    assert.ok(await exists(lock));
    const closed = new Promise((resolve) => child.once('exit', resolve));
    child.stdin.end('\n');
    await closed;
    const release = await takeLock(lock);
    assert.ok(release, 'free after the python holder released it');
    await release();
  } finally {
    child.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
});

test('takeLock records `<pid> <start token>` exactly like the Python helper, and release removes the lock', async () => {
  const { root, repo, lock } = await gitRepo();
  try {
    const release = await takeLock(lock);
    assert.ok(release);
    const fields = (await readFile(path.join(lock, 'pid'), 'utf8')).trim().split(/\s+/);
    assert.equal(fields[0], String(process.pid));
    const p = py('import os\nfrom gentle_lite.graph.lock import start_token\nprint(start_token(int(os.environ["PID"])))', [], { env: { ...process.env, PYTHONPATH, PID: String(process.pid) }, encoding: 'utf8' });
    const expected = spawnSync(p.cmd, p.args, p.opts).stdout.trim();
    assert.equal(fields[1] ?? '', expected, 'same token format as the shell hook and Python');
    await release();
    assert.equal(await exists(lock), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('semantic.js has no lock protocol of its own (no stale rule or pid parsing)', async () => {
  const text = await readFile(path.join(repoRoot, 'src', 'graphify', 'semantic.js'), 'utf8');
  assert.doesNotMatch(text, /STALE_LOCK|pidAlive|mkdir\(lock/);
  assert.match(text, /gentle_lite\.graph\.lock/);
});

test('the lock helper runs with a minimal environment: no ANTHROPIC_API_KEY or other secrets', async () => {
  const { root, lock } = await gitRepo();
  const realPython = spawnSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
  const bin = path.join(root, 'bin');
  const seen = path.join(root, 'env.txt');
  await mkdir(bin);
  await writeFile(path.join(bin, 'python3'), `#!/bin/sh\nenv > '${seen}'\nexec '${realPython}' "$@"\n`);
  await chmod(path.join(bin, 'python3'), 0o755);
  const saved = { PATH: process.env.PATH, KEY: process.env.ANTHROPIC_API_KEY, OTHER: process.env.GL_OTHER_SECRET };
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-CANARY-0123456789abcdef';
  process.env.GL_OTHER_SECRET = 'other-canary';
  try {
    const release = await takeLock(lock);
    assert.ok(release, 'took the lock');
    await release();
    const env = await readFile(seen, 'utf8');
    assert.ok(!env.includes('CANARY') && !env.includes('ANTHROPIC_API_KEY') && !env.includes('GL_OTHER_SECRET'), 'no secret reached the helper');
    assert.match(env, /^PYTHONPATH=/m);
    assert.match(env, /^PATH=/m);
  } finally {
    process.env.PATH = saved.PATH;
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.KEY], ['GL_OTHER_SECRET', saved.OTHER]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await rm(root, { recursive: true, force: true });
  }
});
