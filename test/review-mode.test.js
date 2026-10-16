import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { modeStatus, setMode } from '../src/review/mode.js';
import { main } from '../src/cli.js';
import { makeRepo } from './helpers/repo.js';

const sink = () => {
  let out = '';
  return { stream: { write: (s) => { out += s; } }, get text() { return out; } };
};

test('default is off; enable/disable global persist in state.json and keep other keys', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'gl-mode-'));
  assert.deepEqual(await modeStatus({ stateDir }), { effective: 'off', source: 'default', global: 'unset', clone: 'unset' });
  await writeFile(path.join(stateDir, 'state.json'), JSON.stringify({ persona: 'neutral' }));
  assert.equal((await setMode('on', { stateDir })).effective, 'on');
  const state = JSON.parse(await readFile(path.join(stateDir, 'state.json'), 'utf8'));
  assert.equal(state.rdd_mode, 'on');
  assert.equal(state.persona, 'neutral');
  assert.equal((await setMode('off', { stateDir })).effective, 'off');
  await rm(stateDir, { recursive: true });
});

test('clone-local off wins over global on; clone enable clears it; status is read-only', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'gl-mode-'));
  const repo = await makeRepo();
  await setMode('on', { stateDir });
  const s = await setMode('off', { scope: 'clone', cwd: repo.dir, stateDir });
  assert.deepEqual([s.effective, s.source, s.clone, s.global], ['off', 'clone', 'off', 'on']);
  assert.equal((await readFile(path.join(repo.dir, '.git', 'amauta-rdd-mode'), 'utf8')).trim(), 'off');
  const before = await readFile(path.join(stateDir, 'state.json'), 'utf8');
  await modeStatus({ cwd: repo.dir, stateDir });
  assert.equal(await readFile(path.join(stateDir, 'state.json'), 'utf8'), before);
  assert.equal((await setMode('on', { scope: 'clone', cwd: repo.dir, stateDir })).effective, 'on');
  await rm(stateDir, { recursive: true });
  await rm(repo.dir, { recursive: true });
});

test('CLI: review mode enable/status and review assess --json', async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'gl-mode-'));
  const repo = await makeRepo();
  await repo.write('src/auth/x.js', 'x\n');
  repo.commit();
  let o = sink();
  assert.equal(await main(['review', 'mode', 'enable', '--state-dir', stateDir, '--cwd', repo.dir], { stdout: o.stream, stderr: o.stream }), 0);
  o = sink();
  await main(['review', 'mode', 'status', '--state-dir', stateDir, '--cwd', repo.dir], { stdout: o.stream, stderr: o.stream });
  assert.match(o.text, /receipt-driven development: on \(decided by global\)\n {2}global: on\n {2}clone-local: unset/);
  o = sink();
  assert.equal(await main(['review', 'assess', '--cwd', repo.dir, '--base-ref', 'HEAD~1', '--committed-only', '--json'], { stdout: o.stream, stderr: o.stream }), 0);
  const res = JSON.parse(o.text);
  assert.equal(res.risk, 'high');
  assert.equal(res.review_due_reason, 'high_risk');
  o = sink();
  assert.equal(await main(['review', 'mode', 'bogus'], { stdout: o.stream, stderr: o.stream }), 1);
  await rm(stateDir, { recursive: true });
  await rm(repo.dir, { recursive: true });
});
