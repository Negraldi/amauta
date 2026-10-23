import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { installCodex, uninstallCodex, statusCodex } from '../src/install/codex.js';
import { listSections } from '../src/core/markers.js';
import { codexSandbox, exists } from './helpers/codex.js';

const IDS = ['codegraph-guidance', 'persona', 'engram-protocol', 'orchestrator'];

test('install writes the always-on blocks into AGENTS.md and skips Claude-only assets', async () => {
  const t = await codexSandbox();
  const res = await installCodex(t.opts());
  assert.equal(res.changed, true);
  const md = await t.read('AGENTS.md');
  const ids = listSections(md).map((s) => s.id);
  for (const id of IDS) assert.ok(ids.includes(id), `missing section ${id}`);
  assert.ok(!(await exists(t.p('output-styles'))));
  assert.ok(!(await exists(t.p('agents'))));
  assert.ok(!(await exists(t.p('CLAUDE.md'))));
});

test('AGENTS.md blocks equal the CLAUDE.md blocks of the same manifest', async () => {
  const t = await codexSandbox();
  const { install } = await import('../src/install/installer.js');
  const claudeHome = `${t.root}/claude`;
  await install({ claudeHome, claudeJson: `${t.root}/c.json`, stateDir: `${t.root}/cstate`, searchPath: '' });
  await installCodex(t.opts());
  const claude = listSections(await readFile(`${claudeHome}/CLAUDE.md`, 'utf8'));
  const codex = listSections(await t.read('AGENTS.md'));
  assert.deepEqual(codex, claude);
});

test('re-install is idempotent', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts());
  const before = await t.read('AGENTS.md');
  const again = await installCodex(t.opts());
  assert.equal(again.changed, false);
  assert.deepEqual(again.files, []);
  assert.equal(await t.read('AGENTS.md'), before);
});

test('foreign AGENTS.md content survives install and uninstall byte for byte', async () => {
  const mine = '# Mine\n\nplain text, no amauta blocks.\n';
  const t = await codexSandbox({ 'AGENTS.md': mine });
  await installCodex(t.opts());
  assert.ok((await t.read('AGENTS.md')).startsWith(mine));
  await uninstallCodex(t.opts());
  assert.equal(await t.read('AGENTS.md'), mine);
});

test('uninstall deletes a file amauta created and the state, and a second run is a no-op', async () => {
  const t = await codexSandbox();
  await installCodex(t.opts());
  const res = await uninstallCodex(t.opts());
  assert.equal(res.changed, true);
  assert.ok(!(await exists(t.p('AGENTS.md'))));
  assert.ok(!(await exists(`${t.stateDir}/codex-state.json`)));
  assert.equal((await uninstallCodex(t.opts())).changed, false);
});

test('dry run writes nothing', async () => {
  const t = await codexSandbox();
  const res = await installCodex(t.opts({ dryRun: true }));
  assert.equal(res.dryRun, true);
  assert.ok(res.files.includes('AGENTS.md'));
  assert.ok(!(await exists(t.p('AGENTS.md'))));
  assert.deepEqual(await readdir(t.codexHome), []);
});

test('status reports the blocks and is not installed before install', async () => {
  const t = await codexSandbox();
  assert.equal((await statusCodex(t.opts())).installed, false);
  await installCodex(t.opts());
  const s = await statusCodex(t.opts());
  assert.equal(s.installed, true);
  for (const id of IDS) assert.ok(s.items.some((i) => i.name === `AGENTS.md section ${id}` && i.ok), id);
  await writeFile(t.p('AGENTS.md'), '');
  const broken = await statusCodex(t.opts());
  assert.equal(broken.ok, false);
});

test('restore brings Codex files back from a Codex backup (same mechanism as Claude)', async () => {
  const { restore } = await import('../src/install/installer.js');
  const mine = '# Mine\n';
  const t = await codexSandbox({ 'AGENTS.md': mine });
  const res = await installCodex(t.opts());
  assert.ok(res.backup);
  assert.notEqual(await t.read('AGENTS.md'), mine);
  const id = res.backup.split('/').at(-1);
  const r = await restore(t.opts({ backup: id }));
  assert.ok(r.restored.some((f) => f.endsWith('AGENTS.md')));
  assert.equal(await t.read('AGENTS.md'), mine);
  assert.ok(!(await exists(`${t.stateDir}/codex-state.json`)));
});
