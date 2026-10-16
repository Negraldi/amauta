import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { runUpgrade } from '../src/install/upgrade.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** Bare origin with v0.1.0 and v0.2.0 (main = v0.2.0), plus a clone of it reset to v0.1.0 that tracks origin/main. */
async function fixture({ extraTag } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-upg-'));
  const origin = path.join(root, 'origin.git');
  const dev = path.join(root, 'dev');
  const inst = path.join(root, 'install');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, dev);
  const bump = async (version, tag) => {
    await writeFile(path.join(dev, 'package.json'), `${JSON.stringify({ name: 'amauta', version })}\n`);
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', `release ${version}`);
    git(dev, 'tag', tag);
  };
  await bump('0.1.0', 'v0.1.0');
  await bump('0.2.0', 'v0.2.0');
  if (extraTag) { await bump('0.10.0', 'v0.10.0'); await bump('0.9.0', 'v0.9.0'); git(dev, 'tag', 'nightly'); }
  git(dev, 'push', '-q', 'origin', 'main', '--tags');
  git(root, 'clone', '-q', origin, inst);
  git(inst, 'reset', '-q', '--hard', 'v0.1.0');
  return { root, origin, dev, inst };
}

function harness({ confirm, installCode = 0, statusCode = 0 } = {}) {
  const out = []; const err = []; const calls = [];
  const io = { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } };
  const deps = {
    runAmauta: async (args) => { calls.push(args); return args[0] === 'install' ? installCode : statusCode; },
    ...(confirm === undefined ? {} : { confirm: async (q) => { calls.push(['confirm', q]); return confirm; } }),
  };
  return { io, deps, calls, text: () => out.join(''), errText: () => err.join('') };
}

const head = (dir) => git(dir, 'rev-parse', 'HEAD');
const pkgVersion = async (dir) => JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).version;

test('--dry-run shows current and target versions and the plan, and changes nothing', async () => {
  const f = await fixture();
  const before = head(f.inst);
  const h = harness();
  const code = await runUpgrade(['--dry-run'], h.io, { ...h.deps, root: f.inst });
  assert.equal(code, 0, h.errText());
  assert.match(h.text(), /current: 0\.1\.0/);
  assert.match(h.text(), /v0\.1\.0/); // git describe of the install repo
  assert.match(h.text(), /target: v0\.2\.0/);
  assert.match(h.text(), /dry run/i);
  assert.match(h.text(), /merge --ff-only v0\.2\.0/);
  assert.equal(head(f.inst), before);
  assert.deepEqual(h.calls, []);
});

test('upgrade --yes fast-forwards the branch to the latest tag, runs install then status, prints the rollback', async () => {
  const f = await fixture();
  const h = harness();
  const code = await runUpgrade(['--yes'], h.io, { ...h.deps, root: f.inst });
  assert.equal(code, 0, h.errText());
  assert.equal(git(f.inst, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.equal(git(f.inst, 'describe', '--tags', '--exact-match'), 'v0.2.0');
  assert.equal(await pkgVersion(f.inst), '0.2.0');
  assert.deepEqual(h.calls, [['install'], ['status']]);
  assert.match(h.text(), /rollback: amauta upgrade --to v0\.1\.0/);
});

test('the latest tag is picked by semver, not by name or date, and non-semver tags are ignored', async () => {
  const f = await fixture({ extraTag: true });
  const h = harness();
  assert.equal(await runUpgrade(['--dry-run'], h.io, { ...h.deps, root: f.inst }), 0, h.errText());
  assert.match(h.text(), /target: v0\.10\.0/);
});

test('install and status receive the path flags of the upgrade', async () => {
  const f = await fixture();
  const h = harness();
  await runUpgrade(['--yes', '--claude-home', '/x/h', '--claude-json', '/x/j.json', '--state-dir', '/x/s'], h.io, { ...h.deps, root: f.inst });
  const flags = ['--claude-home', '/x/h', '--claude-json', '/x/j.json', '--state-dir', '/x/s'];
  assert.deepEqual(h.calls, [['install', ...flags], ['status', ...flags]]);
});

test('refuses when the working tree has uncommitted changes', async () => {
  const f = await fixture();
  await writeFile(path.join(f.inst, 'package.json'), '{"name":"amauta","version":"0.1.0","x":1}\n');
  const before = head(f.inst);
  const h = harness();
  assert.equal(await runUpgrade(['--yes'], h.io, { ...h.deps, root: f.inst }), 1);
  assert.match(h.errText(), /uncommitted changes/);
  assert.equal(head(f.inst), before);
  assert.deepEqual(h.calls, []);
});

test('refuses on a detached HEAD and says how to get back to a branch', async () => {
  const f = await fixture();
  git(f.inst, 'checkout', '-q', '--detach', 'v0.1.0');
  const h = harness();
  assert.equal(await runUpgrade(['--yes'], h.io, { ...h.deps, root: f.inst }), 1);
  assert.match(h.errText(), /not on a branch/);
  assert.match(h.errText(), /git -C .* checkout main/);
});

test('refuses on a branch that does not track origin', async () => {
  const f = await fixture();
  git(f.inst, 'checkout', '-q', '-b', 'local-only');
  const h = harness();
  assert.equal(await runUpgrade(['--yes'], h.io, { ...h.deps, root: f.inst }), 1);
  assert.match(h.errText(), /does not track a branch on origin/);
});

test('already on the latest tag: nothing to do, installer not run', async () => {
  const f = await fixture();
  git(f.inst, 'merge', '-q', '--ff-only', 'v0.2.0');
  const h = harness();
  assert.equal(await runUpgrade(['--yes'], h.io, { ...h.deps, root: f.inst }), 0);
  assert.match(h.text(), /already (up to date|on)/i);
  assert.deepEqual(h.calls, []);
});

test('--to an older tag detaches HEAD there and prints how to return to the branch', async () => {
  const f = await fixture();
  git(f.inst, 'merge', '-q', '--ff-only', 'v0.2.0');
  const h = harness();
  const code = await runUpgrade(['--to', 'v0.1.0', '--yes'], h.io, { ...h.deps, root: f.inst });
  assert.equal(code, 0, h.errText());
  assert.equal(git(f.inst, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD');
  assert.equal(await pkgVersion(f.inst), '0.1.0');
  assert.deepEqual(h.calls, [['install'], ['status']]);
  assert.match(h.text(), /return to main: git -C .* checkout main/);
});

test('--to an unknown or malformed tag is refused before anything changes', async () => {
  const f = await fixture();
  const before = head(f.inst);
  for (const bad of ['v9.9.9', 'main', '--force', 'v0.2.0;touch x']) {
    const h = harness();
    assert.equal(await runUpgrade(['--to', bad, '--yes'], h.io, { ...h.deps, root: f.inst }), 1, bad);
    assert.deepEqual(h.calls, []);
  }
  assert.equal(head(f.inst), before);
});

test('asks for confirmation; declining leaves the repo untouched', async () => {
  const f = await fixture();
  const before = head(f.inst);
  const h = harness({ confirm: false });
  assert.equal(await runUpgrade([], h.io, { ...h.deps, root: f.inst }), 1);
  assert.equal(h.calls.filter((c) => c[0] === 'confirm').length, 1);
  assert.match(h.text(), /cancelled/i);
  assert.equal(head(f.inst), before);
  assert.deepEqual(h.calls.filter((c) => c[0] !== 'confirm'), []);
});

test('accepting the confirmation upgrades', async () => {
  const f = await fixture();
  const h = harness({ confirm: true });
  assert.equal(await runUpgrade([], h.io, { ...h.deps, root: f.inst }), 0, h.errText());
  assert.equal(await pkgVersion(f.inst), '0.2.0');
});

test('a failing install is reported with the rollback command and a non-zero exit', async () => {
  const f = await fixture();
  const h = harness({ installCode: 1 });
  assert.equal(await runUpgrade(['--yes'], h.io, { ...h.deps, root: f.inst }), 1);
  assert.match(h.errText(), /install failed/i);
  assert.match(h.text() + h.errText(), /rollback: amauta upgrade --to v0\.1\.0/);
  assert.equal(h.calls.some((c) => c[0] === 'status'), false);
});

test('a fast-forward that is not possible is explained and leaves the branch alone', async () => {
  const f = await fixture();
  await writeFile(path.join(f.inst, 'local.txt'), 'x\n');
  git(f.inst, 'add', '-A');
  git(f.inst, 'commit', '-q', '-m', 'local work');
  const before = head(f.inst);
  const h = harness();
  assert.equal(await runUpgrade(['--yes'], h.io, { ...h.deps, root: f.inst }), 1);
  assert.match(h.errText(), /fast-forward/i);
  assert.equal(head(f.inst), before);
  assert.deepEqual(h.calls, []);
});

test('the CLI lists upgrade and rejects unknown flags', () => {
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /^\s+upgrade\s/m);
  const bad = spawnSync(process.execPath, [bin, 'upgrade', '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /nope/);
});
