import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installCodex, uninstallCodex, statusCodex } from '../src/install/codex.js';
import { install } from '../src/install/installer.js';
import { loadManifest } from '../src/install/assets.js';
import { codexSandbox, exists } from './helpers/codex.js';

test('every manifest skill lands in the Codex skills dir with the same content as Claude', async () => {
  const t = await codexSandbox();
  const claudeHome = path.join(t.root, 'claude');
  await install({ claudeHome, claudeJson: path.join(t.root, 'c.json'), stateDir: path.join(t.root, 'cstate'), searchPath: '' });
  const res = await installCodex(t.opts());
  const manifest = await loadManifest();
  for (const skill of manifest.skills) {
    const mine = await readFile(path.join(t.skillsDir, skill, 'SKILL.md'));
    assert.ok(mine.equals(await readFile(path.join(claudeHome, 'skills', skill, 'SKILL.md'))), skill);
  }
  assert.ok(await exists(path.join(t.skillsDir, '_shared')));
  assert.ok(!(await exists(path.join(t.skillsDir, 'sdd-init'))), 'SDD is opt-in');
  assert.ok(res.files.includes(`skills/${manifest.skills[0]}/SKILL.md`));
});

test('--with-sdd adds only the SDD skills (no commands, no agents) and turning it off removes them', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts({ withSdd: true }));
  const manifest = await loadManifest();
  for (const skill of manifest.sdd.skills) assert.ok(await exists(path.join(t.skillsDir, skill, 'SKILL.md')), skill);
  assert.ok(!(await exists(t.p('commands'))));
  assert.ok(!(await exists(t.p('agents'))));
  const off = await installCodex(t.opts({ withSdd: false }));
  assert.ok(off.removed.some((r) => r.includes('sdd-init')));
  assert.ok(!(await exists(path.join(t.skillsDir, 'sdd-init'))));
});

test('an edited skill is kept unless forced; a foreign skill is never touched', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts());
  const skill = path.join(t.skillsDir, 'chained-pr', 'SKILL.md');
  await mkdir(path.join(t.skillsDir, 'my-own'), { recursive: true });
  await writeFile(path.join(t.skillsDir, 'my-own', 'SKILL.md'), 'mine\n');
  await writeFile(skill, 'edited\n');
  const res = await installCodex(t.opts());
  assert.ok(res.skipped.includes('skills/chained-pr/SKILL.md'));
  assert.equal(await readFile(skill, 'utf8'), 'edited\n');
  assert.equal((await installCodex(t.opts({ force: true }))).skipped.length, 0);
  assert.notEqual(await readFile(skill, 'utf8'), 'edited\n');
  await uninstallCodex(t.opts());
  assert.equal(await readFile(path.join(t.skillsDir, 'my-own', 'SKILL.md'), 'utf8'), 'mine\n');
  assert.ok(!(await exists(path.join(t.skillsDir, 'chained-pr'))));
  assert.deepEqual(await readdir(t.skillsDir), ['my-own']);
});

test('uninstall keeps an edited skill and reports it; re-install is idempotent', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts());
  assert.equal((await installCodex(t.opts())).changed, false);
  await writeFile(path.join(t.skillsDir, 'doc-formats', 'SKILL.md'), 'edited\n');
  const un = await uninstallCodex(t.opts());
  assert.ok(un.kept.includes('skills/doc-formats/SKILL.md'));
  assert.equal(await readFile(path.join(t.skillsDir, 'doc-formats', 'SKILL.md'), 'utf8'), 'edited\n');
});

test('status flags a modified or missing skill', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts());
  assert.equal((await statusCodex(t.opts())).ok, true);
  await writeFile(path.join(t.skillsDir, 'chained-pr', 'SKILL.md'), 'edited\n');
  const s = await statusCodex(t.opts());
  assert.ok(s.items.some((i) => i.name === 'skill chained-pr/SKILL.md' && !i.ok && /modified/.test(i.detail)));
});
