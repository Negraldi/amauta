// The checks engine (plan D5, ADR 0006): compiler-like findings after an edit. Safe checkers never execute repository
// code; the baseline is the file's last committed version, so only errors the edit added block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { formatFinding, newFindings, checkFile, checkersFor } from '../src/checks/engine.js';
import { SAFE_CHECKERS } from '../src/checks/safe.js';
import { dispatchEvent } from '../src/hooks/dispatch.js';
import { tempDir } from './helpers/tmp.js';
import { PY } from './helpers/python.js';

const opts = { python: PY, timeoutMs: 10000 };
const write = async (dir, name, text) => { const f = path.join(dir, name); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, text); return f; };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });

async function repo() {
  const dir = await tempDir('checks-');
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 'a@b.c');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

test('one finding format: file:line:col: severity: message [checker]', () => {
  assert.equal(formatFinding({ file: 'src/a.js', line: 3, col: 5, severity: 'error', message: 'Unexpected token', checker: 'node' }),
    'src/a.js:3:5: error: Unexpected token [node]');
});

test('new findings are what the baseline lacks, compared by checker and message, not by line', () => {
  const f = (message, line) => ({ checker: 'x', message, line, col: 1, severity: 'error', file: 'a' });
  assert.deepEqual(newFindings([f('A', 9), f('B', 10), f('B', 20)], [f('A', 1), f('B', 2)]).map((x) => [x.message, x.line]), [['B', 20]]);
});

test('each safe checker reports a syntax error with its line', async () => {
  const dir = await tempDir('checks-');
  const cases = [
    ['bad.json', '{\n  "a": 1,\n}\n', 3, 'json'],
    ['bad.js', 'const a = 1;\nlet b = ;\n', 2, 'node'],
    ['bad.py', 'def f():\n    return (\n\nx = 1\n', 2, 'python'],
    ['bad.toml', 'a = 1\nb = = 2\n', 2, 'toml'],
    ['bad.sh', 'if true; then\n  echo x\n', 3, 'sh'],
  ];
  for (const [name, text, line, checker] of cases) {
    const file = await write(dir, name, text);
    const found = await checkFile(file, checkersFor(file, SAFE_CHECKERS), opts);
    assert.equal(found.length, 1, `${name}: ${JSON.stringify(found)}`);
    assert.equal(found[0].checker, checker, name);
    assert.equal(found[0].line, line, `${name}: ${found[0].message}`);
    assert.equal(found[0].severity, 'error');
  }
  for (const [name, text] of [['ok.json', '{"a": 1}\n'], ['ok.js', 'export const a = 1;\n'], ['ok.py', 'x = 1\n'], ['ok.toml', 'a = 1\n'], ['ok.sh', 'echo ok\n']]) {
    const file = await write(dir, name, text);
    assert.deepEqual(await checkFile(file, checkersFor(file, SAFE_CHECKERS), opts), [], name);
  }
  assert.deepEqual(checkersFor(path.join(dir, 'notes.txt'), SAFE_CHECKERS).map((c) => c.name), ['secrets'], 'any text file: secrets only (plan D7)');
});

test('the edit hook blocks with the new errors only, and stays silent for old errors, other tools and clean files', async () => {
  const dir = await repo();
  const file = await write(dir, 'conf.json', '{"a": 1,}\n'); // broken in HEAD already
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  const stateDir = await tempDir('checks-state-');
  const edit = (f) => dispatchEvent({ event: 'PostToolUse', names: ['checks'], stateDir, python: PY,
    payload: { hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: dir, tool_input: { file_path: f } } });
  assert.equal(await edit(file), null, 'the error was already committed: not this edit');
  const fresh = await write(dir, 'new.py', 'def f(:\n    pass\n');
  const d = await edit(fresh);
  assert.equal(d.decision, 'block');
  assert.match(d.reason, /new\.py:1:\d+: error: .+ \[python\]/);
  assert.match(d.reason, /amauta checks/);
  await write(dir, 'new.py', 'def f():\n    pass\n');
  assert.equal(await edit(fresh), null, 'fixed');
  const other = await dispatchEvent({ event: 'PostToolUse', names: ['checks'], stateDir, python: PY,
    payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: dir, tool_input: { command: 'ls' } } });
  assert.equal(other, null);
});

test('a checker that cannot run or runs too long is skipped (fail open)', async () => {
  const dir = await tempDir('checks-');
  const file = await write(dir, 'bad.py', 'def f(:\n');
  assert.deepEqual(await checkFile(file, checkersFor(file, SAFE_CHECKERS), { python: path.join(dir, 'no-python'), timeoutMs: 5000 }), []);
  const slow = { name: 'slow', exts: ['.py'], run: () => new Promise((r) => setTimeout(() => r([{ line: 1, col: 1, message: 'late' }]), 500)) };
  assert.deepEqual(await checkFile(file, [slow], { python: PY, timeoutMs: 50 }), []);
});
