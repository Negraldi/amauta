import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageVersion } from '../src/version.js';
import { desiredMcpServers } from '../src/install/servers.js';
import { makeRepo } from './helpers/repo.js';

const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp', 'server.js');

/** Spawn the server, send JSON-RPC lines, resolve with the parsed responses once stdin closes. */
function exchange(lines, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', () => resolve(out.split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    for (const l of lines) child.stdin.write(`${typeof l === 'string' ? l : JSON.stringify(l)}\n`);
    child.stdin.end();
  });
}
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const call = (id, name, args) => rpc(id, 'tools/call', { name, arguments: args });
const payload = (res) => JSON.parse(res.result.content[0].text);

test('the installer registers exactly this server path', () => {
  assert.deepEqual(desiredMcpServers()['gentle-lite'], { type: 'stdio', command: 'node', args: [server] });
});

test('initialize answers with name, version and tools capability; notifications get no reply', async () => {
  const res = await exchange([
    rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    rpc(2, 'ping'),
  ]);
  assert.equal(res.length, 2);
  assert.equal(res[0].id, 1);
  assert.equal(res[0].result.serverInfo.name, 'gentle-lite');
  assert.equal(res[0].result.serverInfo.version, packageVersion());
  assert.equal(res[0].result.protocolVersion, '2025-06-18');
  assert.ok(res[0].result.capabilities.tools);
  assert.deepEqual(res[1], { jsonrpc: '2.0', id: 2, result: {} });
});

test('tools/list exposes the four tools with input schemas', async () => {
  const [res] = await exchange([rpc(1, 'tools/list')]);
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['odd_tasks_status', 'review_assess', 'review_mode_status', 'skill_registry_refresh']);
  for (const t of res.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.inputSchema.required.includes('cwd'));
    assert.ok(t.description);
  }
});

test('protocol errors: parse error, unknown method, unknown tool, missing cwd', async () => {
  const res = await exchange(['{oops', rpc(1, 'nope'), call(2, 'nope', {}), call(3, 'review_mode_status', {})]);
  assert.equal(res[0].error.code, -32700);
  assert.equal(res[0].id, null);
  assert.equal(res[1].error.code, -32601);
  assert.equal(res[2].error.code, -32602);
  assert.equal(res[3].result.isError, true);
  assert.match(res[3].result.content[0].text, /cwd/);
});

test('review_assess and review_mode_status run against a temp repo', async () => {
  const repo = await makeRepo();
  await repo.write('src/auth/a.js', 'x\n');
  repo.commit();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'gl-mcp-state-'));
  const res = await exchange(
    [
      call(1, 'review_assess', { cwd: repo.dir, base_ref: 'HEAD~1', committed_only: true }),
      call(2, 'review_mode_status', { cwd: repo.dir }),
    ],
    { GENTLE_LITE_STATE_DIR: stateDir },
  );
  assert.equal(payload(res[0]).risk, 'high');
  assert.equal(payload(res[0]).review_due, true);
  assert.deepEqual(payload(res[1]), { effective: 'off', source: 'default', global: 'unset', clone: 'unset' });
  await rm(repo.dir, { recursive: true });
  await rm(stateDir, { recursive: true });
});

test('skill_registry_refresh writes the registry for a project', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-mcp-'));
  const home = path.join(root, 'claude');
  const project = path.join(root, 'proj');
  await mkdir(path.join(home, 'skills', 'foo'), { recursive: true });
  await writeFile(path.join(home, 'skills', 'foo', 'SKILL.md'), '---\nname: foo\ndescription: d\n---\n');
  await mkdir(project);
  await writeFile(path.join(project, 'package.json'), '{}');
  const [res] = await exchange([call(1, 'skill_registry_refresh', { cwd: project })], { GENTLE_LITE_CLAUDE_HOME: home });
  const out = payload(res);
  assert.equal(out.status, 'refreshed');
  assert.equal(out.count, 1);
  assert.equal(out.path, path.join(project, '.atl', 'skill-registry.md'));
  await rm(root, { recursive: true });
});

test('odd_tasks_status reports per-file progress and the next unchecked item', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-mcp-'));
  await mkdir(path.join(root, 'odd', 'tasks'), { recursive: true });
  await writeFile(path.join(root, 'odd', 'tasks', 'a.md'), '# A\n- [x] T1 done\n- [ ] T2 next\n  - [ ] T3 later\n');
  await writeFile(path.join(root, 'odd', 'tasks', 'b.md'), '- [X] only\n');
  await writeFile(path.join(root, 'odd', 'tasks', 'notes.txt'), '- [ ] ignored\n');
  const [res] = await exchange([call(1, 'odd_tasks_status', { cwd: root })]);
  assert.deepEqual(payload(res), {
    files: [
      { file: 'odd/tasks/a.md', done: 1, total: 3, next: 'T2 next' },
      { file: 'odd/tasks/b.md', done: 1, total: 1, next: null },
    ],
    next: { file: 'odd/tasks/a.md', item: 'T2 next' },
  });
  const [empty] = await exchange([call(1, 'odd_tasks_status', { cwd: path.join(root, 'odd') })]);
  assert.deepEqual(payload(empty), { files: [], next: null });
  await rm(root, { recursive: true });
});
