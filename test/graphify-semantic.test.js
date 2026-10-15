import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

test('the model comes from --model, else GENTLE_LITE_GRAPHIFY_MODEL, else the Haiku default', async () => {
  const t = await sandbox(WRITE_GRAPH);
  const env = { ANTHROPIC_API_KEY: CANARY };
  assert.equal(t.run(['--model', 'm-flag'], { ...env, GENTLE_LITE_GRAPHIFY_MODEL: 'm-env' }).status, 0);
  assert.equal(t.run([], { ...env, GENTLE_LITE_GRAPHIFY_MODEL: 'm-env' }).status, 0);
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
