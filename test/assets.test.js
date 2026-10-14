import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadManifest, assetPath, readAssetText, listFiles } from '../src/install/assets.js';
import { parseOddSections, renderOrchestrator } from '../src/install/templating.js';

test('manifest records the upstream commit and every referenced asset exists', async () => {
  const m = await loadManifest();
  assert.equal(m.schema, 'gentle-lite.assets/v1');
  assert.match(m.upstream.commit, /^[0-9a-f]{40}$/);
  const refs = [
    ...m.claudeMd.map((s) => s.source).filter((s) => !s.startsWith('persona:')),
    ...Object.values(m.personas).flatMap((p) => [p.residual, p.outputStyle]),
    m.oddSections,
    m.settingsOverlay,
    ...m.agentFooters.map((f) => f.source),
    ...m.agents.map((a) => `${m.agentsDir}/${a.name}.md`),
    ...m.skills.map((s) => `${m.skillsDir}/${s}/SKILL.md`),
  ];
  for (const r of refs) assert.ok(existsSync(assetPath(r)), `missing asset ${r}`);
});

test('the orchestrator template renders with no unresolved placeholders', async () => {
  const m = await loadManifest();
  const sections = parseOddSections(await readAssetText(m.oddSections));
  const out = renderOrchestrator(await readAssetText('claude/orchestrator.md'), sections);
  assert.ok(!out.includes('{{'), 'unresolved placeholder in orchestrator');
  assert.match(out, /Organic Driven Development/);
});

test('listFiles walks a directory recursively with relative sorted paths', async () => {
  const files = await listFiles(assetPath('skills/judgment-day'));
  assert.ok(files.includes('SKILL.md'));
  assert.ok(files.includes(path.join('references', 'prompts-and-formats.md')));
  assert.deepEqual(files, [...files].sort());
});

test('codegraph-guidance refers to the upstream codegraph CLI, not gentle-ai', async () => {
  const text = await readFile(new URL('../assets/claude/codegraph-guidance.md', import.meta.url), 'utf8');
  assert.ok(!text.includes('gentle-ai'));
  assert.match(text, /`codegraph init`/);
});
