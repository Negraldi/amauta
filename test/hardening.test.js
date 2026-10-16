import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assess } from '../src/review/assess.js';
import { setMode } from '../src/review/mode.js';
import { makeRepo, git } from './helpers/repo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'src', 'mcp', 'server.js');
const bin = path.join(root, 'bin', 'amauta.js');
const exists = (p) => stat(p).then(() => true, () => false);
const tmp = (p) => mkdtemp(path.join(os.tmpdir(), p));

function exchange(lines, script = server) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => resolve(out.split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    for (const l of lines) child.stdin.write(`${typeof l === 'string' ? l : JSON.stringify(l)}\n`);
    child.stdin.end();
  });
}
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

const BAD_REFS = (out) => [`--output=${out}`, '-p', '--stat', 'a..b', 'a...b', 'HEAD ~1', 'HEAD\n--output=x', '', 'HEAD\u0000', 'ma{in}'];

test('assess rejects option-shaped and range-shaped base refs and writes no file', async () => {
  const repo = await makeRepo();
  const dir = await tmp('gl-inj-');
  const out = path.join(dir, 'pwn');
  for (const ref of BAD_REFS(out)) {
    await assert.rejects(assess({ cwd: repo.dir, baseRef: ref }), /base ref|invalid/i, JSON.stringify(ref));
    await assert.rejects(assess({ cwd: repo.dir, baseRef: ref, committedOnly: true }), /base ref|invalid/i, JSON.stringify(ref));
  }
  await assert.rejects(assess({ cwd: repo.dir, baseRef: 5 }), /base ref/i);
  assert.ok(!(await exists(out)), 'no file created');
  await rm(dir, { recursive: true });
  await rm(repo.dir, { recursive: true });
});

test('assess accepts branches, shas and relative refs, and rejects unknown refs', async () => {
  const repo = await makeRepo();
  await repo.write('src/auth/a.js', 'x\n');
  repo.commit();
  git(repo.dir, 'branch', 'base', 'HEAD~1');
  const parent = git(repo.dir, 'rev-parse', 'HEAD~1').trim();
  for (const ref of ['HEAD~1', 'base', 'main~1', parent, parent.slice(0, 8), 'HEAD^']) {
    assert.equal((await assess({ cwd: repo.dir, baseRef: ref, committedOnly: true })).risk, 'high', ref);
  }
  await assert.rejects(assess({ cwd: repo.dir, baseRef: 'no-such-ref' }));
  await rm(repo.dir, { recursive: true });
});

test('CLI review assess rejects an injected --base-ref with exit 1 and no file', async () => {
  const dir = await tmp('gl-inj-');
  const out = path.join(dir, 'pwn');
  const r = spawnSync(process.execPath, [bin, 'review', 'assess', '--cwd', root, `--base-ref=--output=${out}`, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /base ref/i);
  assert.ok(!(await exists(out)));
  await rm(dir, { recursive: true });
});

test('MCP review_assess rejects injected and mistyped arguments', async () => {
  const repo = await makeRepo();
  const dir = await tmp('gl-inj-');
  const out = path.join(dir, 'pwn');
  const res = await exchange([
    call(1, 'review_assess', { cwd: repo.dir, base_ref: `--output=${out}` }),
    call(2, 'review_assess', { cwd: repo.dir, base_ref: 7 }),
    call(3, 'review_assess', { cwd: repo.dir, committed_only: 'yes' }),
    call(4, 'review_assess', { cwd: 'relative/dir' }),
    call(5, 'review_assess', { cwd: path.join(repo.dir, 'missing') }),
    call(6, 'review_assess', { cwd: path.join(repo.dir, 'README.md') }),
    call(7, 'review_assess', { cwd: 42 }),
    call(8, 'review_assess', null),
  ]);
  const messages = [/base ref/, /base_ref/, /committed_only/, /absolute/, /directory|exist/, /directory/, /cwd/, /object/];
  res.forEach((r, i) => {
    assert.equal(r.result.isError, true, `case ${i + 1}`);
    assert.match(r.result.content[0].text, messages[i], `case ${i + 1}`);
  });
  assert.ok(!(await exists(out)));
  await rm(dir, { recursive: true });
  await rm(repo.dir, { recursive: true });
});

test('odd_tasks_status maps only ENOENT to empty; other read errors surface', async () => {
  const dir = await tmp('gl-odd-');
  await mkdir(path.join(dir, 'odd'), { recursive: true });
  await writeFile(path.join(dir, 'odd', 'tasks'), 'i am a file, not a directory');
  const [bad] = await exchange([call(1, 'odd_tasks_status', { cwd: dir })]);
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /ENOTDIR/);
  const empty = await tmp('gl-odd-');
  const [ok] = await exchange([call(1, 'odd_tasks_status', { cwd: empty })]);
  assert.deepEqual(JSON.parse(ok.result.content[0].text), { files: [], next: null });
  await rm(dir, { recursive: true });
  await rm(empty, { recursive: true });
});

test('the server starts when launched through a symlinked path', async () => {
  const dir = await tmp('gl-link-');
  const link = path.join(dir, 'server-link.js');
  await symlink(server, link);
  const res = await exchange([{ jsonrpc: '2.0', id: 1, method: 'ping' }], link);
  assert.deepEqual(res, [{ jsonrpc: '2.0', id: 1, result: {} }]);
  await rm(dir, { recursive: true });
});

test('protocol error replies keep arrival order with earlier valid requests', async () => {
  const dir = await tmp('gl-ord-');
  const res = await exchange([call(1, 'odd_tasks_status', { cwd: dir }), '{oops', '[1]', { jsonrpc: '2.0', id: 4, method: 'ping' }]);
  assert.deepEqual(res.map((r) => r.id), [1, null, null, 4]);
  assert.equal(res[1].error.code, -32700);
  assert.equal(res[2].error.code, -32600);
  await rm(dir, { recursive: true });
});

test('review mode enable works when the state directory does not exist yet', async () => {
  const base = await tmp('gl-mode-');
  const stateDir = path.join(base, 'not', 'yet');
  assert.equal((await setMode('on', { stateDir })).effective, 'on');
  await rm(base, { recursive: true });
});
