import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { reviewStop } from '../src/review/stop.js';
import { setMode } from '../src/review/mode.js';
import { makeRepo } from './helpers/repo.js';

async function setup({ mode = 'on' } = {}) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'gl-stop-'));
  const repo = await makeRepo({ 'README.md': '# x\n', 'lib/a.js': 'a\n' });
  if (mode) await setMode(mode, { stateDir });
  const env = { GENTLE_LITE_STATE_DIR: stateDir };
  const fire = (event, extra = {}) =>
    reviewStop({ hook_event_name: event, session_id: 's1', cwd: repo.dir, ...extra }, env);
  return { stateDir, repo, fire, cleanup: () => Promise.all([rm(stateDir, { recursive: true }), rm(repo.dir, { recursive: true })]) };
}

test('SessionStart stores a baseline file per session and prints nothing', async () => {
  const t = await setup();
  assert.equal(await t.fire('SessionStart'), null);
  assert.deepEqual(await readdir(path.join(t.stateDir, 'review-stop')), ['s1.json']);
  await t.cleanup();
});

test('Stop blocks once for a high-risk candidate, then stays quiet for the same candidate', async () => {
  const t = await setup();
  await t.fire('SessionStart');
  await t.repo.write('src/auth/login.js', 'x\n');
  t.repo.commit();
  const first = await t.fire('Stop');
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /gentle-lite review assess/);
  assert.equal(await t.fire('Stop'), null);
  await t.repo.write('src/auth/login.js', 'y\n');
  t.repo.commit();
  assert.equal((await t.fire('Stop')).decision, 'block'); // new candidate
  await t.cleanup();
});

test('no block when unchanged, untracked-only, not due, mode off, or stop_hook_active', async () => {
  const t = await setup();
  await t.fire('SessionStart');
  assert.equal(await t.fire('Stop'), null);
  await t.repo.write('src/auth/new.js', 'x\n'); // untracked
  assert.equal(await t.fire('Stop'), null);
  await rm(path.join(t.repo.dir, 'src'), { recursive: true });
  await t.repo.write('README.md', '# docs\n'); // tracked, passive
  assert.equal(await t.fire('Stop'), null);
  t.repo.commit();
  await t.repo.write('lib/a.js', 'a2\n'); // tracked medium, under budget
  assert.equal(await t.fire('Stop'), null);
  await t.repo.write('lib/a.js', 'x\n'.repeat(500));
  assert.equal(await t.fire('Stop', { stop_hook_active: true }), null);
  await setMode('off', { stateDir: t.stateDir });
  assert.equal(await t.fire('Stop'), null);
  await setMode('on', { stateDir: t.stateDir });
  assert.equal((await t.fire('Stop')).decision, 'block'); // medium over budget now blocks
  await t.cleanup();
});

test('Stop without a SessionStart baseline is a no-op', async () => {
  const t = await setup();
  await t.repo.write('src/auth/x.js', 'x\n');
  t.repo.commit();
  assert.equal(await t.fire('Stop'), null);
  await t.cleanup();
});

test('resume and compact keep the baseline; startup and clear rebaseline', async () => {
  const t = await setup();
  await t.fire('SessionStart', { source: 'startup' });
  await t.repo.write('src/auth/login.js', 'x\n');
  t.repo.commit();
  await t.fire('SessionStart', { source: 'compact' });
  await t.fire('SessionStart', { source: 'resume' });
  assert.equal((await t.fire('Stop')).decision, 'block', 'pre-compact changes still reviewed');
  await t.fire('SessionStart', { source: 'compact' });
  assert.equal(await t.fire('Stop'), null, 'notified list survives compact');
  await t.fire('SessionStart', { source: 'clear' });
  assert.equal(await t.fire('Stop'), null, 'clear rebaselines to the current state');
  await t.cleanup();
});

test('a non-git cwd writes no baseline; a repo with no commits yet does', async () => {
  const t = await setup();
  const plain = await mkdtemp(path.join(os.tmpdir(), 'gl-plain-'));
  const env = { GENTLE_LITE_STATE_DIR: t.stateDir };
  await reviewStop({ hook_event_name: 'SessionStart', session_id: 'plain', cwd: plain }, env);
  assert.deepEqual(await readdir(path.join(t.stateDir, 'review-stop')).catch(() => []), []);

  const fresh = await mkdtemp(path.join(os.tmpdir(), 'gl-fresh-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fresh });
  await reviewStop({ hook_event_name: 'SessionStart', session_id: 'fresh', cwd: fresh }, env);
  const base = JSON.parse(await readFile(path.join(t.stateDir, 'review-stop', 'fresh.json'), 'utf8'));
  assert.equal(base.head, null);
  await Promise.all([rm(plain, { recursive: true }), rm(fresh, { recursive: true }), t.cleanup()]);
});

test('SessionStart with a missing or unknown source rebaselines; only resume and compact keep the baseline', async () => {
  const t = await setup();
  await t.fire('SessionStart', { source: 'startup' });
  await t.repo.write('src/auth/login.js', 'x\n');
  t.repo.commit();
  await t.fire('SessionStart'); // no source field
  assert.equal(await t.fire('Stop'), null, 'missing source starts from the current state');
  await t.repo.write('src/auth/login.js', 'y\n');
  t.repo.commit();
  await t.fire('SessionStart', { source: 'something-new' });
  assert.equal(await t.fire('Stop'), null, 'unknown source starts from the current state');
  await t.cleanup();
});
