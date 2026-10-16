import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPortalSpawn, runPortal, defaultSpawn } from '../src/portal/cli.js';
import { main } from '../src/cli.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };

test('builds python3 -P -m amauta.portal with PYTHONPATH and forwarded options', () => {
  const r = buildPortalSpawn(['--port', '9001', '--repo', '.', '--repo', '/abs/r', '--engram-db', '/e.db', '--claude-home', '/c/.claude', '--state-dir', '/s'], { PATH: '/bin', PYTHONPATH: '/old' });
  assert.equal(r.command, 'python3');
  assert.deepEqual(r.args, ['-P', '-m', 'amauta.portal', '--port', '9001', '--claude-home', '/c/.claude', '--engram-db', '/e.db', '--repo', path.resolve('.'), '--repo', '/abs/r']);
  assert.equal(r.env.PYTHONPATH, `${path.join(repo, 'python')}${path.delimiter}/old`);
  assert.equal(r.env.AMAUTA_STATE_DIR, '/s');
  assert.equal(r.env.PATH, '/bin');
});

test('defaults: no forwarded options, state dir derived like the installer', () => {
  const r = buildPortalSpawn([], { HOME: '/h' });
  assert.deepEqual(r.args, ['-P', '-m', 'amauta.portal']);
  assert.equal(r.env.PYTHONPATH, path.join(repo, 'python'));
  assert.ok(r.env.AMAUTA_STATE_DIR.endsWith('.gentle-lite'));
  const sandbox = buildPortalSpawn(['--claude-home', '/x/.claude'], {});
  assert.equal(sandbox.env.AMAUTA_STATE_DIR, path.join('/x/.claude', '.gentle-lite'));
});

test('there is no way to pass a host', async () => {
  assert.throws(() => buildPortalSpawn(['--host', '0.0.0.0'], {}), /unknown option/i);
  const err = sink();
  assert.equal(await runPortal(['--host', '0.0.0.0'], { stdout: sink(), stderr: err }), 1);
  assert.match(err.text, /--host/);
});

test('rejects an invalid port', () => {
  for (const bad of ['abc', '-1', '70000', '1.5']) assert.throws(() => buildPortalSpawn(['--port', bad], {}), /port/i, bad);
});

test('runPortal spawns the built command and returns its exit code', async () => {
  const calls = [];
  const code = await runPortal(['--port', '8123'], { stdout: sink(), stderr: sink() }, { spawn: (command, args, opts) => { calls.push({ command, args, opts }); return Promise.resolve(3); } });
  assert.equal(code, 3);
  assert.equal(calls[0].command, 'python3');
  assert.deepEqual(calls[0].args.slice(0, 5), ['-P', '-m', 'amauta.portal', '--port', '8123']);
  assert.equal(calls[0].opts.stdio, 'inherit');
});

test('portal is listed in the CLI help', async () => {
  const out = sink();
  await main(['--help'], { stdout: out, stderr: sink() });
  assert.match(out.text, /portal/);
});

test('defaultSpawn reports why the child could not start (python3 missing)', async () => {
  const err = sink();
  const code = await defaultSpawn('gentle-lite-definitely-not-a-command', [], { stdio: 'ignore' }, { stderr: err });
  assert.equal(code, 1);
  assert.match(err.text, /gentle-lite portal: cannot start gentle-lite-definitely-not-a-command: .*ENOENT/);
});

test('defaultSpawn maps a SIGTERM-terminated child to 143 and removes its signal listeners', async () => {
  const before = process.listenerCount('SIGTERM');
  const p = defaultSpawn(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], { stdio: 'ignore' }, { stderr: sink() });
  assert.equal(await p, 143);
  assert.equal(process.listenerCount('SIGTERM'), before);
});

test('the removed --graphify option is rejected (graph memory comes from --repo)', () => {
  assert.throws(() => buildPortalSpawn(['--graphify', '/g'], {}), /unknown option/i);
});
