// Personal skills fall back to a marked copy when the symlink cannot be made (Windows without developer mode, FAT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COPY_MARKER, removePersonalLinks, syncPersonalSkills } from '../src/install/skillstore.js';

const eperm = async () => {
  throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
};

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'amauta-pcopy-'));
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  const stateDir = path.join(root, 'state');
  await mkdir(path.join(a, 'mine'), { recursive: true });
  await writeFile(path.join(a, 'mine', 'SKILL.md'), 'v1\n');
  await mkdir(b, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const sync = (extra = {}) => syncPersonalSkills({ stateDir, sides: [{ dir: a }, { dir: b }], symlink: eperm, ...extra });
  return { root, a, b, stateDir, sync, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('a refused symlink becomes a marked copy that is recorded', async () => {
  const t = await setup();
  try {
    const res = await t.sync();
    assert.deepEqual(res.copied, ['mine']);
    assert.deepEqual(res.linked, []);
    assert.equal(await readFile(path.join(t.b, 'mine', 'SKILL.md'), 'utf8'), 'v1\n');
    assert.equal((await readFile(path.join(t.b, 'mine', COPY_MARKER), 'utf8')).trim(), path.join(t.a, 'mine'));
    const rec = JSON.parse(await readFile(path.join(t.stateDir, 'personal-skills.json'), 'utf8'));
    assert.ok(JSON.stringify(rec).includes(path.join(t.b, 'mine')));
  } finally { await t.cleanup(); }
});

test('a second sync refreshes a changed copy and reports no conflict', async () => {
  const t = await setup();
  try {
    await t.sync();
    const same = await t.sync();
    assert.deepEqual(same, { linked: [], copied: [], removed: [], conflicts: [] });
    await writeFile(path.join(t.a, 'mine', 'SKILL.md'), 'v2\n');
    await writeFile(path.join(t.a, 'mine', 'extra.md'), 'x\n');
    const res = await t.sync();
    assert.deepEqual(res.copied, ['mine']);
    assert.deepEqual(res.conflicts, []);
    assert.equal(await readFile(path.join(t.b, 'mine', 'SKILL.md'), 'utf8'), 'v2\n');
    assert.equal(await readFile(path.join(t.b, 'mine', 'extra.md'), 'utf8'), 'x\n');
    assert.deepEqual((await readdir(path.join(t.a))).sort(), ['mine'], 'the copy is not mistaken for a personal skill');
  } finally { await t.cleanup(); }
});

test('deleting the target removes the copy', async () => {
  const t = await setup();
  try {
    await t.sync();
    await rm(path.join(t.a, 'mine'), { recursive: true });
    const res = await t.sync();
    assert.deepEqual(res.removed, ['mine']);
    assert.deepEqual(await readdir(t.b), []);
  } finally { await t.cleanup(); }
});

test('a foreign directory at the destination stays a conflict', async () => {
  const t = await setup();
  try {
    await mkdir(path.join(t.b, 'mine'));
    await writeFile(path.join(t.b, 'mine', 'SKILL.md'), 'theirs\n');
    const res = await t.sync();
    assert.deepEqual(res.conflicts, ['mine']);
    assert.deepEqual(res.copied, []);
    assert.equal(await readFile(path.join(t.b, 'mine', 'SKILL.md'), 'utf8'), 'theirs\n');
  } finally { await t.cleanup(); }
});

test('a recorded copy whose marker names another target is never overwritten', async () => {
  const t = await setup();
  try {
    await t.sync();
    await writeFile(path.join(t.b, 'mine', COPY_MARKER), '/somewhere/else\n');
    await writeFile(path.join(t.a, 'mine', 'SKILL.md'), 'v2\n');
    const res = await t.sync();
    assert.deepEqual(res.conflicts, ['mine']);
    assert.equal(await readFile(path.join(t.b, 'mine', 'SKILL.md'), 'utf8'), 'v1\n');
  } finally { await t.cleanup(); }
});

test('removePersonalLinks removes recorded copies', async () => {
  const t = await setup();
  try {
    await t.sync();
    await removePersonalLinks({ stateDir: t.stateDir, skillsDir: t.b });
    assert.deepEqual(await readdir(t.b), []);
    assert.deepEqual(await readdir(path.join(t.a, 'mine')), ['SKILL.md']);
  } finally { await t.cleanup(); }
});

test('removePersonalLinks keeps a copy whose marker no longer matches', async () => {
  const t = await setup();
  try {
    await t.sync();
    await writeFile(path.join(t.b, 'mine', COPY_MARKER), '/somewhere/else\n');
    await removePersonalLinks({ stateDir: t.stateDir, skillsDir: t.b });
    assert.deepEqual((await readdir(t.b)).sort(), ['mine']);
  } finally { await t.cleanup(); }
});

test('dry run writes nothing', async () => {
  const t = await setup();
  try {
    const res = await t.sync({ dryRun: true });
    assert.deepEqual(res.linked, ['mine']);
    assert.deepEqual(await readdir(t.b), []);
    await assert.rejects(readFile(path.join(t.stateDir, 'personal-skills.json')));
  } finally { await t.cleanup(); }
});
