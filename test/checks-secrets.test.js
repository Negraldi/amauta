// Secrets in edited code and the security scanners at Stop (plan D7, ADR 0006/0007). The secrets checker uses the
// kernel detector catalog and never prints the value; gitleaks, bandit and semgrep run when installed (they read code,
// they do not execute it) and semgrep only with the project's own rules, metrics off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkFile, checkersFor } from '../src/checks/engine.js';
import { SAFE_CHECKERS } from '../src/checks/safe.js';
import { PROJECT_CHECKERS, parseOutput } from '../src/checks/project.js';
import { dispatchEvent } from '../src/hooks/dispatch.js';
import { tempDir } from './helpers/tmp.js';
import { PY } from './helpers/python.js';

const SECRET = 'AKIA' + 'Q'.repeat(16);
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const write = async (dir, name, text, mode) => { const f = path.join(dir, name); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, text); if (mode) await chmod(f, mode); return f; };

test('the secrets checker applies to any text file, reports the line, never the value', async () => {
  const dir = await tempDir('sec-');
  const file = await write(dir, 'config/settings.yaml', `name: app\naws_key: ${SECRET}\n`);
  const found = await checkFile(file, checkersFor(file, SAFE_CHECKERS), { python: PY, timeoutMs: 10000 });
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].checker, found[0].line], ['secrets', 2]);
  assert.match(found[0].message, /secret/);
  assert.doesNotMatch(JSON.stringify(found), new RegExp(SECRET));
  const clean = await write(dir, 'b.txt', 'nothing here\n');
  assert.deepEqual(await checkFile(clean, checkersFor(clean, SAFE_CHECKERS), { python: PY, timeoutMs: 10000 }), []);
});

test('scanner output becomes findings: gitleaks JSON, bandit and semgrep lines', () => {
  const by = Object.fromEntries(PROJECT_CHECKERS.map((c) => [c.name, c]));
  for (const name of ['gitleaks', 'bandit', 'semgrep']) assert.equal(by[name].trust, false, `${name} reads code only`);
  for (const name of ['tsc', 'eslint', 'mypy', 'cargo']) assert.equal(by[name].trust, true, `${name} executes project code`);
  const leaks = JSON.stringify([{ File: 'src/a.py', StartLine: 4, StartColumn: 9, RuleID: 'aws-access-token', Description: 'AWS key', Secret: 'REDACTED' }]);
  assert.deepEqual(parseOutput(by.gitleaks, leaks), [{ file: 'src/a.py', line: 4, col: 9, severity: 'error', message: 'aws-access-token: AWS key' }]);
  assert.deepEqual(parseOutput(by.bandit, '/r/src/a.py:3:0: B602 subprocess call with shell=True\n'),
    [{ file: '/r/src/a.py', line: 3, col: 1, severity: 'error', message: 'B602 subprocess call with shell=True' }]);
  assert.deepEqual(parseOutput(by.semgrep, 'src/a.js:7:3:error(no-eval):eval is dangerous\n'),
    [{ file: 'src/a.js', line: 7, col: 3, severity: 'error', message: 'no-eval: eval is dangerous' }]);
});

test('at Stop, installed scanners run without trust and a committed secret is not reported again', async () => {
  const dir = await tempDir('sec-');
  for (const args of [['init', '-q', '.'], ['config', 'user.email', 'a@b.c'], ['config', 'user.name', 'T'], ['config', 'commit.gpgsign', 'false']]) git(dir, ...args);
  await write(dir, 'old.env.example', `KEY=${SECRET}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  await write(dir, 'old.env.example', `KEY=${SECRET}\nOTHER=1\n`);
  await write(dir, 'app.py', 'import subprocess\nsubprocess.call("ls", shell=True)\n');
  const bin = path.join(dir, '.fakebin');
  await write(bin, 'bandit', '#!/bin/sh\nfor f in "$@"; do case "$f" in *.py) echo "$f:2:0: B602 subprocess call with shell=True";; esac; done\nexit 1\n', 0o755);
  const stateDir = await tempDir('sec-state-');
  const d = await dispatchEvent({ event: 'Stop', names: ['checks'], stateDir, python: PY, searchPath: bin,
    payload: { hook_event_name: 'Stop', session_id: 's', cwd: dir } });
  assert.equal(d.decision, 'block');
  assert.match(d.reason, /app\.py:2:1: error: B602 .+ \[bandit\]/);
  assert.doesNotMatch(d.reason, /old\.env\.example/, 'the secret was already committed');
  assert.doesNotMatch(d.reason, new RegExp(SECRET));
  assert.doesNotMatch(d.reason, /amauta check trust/, 'bandit needs no trust');
});
