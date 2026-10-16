import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadManifest, assetPath, readAssetText } from '../src/install/assets.js';
import { install } from '../src/install/installer.js';

const STACK = ['cpp-testing', 'python-testing', 'node-testing', 'r-testing', 'tabular-data', 'doc-formats'];

test('go-testing is gone from the manifest and from disk', async () => {
  const m = await loadManifest();
  assert.ok(!m.skills.includes('go-testing'));
  assert.ok(!existsSync(assetPath('skills/go-testing')));
  assert.doesNotMatch(await readAssetText('skills/_shared/skill-resolver.md'), /go-testing/);
});

test('the stack skills are registered and have valid, trigger-first frontmatter', async () => {
  const m = await loadManifest();
  for (const name of STACK) {
    assert.ok(m.skills.includes(name), `${name} not in manifest`);
    const text = await readAssetText(`skills/${name}/SKILL.md`);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, `${name}: no frontmatter`);
    assert.match(fm[1], new RegExp(`^name: ${name}$`, 'm'));
    assert.match(fm[1], /^description: "Trigger: [^"\n]+"$/m, `${name}: description must start with Trigger:`);
    assert.match(fm[1], /^license: /m);
    assert.ok(text.length < 6000, `${name}: body too long (${text.length})`);
    assert.doesNotMatch(text, /^##+ Keywords/im);
  }
});

test('install puts the stack skills under ~/.claude/skills and no go-testing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-stackskills-'));
  const claudeHome = path.join(root, 'home', '.claude');
  try {
    await install({ claudeHome, claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state'), searchPath: '' });
    for (const name of STACK) assert.ok((await stat(path.join(claudeHome, 'skills', name, 'SKILL.md'))).isFile(), name);
    assert.ok(!existsSync(path.join(claudeHome, 'skills', 'go-testing')));
    assert.match(await readFile(path.join(claudeHome, 'skills', 'doc-formats', 'SKILL.md'), 'utf8'), /pptx/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
