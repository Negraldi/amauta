import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadManifest, readAssetText, repoRoot } from '../src/install/assets.js';
import { install, uninstall, status } from '../src/install/installer.js';

const exists = (p) => stat(p).then(() => true, () => false);
const SKILL = 'amauta-wiki-explain';

test('the amauta-wiki-explain skill is shipped with a trigger description and the queue contract', async () => {
  const manifest = await loadManifest();
  assert.ok(manifest.skills.includes(SKILL));
  const text = await readAssetText(`skills/${SKILL}/SKILL.md`);
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(front, 'frontmatter');
  assert.match(front[1], new RegExp(`^name: ${SKILL}$`, 'm'));
  assert.match(front[1], /^description: ".*Trigger:.*wiki explanation requests.*"$/m);
  assert.match(text, /python3 -P -m amauta\.portal\.wikiexplain list/);
  assert.match(text, /python3 -P -m amauta\.portal\.wikiexplain write --kind .* --id .* --file/);
  assert.match(text, /source_hash|source material/i);
  assert.match(text, /never (invent|guess)|do not invent/i);
  assert.match(text, /secret|credential/i);
  assert.match(text, /no network|never (call|contact|fetch)/i);
  assert.doesNotMatch(text, /gentle-ai/);
  assert.ok(text.length < 5000, `skill is ${text.length} chars; keep it concise`);
});

test('the commands the skill names exist in the Python module', () => {
  const r = spawnSync('python3', ['-P', '-m', 'amauta.portal.wikiexplain', '--help'], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: path.join(repoRoot, 'python') } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\blist\b/);
  assert.match(r.stdout, /\bwrite\b/);
  const w = spawnSync('python3', ['-P', '-m', 'amauta.portal.wikiexplain', 'write', '--help'], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: path.join(repoRoot, 'python') } });
  for (const flag of ['--kind', '--id', '--file']) assert.match(w.stdout, new RegExp(flag));
});

test('install renders the helper path, status tracks the skill and uninstall removes it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-wikiskill-'));
  const opts = { claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state'), searchPath: '' };
  try {
    await install(opts);
    const file = path.join(opts.claudeHome, 'skills', SKILL, 'SKILL.md');
    const text = await readFile(file, 'utf8');
    assert.ok(!text.includes('{{'), 'unresolved placeholder');
    assert.ok(text.includes(`PYTHONPATH=${path.join(repoRoot, 'python')}`), 'absolute helper path');
    const s = await status(opts);
    assert.ok(s.items.find((i) => i.name === `file skills/${SKILL}/SKILL.md`)?.ok, 'status tracks the managed skill file');
    await uninstall(opts);
    assert.ok(!(await exists(file)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
