import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, readdir, writeFile, chmod, rm, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeFileAtomic } from '../src/core/fsatomic.js';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'gl-fsatomic-'));

test('creates parent directories and writes content', async () => {
  const d = await tmp();
  const f = path.join(d, 'a', 'b', 'file.txt');
  const changed = await writeFileAtomic(f, 'hi');
  assert.equal(changed, true);
  assert.equal(await readFile(f, 'utf8'), 'hi');
  await rm(d, { recursive: true });
});

test('applies an explicit mode (0600)', async () => {
  const d = await tmp();
  const f = path.join(d, 'claude.json');
  await writeFileAtomic(f, '{}', { mode: 0o600 });
  assert.equal((await stat(f)).mode & 0o777, 0o600);
  await rm(d, { recursive: true });
});

test('preserves the mode of an existing file when none is given', async () => {
  const d = await tmp();
  const f = path.join(d, 'x');
  await writeFile(f, 'old');
  await chmod(f, 0o640);
  await writeFileAtomic(f, 'new');
  assert.equal((await stat(f)).mode & 0o777, 0o640);
  assert.equal(await readFile(f, 'utf8'), 'new');
  await rm(d, { recursive: true });
});

test('skips the write when content and mode are identical', async () => {
  const d = await tmp();
  const f = path.join(d, 'x');
  await writeFileAtomic(f, 'same');
  const before = (await stat(f)).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await writeFileAtomic(f, 'same'), false);
  assert.equal((await stat(f)).mtimeMs, before);
  await rm(d, { recursive: true });
});

test('leaves no temp files behind', async () => {
  const d = await tmp();
  await writeFileAtomic(path.join(d, 'x'), '1');
  await writeFileAtomic(path.join(d, 'x'), '2');
  assert.deepEqual(await readdir(d), ['x']);
  await rm(d, { recursive: true });
});

test('accepts Buffers', async () => {
  const d = await tmp();
  const f = path.join(d, 'bin');
  await writeFileAtomic(f, Buffer.from([1, 2, 3]));
  assert.deepEqual([...(await readFile(f))], [1, 2, 3]);
  await rm(d, { recursive: true });
});

test('removes the temp file when the write fails and rethrows', async () => {
  const d = await tmp();
  const probe = await open(path.join(d, 'probe'), 'w');
  const proto = Object.getPrototypeOf(probe);
  await probe.close();
  const m = mock.method(proto, 'writeFile', async () => {
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
  try {
    await assert.rejects(writeFileAtomic(path.join(d, 'x'), 'data'), { code: 'ENOSPC' });
  } finally {
    m.mock.restore();
  }
  assert.deepEqual((await readdir(d)).sort(), ['probe']);
  await rm(d, { recursive: true });
});
