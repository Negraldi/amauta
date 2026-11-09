import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { runUpgrade } from '../src/install/upgrade.js';
import { notesBetween, reportLines } from '../src/install/upgrade-plan.js';
import { tempDir } from './helpers/tmp.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** Bare origin with v0.1.0 and v0.2.0 (main = v0.2.0), plus a clone of it reset to v0.1.0 that tracks origin/main. */
async function fixture({ extraTag, notes, branch } = {}) {
  const root = await tempDir('gl-upg-');
  const origin = path.join(root, 'origin.git');
  const dev = path.join(root, 'dev');
  const inst = path.join(root, 'install');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, dev);
  const bump = async (version, tag) => {
    await writeFile(path.join(dev, 'package.json'), `${JSON.stringify({ name: 'amauta', version })}\n`);
    if (notes) await writeFile(path.join(dev, 'UPGRADING.md'), NOTES[version] ?? NOTES['0.1.0']);
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', `release ${version}`);
    git(dev, 'tag', tag);
  };
  await bump('0.1.0', 'v0.1.0');
  await bump('0.2.0', 'v0.2.0');
  if (extraTag) { await bump('0.10.0', 'v0.10.0'); await bump('0.9.0', 'v0.9.0'); git(dev, 'tag', 'nightly'); }
  if (notes) await bump('0.3.0', 'v0.3.0');
  git(dev, 'push', '-q', 'origin', 'main', '--tags');
  if (branch) {
    git(dev, 'checkout', '-q', '-b', 'next');
    await writeFile(path.join(dev, 'package.json'), `${JSON.stringify({ name: 'amauta', version: '0.7.0' })}\n`);
    await writeFile(path.join(dev, 'UPGRADING.md'), NOTES['0.7.0']);
    git(dev, 'add', '-A');
    git(dev, 'commit', '-q', '-m', 'next 0.7.0');
    git(dev, 'push', '-q', 'origin', 'next');
  }
  git(root, 'clone', '-q', origin, inst);
  git(inst, 'reset', '-q', '--hard', 'v0.1.0');
  return { root, origin, dev, inst };
}

const NOTES = {
  '0.1.0': '# Upgrading\n',
  '0.2.0': '# Upgrading\n\n## From 0.1.0 to 0.2.0\n\n- note B\n',
  '0.3.0': '# Upgrading\n\n## From 0.2.0 to 0.3.0\n\n```bash\namauta upgrade --to v0.3.0\n```\n\n- note C\n- Rollback: `amauta upgrade --to v0.2.0`\n  and more.\n- after\n\n## From 0.1.0 to 0.2.0\n\n- note B\n\n## From 0.0.1 to 0.1.0\n\n- note A\n',
  '0.7.0': '# Upgrading\n\n## From 0.6.0 to 0.7.0\n\n- note G\n\n## From 0.1.0 to 0.2.0\n\n- note B\n',
};

function harness({ confirm, installCode = 0, statusCode = 0, preview } = {}) {
  const out = []; const err = []; const calls = [];
  const io = { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } };
  const deps = {
    runAmauta: async (args) => { calls.push(args); return args[0] === 'install' ? installCode : statusCode; },
    previewInstall: async (dir, flags) => {
      const ok = (await readFile(path.join(dir, 'package.json'), 'utf8').catch(() => '')).length > 0;
      calls.push(['preview', ok, ...flags]);
      return preview ?? { code: 0, report: { files: [], removed: [], skipped: [], legacy: [], state_changes: {} } };
    },
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
  assert.deepEqual(h.calls.filter((c) => c[0] !== 'preview'), [], 'neither install nor status runs');
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

// odd/tasks/upgrade-next.md U1, U3, U4.
const worktrees = (dir) => git(dir, 'worktree', 'list').split('\n').length;

test('the notes of every version in the jump are printed, oldest first, read from the target', async () => {
  const f = await fixture({ notes: true });
  const h = harness();
  assert.equal(await runUpgrade(['--dry-run'], h.io, { ...h.deps, root: f.inst }), 0, h.errText());
  const t = h.text();
  assert.match(t, /target: v0\.3\.0/);
  assert.ok(t.indexOf('From 0.1.0 to 0.2.0') < t.indexOf('From 0.2.0 to 0.3.0'), t);
  assert.match(t, /note B[\s\S]*note C/);
  assert.doesNotMatch(t, /note A/, 'a section the install already passed is not shown');
  assert.doesNotMatch(t, /--to v0\.3\.0|Rollback: `amauta upgrade --to v0\.2\.0`|and more/, 'single-step commands are dropped');
  assert.match(t, /- after/);
  const done = harness();
  assert.equal(await runUpgrade(['--yes'], done.io, { ...done.deps, root: f.inst }), 0, done.errText());
  assert.match(done.text(), /Upgraded[\s\S]*note C/, 'the notes are repeated after the upgrade');
});

test('the dry run previews the target installer from a temporary worktree and removes it', async () => {
  const f = await fixture();
  const state = path.join(f.root, 'state');
  await mkdir(state, { recursive: true });
  await writeFile(path.join(state, 'state.json'), JSON.stringify({ sdd: true, impeccable: false, archify: true }));
  const report = { files: ['/h/.claude/settings.json', '/h/.claude/skills/new'], removed: ['/h/.claude/old'], skipped: [],
    legacy: ['hook review-stop'], state_changes: { privacy: [null, true] } };
  const h = harness({ preview: { code: 0, report } });
  assert.equal(await runUpgrade(['--dry-run', '--state-dir', state], h.io, { ...h.deps, root: f.inst }), 0, h.errText());
  assert.deepEqual(h.calls, [['preview', true, '--state-dir', state]], 'the target checkout, with the path flags');
  assert.equal(worktrees(f.inst), 1, 'the worktree is gone');
  const t = h.text();
  assert.match(t, /would write 2 files/);
  assert.match(t, /settings\.json/);
  assert.match(t, /would remove 1/);
  assert.match(t, /replace 1 legacy entr/);
  assert.match(t, /hook review-stop/);
  assert.match(t, /kept from your last install: sdd, archify/);
  const failing = harness({ preview: { code: 1, report: null } });
  assert.equal(await runUpgrade(['--dry-run'], failing.io, { ...failing.deps, root: f.inst }), 0);
  assert.match(failing.text(), /could not preview/);
  assert.equal(worktrees(f.inst), 1);
});

test('--branch moves to the tip of a branch on origin, and the branch you were on is the rollback', async () => {
  const f = await fixture({ branch: true });
  const dry = harness();
  assert.equal(await runUpgrade(['--branch', 'next', '--dry-run'], dry.io, { ...dry.deps, root: f.inst }), 0, dry.errText());
  assert.match(dry.text(), /target: branch next/);
  assert.match(dry.text(), /0\.7\.0/);
  assert.match(dry.text(), /note G/);
  assert.equal(git(f.inst, 'symbolic-ref', '--short', 'HEAD'), 'main');
  const h = harness();
  assert.equal(await runUpgrade(['--branch', 'next', '--yes'], h.io, { ...h.deps, root: f.inst }), 0, h.errText());
  assert.equal(git(f.inst, 'symbolic-ref', '--short', 'HEAD'), 'next');
  assert.equal(git(f.inst, 'rev-parse', '--abbrev-ref', 'next@{upstream}'), 'origin/next');
  assert.equal(await pkgVersion(f.inst), '0.7.0');
  assert.deepEqual(h.calls, [['install'], ['status']]);
  assert.match(h.text(), /rollback: git -C .* checkout main && amauta install/);
  const again = harness();
  assert.equal(await runUpgrade(['--branch', 'next', '--yes'], again.io, { ...again.deps, root: f.inst }), 0);
  assert.match(again.text(), /already/i);
});

test('--branch refuses bad names, unknown branches and --to together, before anything changes', async () => {
  const f = await fixture({ branch: true });
  const before = head(f.inst);
  for (const args of [['--branch', '-x'], ['--branch', 'a..b'], ['--branch', 'nope'], ['--branch', 'next', '--to', 'v0.1.0']]) {
    const h = harness();
    assert.equal(await runUpgrade([...args, '--yes'], h.io, { ...h.deps, root: f.inst }), 1, args.join(' '));
    assert.deepEqual(h.calls, [], args.join(' '));
  }
  assert.equal(head(f.inst), before);
  assert.equal(git(f.inst, 'symbolic-ref', '--short', 'HEAD'), 'main');
});

// Review fixes (odd/tasks/upgrade-next.md Q3).
test('choices install does not keep by itself are passed again to install and to the preview', async () => {
  const f = await fixture();
  const state = path.join(f.root, 'state2');
  await mkdir(state, { recursive: true });
  await writeFile(path.join(state, 'state.json'), JSON.stringify({ telemetry: false, privacy: true, checks: false, persona: 'neutral', sdd: true }));
  const dry = harness();
  assert.equal(await runUpgrade(['--dry-run', '--state-dir', state], dry.io, { ...dry.deps, root: f.inst }), 0, dry.errText());
  const again = ['--no-telemetry', '--no-checks', '--persona', 'neutral'];
  assert.deepEqual(dry.calls, [['preview', true, '--state-dir', state, ...again]]);
  assert.match(dry.text(), /passed again: --no-telemetry --no-checks --persona neutral/);
  const h = harness();
  assert.equal(await runUpgrade(['--yes', '--state-dir', state], h.io, { ...h.deps, root: f.inst }), 0, h.errText());
  assert.deepEqual(h.calls, [['install', '--state-dir', state, ...again], ['status', '--state-dir', state]]);
});

test('an existing local branch without the right upstream is set to track origin', async () => {
  const f = await fixture({ branch: true });
  git(f.inst, 'branch', '-q', '--no-track', 'next', 'main');
  const h = harness();
  assert.equal(await runUpgrade(['--branch', 'next', '--yes'], h.io, { ...h.deps, root: f.inst }), 0, h.errText());
  assert.equal(git(f.inst, 'rev-parse', '--abbrev-ref', 'next@{upstream}'), 'origin/next');
  assert.equal(await pkgVersion(f.inst), '0.7.0');
});

test('--branch refuses names git would expand', async () => {
  const f = await fixture({ branch: true });
  for (const name of ['@{-1}', 'refs/heads/next']) {
    const h = harness();
    assert.equal(await runUpgrade(['--branch', name, '--yes'], h.io, { ...h.deps, root: f.inst }), 1, name);
    assert.match(h.errText(), /not a valid branch name/, name);
  }
});

test('notes: headers with extra words, fenced "## " lines, and no notes when going back', () => {
  const md = '## From 0.4.0 to 0.5.0 (breaking)\n\n- five\n\n```text\n## not a header\n```\n- still five\n\n## From 0.5.0 to 0.6.0\n\n- six\n';
  const n = notesBetween(md, '0.4.0', '0.6.0');
  assert.match(n, /five[\s\S]*not a header[\s\S]*still five[\s\S]*six/);
  assert.equal(notesBetween(md, '0.6.0', '0.4.0'), '');
});

test('a downgrade says the notes do not apply; a malformed target package.json is not a crash', async () => {
  const f = await fixture({ notes: true });
  git(f.inst, 'merge', '-q', '--ff-only', 'v0.3.0');
  const h = harness();
  assert.equal(await runUpgrade(['--to', 'v0.1.0', '--dry-run'], h.io, { ...h.deps, root: f.inst }), 0, h.errText());
  assert.match(h.text(), /going back/i);
});

test('the report counts Codex too, and says when the preview is approximate', () => {
  const report = { files: [], removed: [], skipped: [], legacy: [], state_changes: {},
    codex: { files: ['/c/.codex/config.toml'], removed: [], skipped: [], legacy: ['hook x'], state_changes: {} } };
  const t = reportLines({ code: 0, report }, null).join('\n');
  assert.match(t, /would write 1 file:[\s\S]*config\.toml/);
  assert.match(t, /replace 1 legacy entry/);
  assert.doesNotMatch(t, /nothing: the install/);
  assert.match(reportLines({ code: 0, report, approximate: true }, null).join('\n'), /approximate/);
});
