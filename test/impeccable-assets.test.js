import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadManifest, assetPath, listFiles, readAssetText, repoRoot } from '../src/install/assets.js';

const DIR = 'skills/impeccable';
const PLACEHOLDERS = new Set(['{{AMAUTA_IMPECCABLE_DIR}}', '{{AMAUTA_IMPECCABLE_CLI}}']);
const mdFiles = async () => (await listFiles(assetPath(DIR))).filter((f) => f.endsWith('.md')).map((f) => f.split(path.sep).join('/'));

test('manifest records the impeccable skill, its pinned engine and Apache-2.0 provenance; it is opt-in', async () => {
  const m = await loadManifest();
  assert.ok(m.impeccable, 'manifest.impeccable block');
  assert.equal(m.impeccable.skillDir, DIR);
  assert.deepEqual(m.impeccable.engine, { package: 'impeccable', version: '3.6.1' });
  assert.equal(m.impeccable.upstream.repo, 'pbakaus/impeccable');
  assert.equal(m.impeccable.upstream.tag, 'skill-v3.9.1');
  assert.match(m.impeccable.upstream.commit, /^[0-9a-f]{40}$/);
  assert.equal(m.impeccable.upstream.license, 'Apache-2.0');
  assert.ok(!m.skills.includes('impeccable'), 'impeccable must not be an always-installed skill');
  assert.ok(existsSync(assetPath(`${DIR}/SKILL.md`)));
});

test('NOTICE credits impeccable under Apache-2.0 and the license text ships with the skill', async () => {
  const notice = await readFile(path.join(repoRoot, 'NOTICE'), 'utf8');
  assert.match(notice, /pbakaus\/impeccable/);
  assert.match(notice, /Apache License, Version 2\.0|Apache-2\.0/);
  assert.match(notice, /44c27a72af98394c32691ba79358811bff86bde6/);
  assert.match(notice, /impeccable@3\.6\.1/);
  assert.match(await readAssetText(`${DIR}/LICENSE`), /Apache License\s+Version 2\.0/);
});

test('skill markdown calls only installed helpers: no npx, no project-local copies, no pin/hooks, only known placeholders', async () => {
  const skill = await readAssetText(`${DIR}/SKILL.md`);
  assert.match(skill, /^name: impeccable$/m);
  assert.ok(!/^allowed-tools:/m.test(skill), 'no pre-approved tools');
  for (const rel of await mdFiles()) {
    const text = await readAssetText(`${DIR}/${rel}`);
    assert.ok(!/npx impeccable/.test(text), `${rel}: npx`);
    assert.ok(!/\.(claude|agents|cursor|github)\/skills\/impeccable/.test(text), `${rel}: project-local path`);
    assert.ok(!/hook-admin|pin\.mjs|reference\/hooks\.md/.test(text), `${rel}: removed helper`);
    for (const p of text.match(/\{\{AMAUTA_[^}]*\}\}/g) ?? []) assert.ok(PLACEHOLDERS.has(p), `${rel}: unknown placeholder ${p}`);
  }
  assert.ok(!existsSync(assetPath(`${DIR}/reference/hooks.md`)));
  assert.match(skill, /\{\{AMAUTA_IMPECCABLE_CLI\}\} detect/);
});

test('every skill script named in the markdown exists in the vendored tree', async () => {
  for (const rel of await mdFiles()) {
    const text = await readAssetText(`${DIR}/${rel}`);
    for (const m of text.matchAll(/\{\{AMAUTA_IMPECCABLE_DIR\}\}\/(scripts\/[\w./-]+\.(?:mjs|js))/g)) {
      assert.ok(existsSync(assetPath(`${DIR}/${m[1]}`)), `${rel} names missing ${m[1]}`);
    }
  }
});
