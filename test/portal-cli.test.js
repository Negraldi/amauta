import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPortalSpawn, runPortal, defaultSpawn, configuredRepos } from '../src/portal/cli.js';
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
  // The derived state dir is the real one here; repos listed in its portal.json are forwarded too, so expect exactly those.
  const listed = configuredRepos(r.env.AMAUTA_STATE_DIR).flatMap((p) => ['--repo', path.resolve(p)]);
  assert.deepEqual(r.args, ['-P', '-m', 'amauta.portal', ...listed]);
  assert.equal(r.env.PYTHONPATH, path.join(repo, 'python'));
  assert.ok(r.env.AMAUTA_STATE_DIR.endsWith('.amauta'));
  const sandbox = buildPortalSpawn(['--claude-home', '/x/.claude'], {});
  assert.equal(sandbox.env.AMAUTA_STATE_DIR, path.join('/x/.claude', '.amauta'));
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
  const code = await defaultSpawn('amauta-definitely-not-a-command', [], { stdio: 'ignore' }, { stderr: err });
  assert.equal(code, 1);
  assert.match(err.text, /amauta portal: cannot start amauta-definitely-not-a-command: .*ENOENT/);
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

test('configured projects from portal.json are forwarded as --repo, after explicit flags, without duplicates', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const state = await mkdtemp(path.join(os.tmpdir(), 'amauta-portal-json-'));
  try {
    await writeFile(path.join(state, 'portal.json'), JSON.stringify({ repos: ['/proj/one', '/abs/r', 'relative', 7, '/proj/two\0x'], auto_discover: false }));
    const r = buildPortalSpawn(['--repo', '/abs/r', '--state-dir', state], {});
    const repos = r.args.flatMap((a, i) => (r.args[i - 1] === '--repo' ? [a] : []));
    assert.deepEqual(repos, ['/abs/r', '/proj/one'], 'absolute string entries only, explicit flags first, no repeats');
    // portal launch builds the same arguments, so the launcher-started portal knows the projects without flags
    const launched = buildPortalSpawn(['--state-dir', state, '--port', '9', '--idle-exit', '30'], {});
    assert.ok(launched.args.includes('/proj/one'));
  } finally { await rm(state, { recursive: true, force: true }); }
});

test('a missing or broken portal.json adds nothing', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const state = await mkdtemp(path.join(os.tmpdir(), 'amauta-portal-json-'));
  try {
    assert.deepEqual(buildPortalSpawn(['--state-dir', state], {}).args, ['-P', '-m', 'amauta.portal']);
    for (const text of ['not json', '[]', '{"repos": "x"}']) {
      await writeFile(path.join(state, 'portal.json'), text);
      assert.deepEqual(buildPortalSpawn(['--state-dir', state], {}).args, ['-P', '-m', 'amauta.portal'], text);
    }
  } finally { await rm(state, { recursive: true, force: true }); }
});
