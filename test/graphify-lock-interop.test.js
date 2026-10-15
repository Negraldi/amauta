import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
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
