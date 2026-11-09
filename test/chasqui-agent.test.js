// The communicator agent `chasqui` (plan D10, ADR 0008): writes deliverables from approved results only, into the
// task's deliverables folder; never computes new numbers; asks for measures in a fixed format, at most three cycles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadManifest, readAssetText } from '../src/install/assets.js';
import { install } from '../src/install/installer.js';
import { tempDir } from './helpers/tmp.js';

test('chasqui is registered with its own model key and a bounded tool set', async () => {
  const m = await loadManifest();
  const entry = m.agents.find((a) => a.name === 'chasqui');
  assert.ok(entry, 'in the manifest');
  assert.equal(entry.modelKey, 'chasqui');
  const text = await readAssetText('core/agents/chasqui.md');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)[1];
  assert.match(fm, /^name: chasqui$/m);
  const tools = /^tools: (.*)$/m.exec(fm)[1].split(',').map((t) => t.trim());
  assert.ok(tools.includes('Write') && tools.includes('Read'));
  assert.ok(!tools.includes('Bash'), 'no shell: it cannot compute or run anything');
});

test('its contract: deliverables folder, approved numbers only, fixed measure requests, three cycles', async () => {
  const text = await readAssetText('core/agents/chasqui.md');
  assert.match(text, /odd\/deliverables\/<feature>\//);
  assert.match(text, /never compute|never calculate/i);
  assert.match(text, /MEASURE REQUESTS \(cycle <n> of 3\)/);
  assert.match(text, /presentation measure/i);
  assert.match(text, /untrusted/i);
  for (const skill of ['executive-editorial', 'institutional-presentation', 'powerbi-report', 'doc-formats']) assert.match(text, new RegExp(skill));
  assert.doesNotMatch(text, /receipt|gentle-ai/i);
});

test('install writes the agent with a model', async () => {
  const root = await tempDir('chasqui-');
  const opts = { claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state'), searchPath: '' };
  await install(opts);
  const text = await readFile(path.join(opts.claudeHome, 'agents', 'chasqui.md'), 'utf8');
  assert.match(text, /^model: sonnet$/m);
  assert.ok(!text.includes('{{'));
});
