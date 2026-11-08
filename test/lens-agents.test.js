// The review lenses (plan D11, ADR 0008): taripaq (analytical) and haravec (communication) are read-only reviewers
// with their own model keys; they read the pack built by `amauta review pack` and end with a verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest, readAssetText } from '../src/install/assets.js';
import { DEFAULT_MODEL_ASSIGNMENTS } from '../src/install/templating.js';

for (const [name, kind] of [['taripaq', 'analytical'], ['haravec', 'communication']]) {
  test(`${name} is a read-only ${kind} lens that reads the review pack and ends with a verdict`, async () => {
    const entry = (await loadManifest()).agents.find((a) => a.name === name);
    assert.equal(entry?.modelKey, name);
    assert.ok(DEFAULT_MODEL_ASSIGNMENTS[name], 'a default model');
    const text = await readAssetText(`core/agents/${name}.md`);
    const tools = /^tools: (.*)$/m.exec(text)[1].split(',').map((t) => t.trim());
    assert.deepEqual(tools, ['Read', 'Glob', 'Grep'], 'read-only');
    assert.match(text, /amauta review pack/);
    assert.match(text, /VERDICT: (PASS|PASS \| FAIL)/);
    assert.match(text, /untrusted/i);
    assert.doesNotMatch(text, /receipt|gentle-ai/i);
  });
}

test('the lenses differ from the work they review by default: taripaq from the orchestrator, haravec from chasqui', () => {
  assert.notEqual(DEFAULT_MODEL_ASSIGNMENTS.haravec, DEFAULT_MODEL_ASSIGNMENTS.chasqui);
});

test('the orchestrator block runs the lenses in their case even with code review off, and names the pack', async () => {
  const text = await readAssetText('core/orchestrator.md');
  assert.match(text, /taripaq/);
  assert.match(text, /haravec/);
  assert.match(text, /chasqui/);
  assert.match(text, /amauta review pack/);
  assert.match(text, /even when (code )?review is off/i);
});
