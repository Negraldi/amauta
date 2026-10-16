import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { install } from '../src/install/installer.js';
import { main } from '../src/cli.js';

const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-toggle-'));
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state') };
  await mkdir(t.claudeHome, { recursive: true });
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: '', ...extra });
  t.args = (...more) => ['--claude-home', t.claudeHome, '--claude-json', t.claudeJson, '--state-dir', t.stateDir, ...more];
  t.state = async () => JSON.parse(await readFile(path.join(t.stateDir, 'state.json'), 'utf8'));
  t.settings = async () => JSON.parse(await readFile(path.join(t.claudeHome, 'settings.json'), 'utf8'));
  t.json = async () => JSON.parse(await readFile(t.claudeJson, 'utf8'));
  t.has = (rel) => existsSync(path.join(t.claudeHome, rel));
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}

test('--without-sdd turns the sticky SDD module off: files removed, hook gone, state false, backup restores it', async () => {
  const t = await sandbox();
  await install(t.opts({ withSdd: true }));
  assert.ok(t.has('commands'));
  assert.ok(t.has('skills/sdd-apply'));
  const r = await install(t.opts({ withSdd: false }));
  assert.equal((await t.state()).sdd, false);
  assert.ok(r.removed.includes('skills/sdd-apply/SKILL.md'));
  assert.ok(!t.has('skills/sdd-apply'));
  assert.ok(!t.has('commands'), 'empty module directories are pruned');
  assert.ok(t.has('skills/_shared'), 'files shared with the base install stay');
  assert.ok(!JSON.stringify(await t.settings()).includes('amauta.sdd'), 'preflight hook removed');
  assert.ok(r.backup, 'removals are backed up');
  const again = await install(t.opts());
  assert.equal((await t.state()).sdd, false, 'an absent flag keeps the off choice');
  assert.equal(again.changed, false);
  await t.cleanup();
});

test('a user-edited file of a module being turned off is kept and reported', async () => {
  const t = await sandbox();
  await install(t.opts({ withArchify: true }));
  const file = path.join(t.claudeHome, 'skills', 'archify', 'SKILL.md');
  await writeFile(file, 'my edit\n');
  const r = await install(t.opts({ withArchify: false }));
  assert.equal((await t.state()).archify, false);
  assert.equal(await readFile(file, 'utf8'), 'my edit\n');
  assert.ok(r.skipped.includes('skills/archify/SKILL.md'));
  assert.ok(!t.has('skills/archify/bin'), 'untouched files are removed');
  await t.cleanup();
});

test('--without-rea and --without-context7 drop their MCP servers when still ours', async () => {
  const t = await sandbox();
  await install(t.opts({ withRea: true, withContext7: true }));
  assert.ok('rea' in (await t.json()).mcpServers && 'context7' in (await t.json()).mcpServers);
  await install(t.opts({ withRea: false }));
  const servers = (await t.json()).mcpServers;
  assert.ok(!('rea' in servers));
  assert.ok('context7' in servers);
  assert.equal((await t.state()).rea, false);
  assert.equal((await t.state()).context7, true);
  await t.cleanup();
});

test('dry-run reports removals without touching the disk', async () => {
  const t = await sandbox();
  await install(t.opts({ withArchify: true }));
  const r = await install(t.opts({ withArchify: false, dryRun: true }));
  assert.equal(r.dryRun, true);
  assert.ok(r.removed.includes('skills/archify/SKILL.md'));
  assert.ok(t.has('skills/archify/SKILL.md'));
  assert.equal((await t.state()).archify, true);
  await t.cleanup();
});

test('rddMode sets review mode inside the same install, with one backup that undoes it', async () => {
  const t = await sandbox();
  await install(t.opts());
  assert.equal((await t.state()).rdd_mode, 'off');
  const dry = await install(t.opts({ rddMode: 'on', dryRun: true }));
  assert.deepEqual(dry.state_changes, { rdd_mode: { from: 'off', to: 'on' } });
  assert.equal(dry.changed, true);
  assert.equal((await t.state()).rdd_mode, 'off');
  const r = await install(t.opts({ rddMode: 'on' }));
  assert.equal((await t.state()).rdd_mode, 'on');
  assert.ok(r.backup, 'a state-only change is still backed up');
  const same = await install(t.opts({ rddMode: 'on' }));
  assert.equal(same.changed, false);
  assert.equal(same.backup, null);
  await t.cleanup();
});

test('CLI: --without-* flags, --review-mode and --json; conflicts and bad values are refused', async () => {
  const t = await sandbox();
  let out = sink();
  assert.equal(await main(['install', ...t.args('--with-archify', '--with-sdd')], { stdout: out, stderr: sink() }), 0);
  out = sink();
  assert.equal(await main(['install', ...t.args('--without-archify', '--review-mode', 'on', '--json', '--dry-run')], { stdout: out, stderr: sink() }), 0);
  const plan = JSON.parse(out.text);
  assert.equal(plan.dryRun, true);
  assert.ok(plan.removed.includes('skills/archify/SKILL.md'));
  assert.deepEqual(plan.state_changes, { rdd_mode: { from: 'off', to: 'on' }, archify: { from: true, to: false } });
  assert.ok(Array.isArray(plan.files) && Array.isArray(plan.skipped));
  for (const bad of [['--with-sdd', '--without-sdd'], ['--review-mode', 'maybe']]) {
    const err = sink();
    assert.equal(await main(['install', ...t.args(...bad)], { stdout: sink(), stderr: err }), 1, bad.join(' '));
    assert.match(err.text, /amauta:/);
  }
  assert.equal((await t.state()).archify, true, 'nothing changed');
  await t.cleanup();
});

test('amauta restore --backup <id> restores a backup by id; ids that are not backup names are refused', async () => {
  const t = await sandbox();
  await install(t.opts());
  const before = await readFile(path.join(t.claudeHome, 'settings.json'), 'utf8');
  let out = sink();
  await main(['install', ...t.args('--persona', 'neutral', '--json')], { stdout: out, stderr: sink() });
  const applied = JSON.parse(out.text);
  assert.ok(applied.backup);
  assert.equal((await t.state()).persona, 'neutral');
  const id = path.basename(applied.backup);
  out = sink();
  assert.equal(await main(['restore', ...t.args('--backup', id, '--json')], { stdout: out, stderr: sink() }), 0);
  const res = JSON.parse(out.text);
  assert.equal(res.backup, id);
  assert.ok(res.restored.length > 0);
  assert.equal((await t.state()).persona, 'gentleman');
  assert.equal(await readFile(path.join(t.claudeHome, 'settings.json'), 'utf8'), before);
  for (const bad of ['../x', '/etc', 'a/b', '', '..', 'not-a-stamp']) {
    const err = sink();
    assert.equal(await main(['restore', ...t.args('--backup', bad)], { stdout: sink(), stderr: err }), 1, bad);
  }
  assert.equal(await main(['restore', ...t.args('--backup', '20990101T000000Z')], { stdout: sink(), stderr: sink() }), 1, 'unknown backup');
  await t.cleanup();
});
