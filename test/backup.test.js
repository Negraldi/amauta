import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, chmod, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBackup, restoreBackup, listBackups } from '../src/core/backup.js';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'gl-backup-'));
const exists = (p) => stat(p).then(() => true, () => false);

test('createBackup copies files and writes a manifest', async () => {
  const d = await tmp();
  const state = path.join(d, 'state');
  const a = path.join(d, 'a.txt');
  const missing = path.join(d, 'missing.txt');
  await writeFile(a, 'AAA');
  await chmod(a, 0o600);
  const { dir, manifest } = await createBackup(state, [a, missing]);
  assert.ok(dir.startsWith(path.join(state, 'backups')));
  assert.equal(manifest.schema, 'gentle-lite.backup/v1');
  assert.ok(!Number.isNaN(Date.parse(manifest.created_at)));
  assert.equal(manifest.entries.length, 2);
  const [ea, em] = manifest.entries;
  assert.equal(ea.original_path, a);
  assert.equal(ea.existed, true);
  assert.equal(ea.mode, 0o600);
  assert.equal(await readFile(path.join(dir, ea.snapshot_path), 'utf8'), 'AAA');
  assert.equal(em.existed, false);
  assert.equal(em.snapshot_path, null);
  const onDisk = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(onDisk, manifest);
  await rm(d, { recursive: true });
});

test('restoreBackup restores contents and mode, and deletes files that did not exist', async () => {
  const d = await tmp();
  const state = path.join(d, 'state');
  const a = path.join(d, 'sub', 'a.txt');
  const created = path.join(d, 'created.txt');
  await mkdir(path.dirname(a), { recursive: true });
  await writeFile(a, 'orig');
  await chmod(a, 0o640);
  const { dir } = await createBackup(state, [a, created]);
  await writeFile(a, 'changed');
  await chmod(a, 0o644);
  await writeFile(created, 'new file');
  await restoreBackup(dir);
  assert.equal(await readFile(a, 'utf8'), 'orig');
  assert.equal((await stat(a)).mode & 0o777, 0o640);
  assert.equal(await exists(created), false);
  await rm(d, { recursive: true });
});

test('restoreBackup recreates a deleted parent directory', async () => {
  const d = await tmp();
  const a = path.join(d, 'gone', 'a.txt');
  await mkdir(path.dirname(a), { recursive: true });
  await writeFile(a, 'v1');
  const { dir } = await createBackup(path.join(d, 'state'), [a]);
  await rm(path.join(d, 'gone'), { recursive: true });
  await restoreBackup(dir);
  assert.equal(await readFile(a, 'utf8'), 'v1');
  await rm(d, { recursive: true });
});

test('listBackups returns newest first and tolerates no backups dir', async () => {
  const d = await tmp();
  const state = path.join(d, 'state');
  assert.deepEqual(await listBackups(state), []);
  const f = path.join(d, 'f');
  await writeFile(f, '1');
  const b1 = await createBackup(state, [f], { now: new Date('2026-01-01T00:00:00Z') });
  const b2 = await createBackup(state, [f], { now: new Date('2026-01-02T00:00:00Z') });
  const list = await listBackups(state);
  assert.deepEqual(list.map((b) => b.dir), [b2.dir, b1.dir]);
  assert.equal(list[0].manifest.schema, 'gentle-lite.backup/v1');
  await rm(d, { recursive: true });
});

test('two backups in the same second get distinct directories', async () => {
  const d = await tmp();
  const f = path.join(d, 'f');
  await writeFile(f, '1');
  const now = new Date('2026-01-01T00:00:00Z');
  const b1 = await createBackup(path.join(d, 's'), [f], { now });
  const b2 = await createBackup(path.join(d, 's'), [f], { now });
  assert.notEqual(b1.dir, b2.dir);
  await rm(d, { recursive: true });
});

test('duplicate paths are snapshotted once', async () => {
  const d = await tmp();
  const f = path.join(d, 'f');
  await writeFile(f, '1');
  const { manifest } = await createBackup(path.join(d, 's'), [f, f]);
  assert.equal(manifest.entries.length, 1);
  await rm(d, { recursive: true });
});
