import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { install, uninstall, status } from '../src/install/installer.js';
import { main } from '../src/cli.js';
import { assetPath, loadManifest } from '../src/install/assets.js';

const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-arch-'));
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state') };
  await mkdir(t.claudeHome, { recursive: true });
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, ...extra });
  t.state = async () => JSON.parse(await readFile(path.join(t.stateDir, 'state.json'), 'utf8'));
  t.skill = path.join(t.claudeHome, 'skills', 'archify');
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}

test('manifest records archify provenance (MIT, pinned commit, patched files with checksums) and it is opt-in', async () => {
  const m = await loadManifest();
  assert.equal(m.archify.skillDir, 'skills/archify');
  assert.equal(m.archify.upstream.repo, 'tt-a1i/archify');
  assert.equal(m.archify.upstream.license, 'MIT');
  assert.match(m.archify.upstream.commit, /^[0-9a-f]{40}$/);
  assert.ok(!m.skills.includes('archify'), 'archify must not be an always-installed skill');
  for (const f of [...m.archify.files, ...m.archify.patched]) {
    assert.equal(sha(await readFile(assetPath(`skills/archify/${f.path}`))), f.sha256, `${f.path} checksum`);
  }
  const notice = await readFile(new URL('../NOTICE', import.meta.url), 'utf8');
  assert.match(notice, /tt-a1i\/archify/);
  assert.match(notice, new RegExp(m.archify.upstream.commit));
});

test('the vendored update check is permanently off, whatever the environment says', async () => {
  const { startDeliveryUpdateCheck } = await import(assetPath('skills/archify/bin/delivery-update.mjs'));
  const r = await startDeliveryUpdateCheck({ env: { ARCHIFY_UPDATE_CHECK_DISABLED: '0' } });
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'disabled');
  assert.equal(r.noticeRequired, false);
  const check = await readFile(assetPath('skills/archify/scripts/check-update.mjs'), 'utf8');
  assert.match(check, /function updatesDisabled\(\) \{[^}]*return true;/);
});

test('without --with-archify nothing is installed', async () => {
  const t = await sandbox();
  await install(t.opts());
  assert.equal((await t.state()).archify, false);
  assert.ok(!existsSync(t.skill));
  assert.ok(!(await status(t.opts())).items.some((i) => /archify/.test(i.name)));
  await t.cleanup();
});

test('--with-archify installs the skill byte for byte, sticky until uninstall, and status reports it', async () => {
  const t = await sandbox();
  await install(t.opts({ withArchify: true }));
  assert.equal((await t.state()).archify, true);
  for (const f of ['SKILL.md', 'LICENSE', 'bin/archify.mjs', 'schemas/architecture.schema.json', 'assets/template.html']) assert.ok(existsSync(path.join(t.skill, f)), f);
  assert.deepEqual(await readFile(path.join(t.skill, 'bin', 'archify.mjs')), await readFile(assetPath('skills/archify/bin/archify.mjs')));
  await install(t.opts());
  assert.equal((await t.state()).archify, true, 'sticky');
  const s = await status(t.opts());
  const item = s.items.find((i) => i.name === 'archify skill');
  assert.ok(item?.ok, JSON.stringify(item));
  assert.ok(s.ok);
  await rm(path.join(t.skill, 'bin', 'archify.mjs'));
  assert.equal((await status(t.opts())).items.find((i) => i.name === 'archify skill').ok, false);
  await install(t.opts());
  await uninstall(t.opts());
  assert.ok(!existsSync(t.skill), 'uninstall removes the skill');
  await t.cleanup();
});

test('--dry-run lists the skill files and writes nothing; the CLI flag is accepted', async () => {
  const t = await sandbox();
  const r = await install(t.opts({ withArchify: true, dryRun: true }));
  assert.ok(r.files.includes('skills/archify/SKILL.md'));
  assert.ok(!existsSync(t.stateDir));
  const out = sink();
  const code = await main(['install', '--with-archify', '--claude-home', t.claudeHome, '--claude-json', t.claudeJson, '--state-dir', t.stateDir], { stdout: out, stderr: sink() });
  assert.equal(code, 0);
  assert.equal((await t.state()).archify, true);
  await t.cleanup();
});

test('the vendored CLI renders a typed architecture JSON offline', async () => {
  const { execFile } = await import('node:child_process');
  const t = await sandbox();
  const json = path.join(t.root, 'a.json');
  await writeFile(json, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'T', output: 'a.html' }, layout: { mode: 'grid' }, components: [{ id: 'a', type: 'backend', label: 'A', row: 0, col: 0 }, { id: 'b', type: 'database', label: 'B', row: 0, col: 1 }], connections: [{ from: 'a', to: 'b' }] }));
  const out = path.join(t.root, 'a.html');
  const r = await new Promise((resolve) => execFile(process.execPath, [assetPath('skills/archify/bin/archify.mjs'), 'render', 'architecture', json, out], { env: { PATH: process.env.PATH, ARCHIFY_UPDATE_CHECK_DISABLED: '1' }, timeout: 60000 }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(r.error, null, r.stderr);
  assert.match(await readFile(out, 'utf8'), /<svg/);
  await t.cleanup();
});
