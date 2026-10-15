import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadManifest, readAssetText, repoRoot } from '../src/install/assets.js';
import { install, uninstall, status } from '../src/install/installer.js';

const exists = (p) => stat(p).then(() => true, () => false);

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-semskill-'));
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state') };
  t.opts = () => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: '' });
  return t;
}

test('the graphify-semantic skill is vendored with a trigger description and the dispatch contract', async () => {
  const manifest = await loadManifest();
  assert.ok(manifest.skills.includes('graphify-semantic'));
  const text = await readAssetText('skills/graphify-semantic/SKILL.md');
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(front, 'frontmatter');
  assert.match(front[1], /^name: graphify-semantic$/m);
  assert.match(front[1], /^description: ".*Trigger:.*"$/m);
  // The dispatch contract the manual flow proved: one message, general-purpose agents, Haiku, a rendered prompt file each.
  assert.match(text, /subagent_type: "general-purpose"/);
  assert.match(text, /model: "haiku"/);
  assert.match(text, /ONE message/i);
  assert.match(text, /gentle_lite\.graph\.semantic_plan/);
  assert.match(text, /<prefix> plan/);
  assert.match(text, /<prefix> validate/);
  assert.match(text, /<prefix> merge/);
  assert.match(text, /prompt_file/);
  // Cost honesty: a real confirmation above the chunk threshold, usage-limit warning, report of tokens and deltas.
  assert.match(text, /usage limits/i);
  assert.match(text, /more than 3 chunks/i);
  assert.match(text, /AskUserQuestion|ask the user/i);
  assert.match(text, /nodes?/i);
  assert.match(text, /tokens/i);
  assert.match(text, /gentle-lite graphify semantic/); // headless alternative (API key)
  assert.doesNotMatch(text, /gentle-ai/);
  assert.ok(text.length < 6000, `skill is ${text.length} chars; keep it concise`);
});

test('install renders the helper path, status lists the skill, uninstall removes it', async () => {
  const t = await sandbox();
  try {
    await install(t.opts());
    const file = path.join(t.claudeHome, 'skills', 'graphify-semantic', 'SKILL.md');
    const text = await readFile(file, 'utf8');
    assert.ok(!text.includes('{{'), 'unresolved placeholder');
    assert.ok(text.includes(`PYTHONPATH=${path.join(repoRoot, 'python')} python3 -P -m gentle_lite.graph.semantic_plan`), 'absolute helper command');
    const s = await status(t.opts());
    const item = s.items.find((i) => i.name === 'file skills/graphify-semantic/SKILL.md');
    assert.ok(item?.ok, 'status tracks the managed skill file');
    await uninstall(t.opts());
    assert.ok(!(await exists(file)));
  } finally {
    await rm(t.root, { recursive: true, force: true });
  }
});
