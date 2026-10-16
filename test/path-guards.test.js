import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { install, restore, uninstall } from '../src/install/installer.js';
import { createBackup, restoreBackup } from '../src/core/backup.js';

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-guards-'));
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state') };
  await mkdir(t.claudeHome, { recursive: true });
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: '', ...extra });
  t.statePath = path.join(t.stateDir, 'state.json');
  t.readState = async () => JSON.parse(await readFile(t.statePath, 'utf8'));
  t.writeState = (s) => writeFile(t.statePath, `${JSON.stringify(s, null, 2)}\n`);
  return t;
}
const sha = async (p) => (await import('node:crypto')).createHash('sha256').update(await readFile(p)).digest('hex');

test('stale-file removal ignores absolute paths and .. in managed_files keys', async () => {
  const t = await sandbox();
  await install(t.opts());
  const victim = path.join(t.root, 'victim.txt');
  await writeFile(victim, 'precious');
  const abs = path.join(t.root, 'abs-victim.txt');
  await writeFile(abs, 'precious too');
  const state = await t.readState();
  state.managed_files['../../../victim.txt'] = await sha(victim);
  state.managed_files[abs] = await sha(abs);
  await t.writeState(state);
  const r = await install(t.opts());
  assert.equal(await readFile(victim, 'utf8'), 'precious');
  assert.equal(await readFile(abs, 'utf8'), 'precious too');
  assert.ok(!r.removed.includes('../../../victim.txt') && !r.removed.includes(abs));
  assert.ok(r.skipped.includes('../../../victim.txt'), 'the refused key is reported');
  await uninstall(t.opts());
  assert.equal(await readFile(victim, 'utf8'), 'precious', 'uninstall refuses the same keys');
  await rm(t.root, { recursive: true, force: true });
});

test('stale-file removal does not follow a symlinked parent directory', async () => {
  const t = await sandbox();
  await install(t.opts());
  const outside = path.join(t.root, 'outside');
  await mkdir(outside);
  const victim = path.join(outside, 'x.txt');
  await writeFile(victim, 'keep me');
  await symlink(outside, path.join(t.claudeHome, 'linked'));
  const state = await t.readState();
  state.managed_files['linked/x.txt'] = await sha(victim);
  await t.writeState(state);
  await install(t.opts());
  assert.equal(await readFile(victim, 'utf8'), 'keep me');
  assert.ok(existsSync(victim));
  await rm(t.root, { recursive: true, force: true });
});

test('restoreBackup refuses a manifest entry outside the allowed roots and changes nothing', async () => {
  const t = await sandbox();
  const inside = path.join(t.claudeHome, 'a.txt');
  await writeFile(inside, 'new');
  const outside = path.join(t.root, 'outside.txt');
  await writeFile(outside, 'orig');
  const { dir } = await createBackup(t.stateDir, [inside, outside]);
  await writeFile(inside, 'changed');
  await writeFile(outside, 'changed');
  await assert.rejects(restoreBackup(dir, { allow: [t.claudeHome, t.claudeJson, t.stateDir] }), /outside/);
  assert.equal(await readFile(inside, 'utf8'), 'changed', 'validated before any write');
  assert.equal(await readFile(outside, 'utf8'), 'changed');
  await restoreBackup(dir, { allow: [t.claudeHome, t.root] });
  assert.equal(await readFile(outside, 'utf8'), 'orig');
  await rm(t.root, { recursive: true, force: true });
});

test('restore() only touches the claude home, the claude.json path and the state dir', async () => {
  const t = await sandbox();
  await install(t.opts());
  const outside = path.join(t.root, 'outside.txt');
  await writeFile(outside, 'orig');
  const { dir } = await createBackup(t.stateDir, [outside, path.join(t.claudeHome, 'settings.json')]);
  await writeFile(outside, 'changed');
  await assert.rejects(restore(t.opts({ backup: path.basename(dir) })), /outside/);
  assert.equal(await readFile(outside, 'utf8'), 'changed');
  await rm(t.root, { recursive: true, force: true });
});
