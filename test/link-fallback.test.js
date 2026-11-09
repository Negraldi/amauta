// Copy fallback for skill links (plan N8b): when a directory link (junction on Windows) cannot be created, the skill is
// copied from the store with a marker; the copy counts as managed, is refreshed when the store changes and is removed
// on uninstall. A failing link function is injected so this runs on every OS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyLinks, planManagedLinks, removeLinks, COPY_MARKER } from '../src/install/skillstore.js';
import { tempDir } from './helpers/tmp.js';

const noLinks = async () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };
const exists = (p) => stat(p).then(() => true, () => false);

async function world() {
  const root = await tempDir('copy-');
  const storeDir = path.join(root, 'store');
  const skillsDir = path.join(root, 'skills');
  await mkdir(path.join(storeDir, 'demo'), { recursive: true });
  await writeFile(path.join(storeDir, 'demo', 'SKILL.md'), 'v1\n');
  const rendered = new Map([['skills/demo/SKILL.md', Buffer.from('v1\n')]]);
  const plan = (r = rendered) => planManagedLinks({ skillsDir, storeDir, names: ['demo'], rendered: r });
  return { root, storeDir, skillsDir, rendered, plan };
}

test('a link that cannot be created becomes a marked copy of the store', async () => {
  const w = await world();
  await applyLinks(await w.plan(), w.skillsDir, { symlink: noLinks });
  assert.equal(await readFile(path.join(w.skillsDir, 'demo', 'SKILL.md'), 'utf8'), 'v1\n');
  assert.equal((await readFile(path.join(w.skillsDir, 'demo', COPY_MARKER), 'utf8')).trim(), path.join(w.storeDir, 'demo'));
});

test('a current copy needs nothing; a stale one is refreshed; uninstall removes it', async () => {
  const w = await world();
  await applyLinks(await w.plan(), w.skillsDir, { symlink: noLinks });
  const again = await w.plan();
  assert.deepEqual([again.link.length, again.foreign.length], [0, 0], 'an up-to-date copy is ours and complete');
  await writeFile(path.join(w.storeDir, 'demo', 'SKILL.md'), 'v2\n');
  const stale = await w.plan(new Map([['skills/demo/SKILL.md', Buffer.from('v2\n')]]));
  assert.equal(stale.link.length, 1);
  await applyLinks(stale, w.skillsDir, { symlink: noLinks });
  assert.equal(await readFile(path.join(w.skillsDir, 'demo', 'SKILL.md'), 'utf8'), 'v2\n');
  const gone = await removeLinks(w.skillsDir, { demo: path.join(w.storeDir, 'demo') });
  assert.deepEqual(gone, ['demo']);
  assert.equal(await exists(path.join(w.skillsDir, 'demo')), false);
});

test('a directory without the marker is still the user\'s and is left alone', async () => {
  const w = await world();
  await mkdir(path.join(w.skillsDir, 'demo'), { recursive: true });
  await writeFile(path.join(w.skillsDir, 'demo', 'SKILL.md'), 'mine\n');
  const p = await w.plan();
  assert.deepEqual(p.foreign, ['demo']);
});

test('status accepts a marked copy as the skill link', async () => {
  const { install, status } = await import('../src/install/installer.js');
  const root = await tempDir('copy-status-');
  const opts = { claudeHome: path.join(root, '.claude'), claudeJson: path.join(root, 'claude.json'), stateDir: path.join(root, 'state'), searchPath: '' };
  await install(opts);
  const state = JSON.parse(await readFile(path.join(opts.stateDir, 'state.json'), 'utf8'));
  const [name, target] = Object.entries(state.skill_links)[0];
  const dest = path.join(opts.claudeHome, 'skills', name);
  await (await import('node:fs/promises')).rm(dest, { force: true });
  await applyLinks({ link: [{ name, dest, target, replace: false }], unlink: [] }, path.join(opts.claudeHome, 'skills'), { symlink: noLinks });
  const s = await status(opts);
  assert.ok(s.ok, JSON.stringify(s.checks?.filter((c) => !c.ok)));
});
