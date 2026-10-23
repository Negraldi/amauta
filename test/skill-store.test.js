import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readlink, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { install, uninstall } from '../src/install/installer.js';
import { installCodex, uninstallCodex, statusCodex } from '../src/install/codex.js';
import { loadManifest } from '../src/install/assets.js';
import { codexSandbox, exists } from './helpers/codex.js';

/** Claude and Codex sandboxes sharing one state dir (the amauta store lives there). */
async function both(seed) {
  const t = await codexSandbox(seed);
  const claudeHome = path.join(t.root, 'claude');
  const claudeJson = path.join(t.root, 'claude.json');
  const c = { claudeHome, claudeJson, stateDir: t.stateDir, searchPath: '' };
  t.claude = (extra = {}) => ({ ...c, ...extra });
  t.codex = (extra = {}) => t.opts({ claudeHome, claudeJson, ...extra });
  t.store = (...a) => path.join(t.stateDir, 'skills', ...a);
  t.cskills = (...a) => path.join(claudeHome, 'skills', ...a);
  return t;
}
const isLinkTo = async (p, target) => (await lstat(p)).isSymbolicLink() && (await readlink(p)) === target;

test('managed skills are rendered once into the store and both runtimes link to it', async () => {
  const t = await both();
  await install(t.claude());
  await installCodex(t.codex());
  const manifest = await loadManifest();
  for (const skill of [...manifest.skills, '_shared']) {
    assert.ok(await isLinkTo(t.cskills(skill), t.store(skill)), `claude ${skill}`);
    assert.ok(await isLinkTo(path.join(t.skillsDir, skill), t.store(skill)), `codex ${skill}`);
  }
  assert.ok((await readFile(t.store('chained-pr', 'SKILL.md'))).equals(await readFile(path.join(t.skillsDir, 'chained-pr', 'SKILL.md'))));
  assert.equal((await install(t.claude())).changed, false);
  assert.equal((await installCodex(t.codex())).changed, false);
});

test('impeccable and archify are rendered for the store paths and reach Codex too', async () => {
  const t = await both();
  await install(t.claude({ withArchify: true }));
  const r = await installCodex(t.codex());
  assert.ok(await isLinkTo(path.join(t.skillsDir, 'archify'), t.store('archify')), 'Codex follows the modules the Claude install has');
  assert.ok(await exists(path.join(t.skillsDir, 'archify', 'bin', 'archify.mjs')));
  assert.equal(r.skipped.length, 0);
  const off = await install(t.claude({ withArchify: false }));
  assert.ok(await exists(t.store('archify')), 'the Codex install still wants it');
  await installCodex(t.codex({ withArchify: false }));
  assert.ok(!(await exists(t.store('archify'))));
  assert.ok(!(await exists(path.join(t.skillsDir, 'archify'))));
  assert.ok(!(await exists(t.cskills('archify'))));
  assert.ok(off);
});

test('an unedited real copy in the Claude home migrates to a link; an edited one is kept and reported', async () => {
  const t = await both();
  await install(t.claude());
  // Rebuild the pre-store layout for two skills: real directories with the same bytes.
  for (const name of ['doc-formats', 'chained-pr']) {
    const { rm } = await import('node:fs/promises');
    await rm(t.cskills(name), { force: true });
    await mkdir(t.cskills(name), { recursive: true });
    await writeFile(t.cskills(name, 'SKILL.md'), await readFile(t.store(name, 'SKILL.md')));
  }
  await writeFile(t.cskills('chained-pr', 'SKILL.md'), 'my edit\n');
  const res = await install(t.claude());
  assert.ok(await isLinkTo(t.cskills('doc-formats'), t.store('doc-formats')));
  assert.equal((await lstat(t.cskills('chained-pr'))).isSymbolicLink(), false);
  assert.equal(await readFile(t.cskills('chained-pr', 'SKILL.md'), 'utf8'), 'my edit\n');
  assert.ok(res.skipped.some((s) => s.startsWith('skills/chained-pr')));
  await install(t.claude({ force: true }));
  assert.ok(await isLinkTo(t.cskills('chained-pr'), t.store('chained-pr')));
});

test('a real directory of the same name in the Codex skills dir is foreign: left and reported', async () => {
  const t = await both();
  await mkdir(path.join(t.skillsDir, 'doc-formats'), { recursive: true });
  await writeFile(path.join(t.skillsDir, 'doc-formats', 'SKILL.md'), 'mine\n');
  const res = await installCodex(t.codex());
  assert.ok(res.skipped.some((s) => s.startsWith('skills/doc-formats')));
  assert.equal(await readFile(path.join(t.skillsDir, 'doc-formats', 'SKILL.md'), 'utf8'), 'mine\n');
  await uninstallCodex(t.codex());
  assert.equal(await readFile(path.join(t.skillsDir, 'doc-formats', 'SKILL.md'), 'utf8'), 'mine\n');
  assert.deepEqual(await readdir(t.skillsDir), ['doc-formats']);
});

test('personal skills are linked both ways; the real directory stays where it was made', async () => {
  const t = await both();
  await install(t.claude());
  await mkdir(t.cskills('reorganizar-proyecto'), { recursive: true });
  await writeFile(t.cskills('reorganizar-proyecto', 'SKILL.md'), 'claude personal\n');
  await mkdir(path.join(t.skillsDir, 'from-codex'), { recursive: true });
  await writeFile(path.join(t.skillsDir, 'from-codex', 'SKILL.md'), 'codex personal\n');
  await installCodex(t.codex());
  assert.ok(await isLinkTo(path.join(t.skillsDir, 'reorganizar-proyecto'), t.cskills('reorganizar-proyecto')));
  assert.ok(await isLinkTo(t.cskills('from-codex'), path.join(t.skillsDir, 'from-codex')));
  assert.equal((await lstat(t.cskills('reorganizar-proyecto'))).isSymbolicLink(), false);
  assert.equal((await lstat(path.join(t.skillsDir, 'from-codex'))).isSymbolicLink(), false);
  assert.equal((await installCodex(t.codex())).changed, false, 'idempotent, and links are not mistaken for personal skills');
  // uninstalling Codex removes only the links it made in the Codex dir
  await uninstallCodex(t.codex());
  assert.ok(!(await exists(path.join(t.skillsDir, 'reorganizar-proyecto'))));
  assert.equal(await readFile(t.cskills('reorganizar-proyecto', 'SKILL.md'), 'utf8'), 'claude personal\n');
  assert.ok(await exists(path.join(t.skillsDir, 'from-codex', 'SKILL.md')));
  await uninstall(t.claude());
  assert.ok(!(await exists(t.cskills('from-codex'))));
  assert.equal(await readFile(path.join(t.skillsDir, 'from-codex', 'SKILL.md'), 'utf8'), 'codex personal\n');
});

test('a personal skill whose name exists on the other side as a real directory is a conflict, never overwritten', async () => {
  const t = await both();
  await install(t.claude());
  for (const [dir, text] of [[t.cskills('dup'), 'a\n'], [path.join(t.skillsDir, 'dup'), 'b\n']]) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), text);
  }
  const res = await installCodex(t.codex());
  assert.deepEqual(res.personal.conflicts, ['dup']);
  assert.equal(await readFile(t.cskills('dup', 'SKILL.md'), 'utf8'), 'a\n');
  assert.equal(await readFile(path.join(t.skillsDir, 'dup', 'SKILL.md'), 'utf8'), 'b\n');
});

test('status checks the links of both runtimes; uninstalling both leaves no store behind', async () => {
  const t = await both();
  await install(t.claude());
  await installCodex(t.codex());
  assert.equal((await statusCodex(t.codex())).ok, true);
  await uninstall(t.claude());
  assert.ok(await exists(t.store('chained-pr', 'SKILL.md')), 'Codex still uses the store');
  assert.equal((await statusCodex(t.codex())).ok, true);
  await uninstallCodex(t.codex());
  assert.ok(!(await exists(t.store())));
  assert.ok(!(await exists(t.cskills())));
  assert.ok(!(await exists(t.skillsDir)));
});
