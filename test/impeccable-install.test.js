import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { install, uninstall, status } from '../src/install/installer.js';
import { main } from '../src/cli.js';
import { assetPath } from '../src/install/assets.js';
import { tempDir } from './helpers/tmp.js';

const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const NPM_ARGS = (prefix) => ['install', '--prefix', prefix, 'impeccable@3.6.1', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'];

/** Temp HOME-less sandbox with a fake `npm` that records its calls and fakes the package layout; never any network. */
async function sandbox({ npm = 'ok', version = '3.6.1' } = {}) {
  const root = await tempDir('gl-imp-');
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state'), bin: path.join(root, 'bin') };
  await mkdir(t.claudeHome, { recursive: true });
  await mkdir(t.bin);
  t.engine = path.join(t.stateDir, 'impeccable');
  t.cli = path.join(t.engine, 'node_modules', 'impeccable', 'cli', 'bin', 'cli.js');
  t.calls = path.join(t.bin, 'calls.log');
  t.setNpm = async (mode, v = version) => {
    const body = mode === 'ok'
      ? `#!/bin/sh
printf '%s\\n' "$*" >> "${t.calls}"
prefix=""; prev=""
for a in "$@"; do [ "$prev" = "--prefix" ] && prefix="$a"; prev="$a"; done
mkdir -p "$prefix/node_modules/impeccable/cli/bin"
printf '{"name":"impeccable","version":"${v}"}' > "$prefix/node_modules/impeccable/package.json"
printf '// fake cli\\n' > "$prefix/node_modules/impeccable/cli/bin/cli.js"
`
      : `#!/bin/sh
printf '%s\\n' "$*" >> "${t.calls}"
echo "npm ERR! network down" >&2
exit 1
`;
    const f = path.join(t.bin, 'npm');
    await writeFile(f, body);
    await chmod(f, 0o755);
  };
  if (npm) await t.setNpm(npm, version);
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: t.bin, ...extra });
  t.args = () => ['--claude-home', t.claudeHome, '--claude-json', t.claudeJson, '--state-dir', t.stateDir];
  t.state = async () => JSON.parse(await readFile(path.join(t.stateDir, 'state.json'), 'utf8'));
  t.read = (rel) => readFile(path.join(t.claudeHome, rel), 'utf8');
  t.npmCalls = async () => (existsSync(t.calls) ? (await readFile(t.calls, 'utf8')).trim().split('\n').filter(Boolean) : []);
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}

test('without --with-impeccable nothing is installed and npm is never run', async () => {
  const t = await sandbox();
  const r = await install(t.opts());
  assert.equal((await t.state()).impeccable, false);
  assert.ok(!existsSync(path.join(t.claudeHome, 'skills', 'impeccable')));
  assert.deepEqual(await t.npmCalls(), []);
  assert.equal(r.impeccable, undefined);
  await t.cleanup();
});

test('--with-impeccable installs the rendered skill and the pinned engine through npm', async () => {
  const t = await sandbox();
  const r = await install(t.opts({ withImpeccable: true }));
  assert.equal((await t.state()).impeccable, true);
  assert.deepEqual(await t.npmCalls(), [NPM_ARGS(t.engine).join(' ')]);
  assert.equal(r.impeccable.engine, 'installed');
  const skillDir = path.join(t.claudeHome, 'skills', 'impeccable');
  const storeSkillDir = path.join(t.stateDir, 'skills', 'impeccable');
  for (const f of ['SKILL.md', 'LICENSE', 'reference/audit.md', 'scripts/context.mjs', 'scripts/detect.mjs']) assert.ok(existsSync(path.join(skillDir, f)), f);
  const skill = await t.read('skills/impeccable/SKILL.md');
  assert.ok(!skill.includes('{{AMAUTA_'), 'placeholders rendered');
  assert.ok(skill.includes(`node ${storeSkillDir}/scripts/context.mjs`), 'absolute skill path');
  assert.ok(skill.includes(`node ${t.cli} detect`), 'engine CLI path');
  // scripts are copied byte for byte
  assert.deepEqual(await readFile(path.join(skillDir, 'scripts', 'detect.mjs')), await readFile(assetPath('skills/impeccable/scripts/detect.mjs')));
  await t.cleanup();
});

test('paths with spaces are shell-quoted in the rendered skill', async () => {
  const t = await sandbox();
  const spaced = path.join(t.root, 'my state');
  await install(t.opts({ withImpeccable: true, stateDir: spaced }));
  const skill = await t.read('skills/impeccable/SKILL.md');
  assert.ok(skill.includes(`node '${path.join(spaced, 'impeccable', 'node_modules', 'impeccable', 'cli', 'bin', 'cli.js')}' detect`));
  await t.cleanup();
});

test('the choice is sticky and a present engine is not reinstalled; a different version is', async () => {
  const t = await sandbox();
  await install(t.opts({ withImpeccable: true }));
  const again = await install(t.opts());
  assert.equal((await t.state()).impeccable, true);
  assert.equal(again.impeccable.engine, 'present');
  assert.equal((await t.npmCalls()).length, 1);
  await writeFile(path.join(t.engine, 'node_modules', 'impeccable', 'package.json'), '{"version":"3.0.0"}');
  const fixed = await install(t.opts());
  assert.equal(fixed.impeccable.engine, 'installed');
  assert.equal((await t.npmCalls()).length, 2);
  await t.cleanup();
});

test('--dry-run lists the skill files and runs nothing', async () => {
  const t = await sandbox();
  const r = await install(t.opts({ withImpeccable: true, dryRun: true }));
  assert.ok(r.files.includes('skills/impeccable/SKILL.md'));
  assert.deepEqual(await t.npmCalls(), []);
  assert.ok(!existsSync(t.stateDir));
  await t.cleanup();
});

test('a failing npm leaves the skill installed, reports the failure and a rerun retries', async () => {
  const t = await sandbox({ npm: 'fail' });
  const r = await install(t.opts({ withImpeccable: true }));
  assert.equal(r.impeccable.engine, 'failed');
  assert.match(r.impeccable.detail, /network down/);
  assert.ok(existsSync(path.join(t.claudeHome, 'skills', 'impeccable', 'SKILL.md')));
  assert.equal((await t.state()).impeccable, true);
  await t.setNpm('ok');
  assert.equal((await install(t.opts())).impeccable.engine, 'installed');
  await t.cleanup();
});

test('npm missing from PATH is reported without throwing', async () => {
  const t = await sandbox({ npm: null });
  const r = await install(t.opts({ withImpeccable: true }));
  assert.equal(r.impeccable.engine, 'failed');
  assert.match(r.impeccable.detail, /npm not found/);
  await t.cleanup();
});

test('the CLI flag works, prints the engine outcome and exits 1 when the engine failed', async () => {
  const t = await sandbox();
  const okOut = sink();
  const env = process.env.PATH;
  process.env.PATH = `${t.bin}${path.delimiter}${env}`;
  try {
    assert.equal(await main(['install', ...t.args(), '--with-impeccable'], { stdout: okOut, stderr: sink() }), 0);
    assert.match(okOut.text, /impeccable engine 3\.6\.1 installed/);
    await t.setNpm('fail', '3.6.1');
    await rm(t.engine, { recursive: true, force: true });
    const err = sink();
    assert.equal(await main(['install', ...t.args()], { stdout: sink(), stderr: err }), 1);
    assert.match(err.text, /impeccable engine/);
    assert.match(err.text, /rerun/);
  } finally {
    process.env.PATH = env;
  }
  await t.cleanup();
});

test('status reports the engine version and flags a missing or wrong one', async () => {
  const t = await sandbox();
  await install(t.opts({ withImpeccable: true }));
  let s = await status(t.opts());
  const item = s.items.find((i) => i.name === 'impeccable engine');
  assert.ok(item?.ok, JSON.stringify(item));
  assert.match(item.detail, /3\.6\.1/);
  await rm(path.join(t.engine, 'node_modules'), { recursive: true });
  s = await status(t.opts());
  assert.equal(s.items.find((i) => i.name === 'impeccable engine').ok, false);
  assert.equal(s.ok, false);
  await t.cleanup();
});

test('status without the option has no impeccable item', async () => {
  const t = await sandbox();
  await install(t.opts());
  assert.equal((await status(t.opts())).items.find((i) => /impeccable/.test(i.name)), undefined);
  await t.cleanup();
});

test('uninstall removes the skill and the engine directory, but keeps a skill file the user edited', async () => {
  const t = await sandbox();
  await install(t.opts({ withImpeccable: true }));
  await writeFile(path.join(t.claudeHome, 'skills', 'impeccable', 'reference', 'audit.md'), 'my notes\n');
  const r = await uninstall(t.opts());
  assert.ok(r.kept.includes('skills/impeccable/reference/audit.md'));
  assert.ok(!existsSync(path.join(t.claudeHome, 'skills', 'impeccable', 'SKILL.md')));
  assert.ok(!existsSync(path.join(t.claudeHome, 'skills', 'impeccable', 'scripts')));
  assert.ok(!existsSync(t.engine));
  await t.cleanup();
});

test('uninstall leaves a directory named impeccable alone when the option was never chosen', async () => {
  const t = await sandbox();
  await install(t.opts());
  await mkdir(t.engine, { recursive: true });
  await writeFile(path.join(t.engine, 'mine.txt'), 'x');
  await uninstall(t.opts());
  assert.ok(existsSync(path.join(t.engine, 'mine.txt')));
  await t.cleanup();
});

test('a Codex-only install with --with-impeccable prepares the shared engine too, and Codex uninstall removes it', async () => {
  const { installCodex, uninstallCodex } = await import('../src/install/codex.js');
  const { codexSandbox } = await import('./helpers/codex.js');
  const t = await sandbox();
  const c = await codexSandbox();
  const opts = { codexHome: c.codexHome, codexSkillsDir: c.skillsDir, stateDir: t.stateDir, searchPath: t.bin, claudeHome: t.claudeHome, claudeJson: t.claudeJson, withImpeccable: true };
  const r = await installCodex(opts);
  assert.equal(r.impeccable.engine, 'installed');
  assert.deepEqual(await t.npmCalls(), [NPM_ARGS(t.engine).join(' ')]);
  assert.ok(existsSync(t.cli));
  const again = await installCodex(opts); // idempotent: the engine is already there
  assert.equal(again.impeccable.engine, 'present');
  assert.equal((await t.npmCalls()).length, 1);
  await uninstallCodex(opts);
  assert.ok(!existsSync(t.engine), 'engine removed with the last runtime that uses it');
  await t.cleanup();
});

test('Codex uninstall keeps the engine while the Claude install still uses it', async () => {
  const { installCodex, uninstallCodex } = await import('../src/install/codex.js');
  const { codexSandbox } = await import('./helpers/codex.js');
  const t = await sandbox();
  const c = await codexSandbox();
  await install(t.opts({ withImpeccable: true }));
  const opts = { codexHome: c.codexHome, codexSkillsDir: c.skillsDir, stateDir: t.stateDir, searchPath: t.bin, claudeHome: t.claudeHome, claudeJson: t.claudeJson };
  await installCodex(opts);
  await uninstallCodex(opts);
  assert.ok(existsSync(t.cli));
  await t.cleanup();
});
