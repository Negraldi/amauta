// Per-project trust and the project check at Stop (plan D6, ADR 0006). Checkers that execute repository code (tsc,
// eslint, mypy, cargo) run only in a project the user trusted; the safe checkers always run over the changed files.
// Errors are reported only for changed files and only when the committed version did not already have them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isTrusted, setTrust, trustedProjects } from '../src/checks/trust.js';
import { parseLine, PROJECT_CHECKERS } from '../src/checks/project.js';
import { dispatchEvent } from '../src/hooks/dispatch.js';
import { main } from '../src/cli.js';
import { tempDir } from './helpers/tmp.js';
import { PY } from './helpers/python.js';

const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const write = async (dir, name, text, mode) => { const f = path.join(dir, name); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, text); if (mode) await chmod(f, mode); return f; };

async function project() {
  const dir = await tempDir('proj-');
  for (const args of [['init', '-q', '.'], ['config', 'user.email', 'a@b.c'], ['config', 'user.name', 'T'], ['config', 'commit.gpgsign', 'false']]) git(dir, ...args);
  await write(dir, 'tsconfig.json', '{}\n');
  await write(dir, 'src/old.ts', 'export const a = 1;\n');
  await write(dir, 'README.md', '# p\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  const bin = path.join(dir, '.fakebin');
  // A fake tsc on PATH: one error in a changed file, one in an untouched file.
  await write(bin, 'tsc', '#!/bin/sh\necho "src/old.ts(1,14): error TS2322: Type \'string\' is not assignable to type \'number\'."\necho "src/other.ts(2,1): error TS1005: \';\' expected."\nexit 2\n', 0o755);
  return { dir, bin };
}

test('the trust list is per project, stored in the state directory, and can be revoked', async () => {
  const stateDir = await tempDir('trust-');
  const { dir } = await project();
  assert.equal(await isTrusted(stateDir, dir), false);
  await setTrust(stateDir, dir, true);
  assert.equal(await isTrusted(stateDir, path.join(dir, 'src')), true, 'a subdirectory belongs to the trusted project');
  assert.deepEqual((await trustedProjects(stateDir)).map((p) => p.path), [dir]);
  await setTrust(stateDir, dir, false);
  assert.equal(await isTrusted(stateDir, dir), false);
});

test('trust records the hash of the pipelines file, so a changed definition needs trust again (ADR 0011)', async () => {
  const { createHash } = await import('node:crypto');
  const stateDir = await tempDir('trust-');
  const { dir } = await project();
  await write(dir, '.amauta/pipelines.json', '{"pipelines": []}\n');
  await setTrust(stateDir, dir, true);
  const [rec] = await trustedProjects(stateDir);
  assert.equal(rec.pipelines_sha256, createHash('sha256').update('{"pipelines": []}\n').digest('hex'));
  const other = (await project()).dir;
  await setTrust(stateDir, other, true);
  assert.equal((await trustedProjects(stateDir)).find((p) => p.path === other).pipelines_sha256, null, 'no pipelines file');
});

test('checker output lines become findings', () => {
  const by = Object.fromEntries(PROJECT_CHECKERS.map((c) => [c.name, c]));
  assert.deepEqual(parseLine(by.tsc, "src/a.ts(3,5): error TS2322: Type 'x' is wrong."), { file: 'src/a.ts', line: 3, col: 5, severity: 'error', message: "TS2322: Type 'x' is wrong." });
  assert.deepEqual(parseLine(by.mypy, 'pkg/m.py:7:2: error: Name "y" is not defined  [name-defined]'), { file: 'pkg/m.py', line: 7, col: 2, severity: 'error', message: 'Name "y" is not defined  [name-defined]' });
  assert.deepEqual(parseLine(by.cargo, 'src/main.rs:4:9: error[E0308]: mismatched types'), { file: 'src/main.rs', line: 4, col: 9, severity: 'error', message: 'E0308: mismatched types' });
  assert.deepEqual(parseLine(by.eslint, '/p/src/a.js:2:1: Unexpected var [Error/no-var]'), { file: '/p/src/a.js', line: 2, col: 1, severity: 'error', message: 'Unexpected var [Error/no-var]' });
  assert.equal(parseLine(by.tsc, 'Found 2 errors.'), null);
});

test('at Stop: safe checks over changed files always; tsc only when trusted; only changed files are reported', async () => {
  const { dir, bin } = await project();
  const stateDir = await tempDir('trust-');
  await write(dir, 'src/old.ts', 'export const a: number = "x";\n');
  await write(dir, 'conf.json', '{"a": 1,}\n');
  const stop = () => dispatchEvent({ event: 'Stop', names: ['checks'], stateDir, python: PY,
    payload: { hook_event_name: 'Stop', session_id: 's1', cwd: dir, stop_hook_active: false }, searchPath: bin });
  const untrusted = await stop();
  assert.equal(untrusted.decision, 'block');
  assert.match(untrusted.reason, /conf\.json:1:\d+: error: .+ \[json\]/);
  assert.doesNotMatch(untrusted.reason, /\[tsc\]/, 'tsc executes repository code: not without trust');
  assert.match(untrusted.reason, /amauta check trust/, 'says how to enable the project checkers');
  await setTrust(stateDir, dir, true);
  const trusted = await stop();
  assert.match(trusted.reason, /src\/old\.ts:1:14: error: TS2322: .+ \[tsc\]/);
  assert.doesNotMatch(trusted.reason, /other\.ts/, 'an untouched file is not this session\'s problem');
});

test('a clean tree stops quietly; outside a git repository nothing runs', async () => {
  const { dir, bin } = await project();
  const stateDir = await tempDir('trust-');
  const quiet = await dispatchEvent({ event: 'Stop', names: ['checks'], stateDir, python: PY, searchPath: bin,
    payload: { hook_event_name: 'Stop', session_id: 's2', cwd: dir } });
  assert.equal(quiet, null);
  const outside = await tempDir('nogit-');
  assert.equal(await dispatchEvent({ event: 'Stop', names: ['checks'], stateDir, python: PY, payload: { hook_event_name: 'Stop', session_id: 's3', cwd: outside } }), null);
});

test('amauta check trust|untrust|status', async () => {
  const { dir } = await project();
  const stateDir = await tempDir('trust-');
  const io = { stdout: sink(), stderr: sink() };
  assert.equal(await main(['check', 'trust', '--cwd', dir, '--state-dir', stateDir], io), 0);
  assert.match(io.stdout.text, /trusted .*tsc/s);
  assert.equal(await isTrusted(stateDir, dir), true);
  const st = { stdout: sink(), stderr: sink() };
  assert.equal(await main(['check', 'status', '--cwd', dir, '--state-dir', stateDir], st), 0);
  assert.match(st.stdout.text, /trusted: yes/);
  assert.equal(await main(['check', 'untrust', '--cwd', dir, '--state-dir', stateDir], io), 0);
  assert.equal(await isTrusted(stateDir, dir), false);
  const bad = { stdout: sink(), stderr: sink() };
  assert.equal(await main(['check', 'trust', '--cwd', await tempDir('nogit-'), '--state-dir', stateDir], bad), 1);
  assert.match(bad.stderr.text, /not inside a git repository/);
});
