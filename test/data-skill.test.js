// The `data` skill (plan D9a, ADR 0007): one skill for analytical work on tabular data, with five references. It is a
// rewrite of the corporate data skills without their private machinery, and it routes real data through amauta's
// privacy tools instead of pasting rows into the conversation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest, readAssetText } from '../src/install/assets.js';

const REFS = ['analytical-review', 'transformation', 'enrichment', 'metrics-and-cohorts', 'provenance'];

test('the data skill is registered with a trigger description and links its five references', async () => {
  const m = await loadManifest();
  assert.ok(m.skills.includes('data'));
  const text = await readAssetText('skills/data/SKILL.md');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.match(fm[1], /^name: data$/m);
  assert.match(fm[1], /^description: "Trigger: [^"\n]+"$/m);
  assert.ok(text.length < 6000, `SKILL.md is ${text.length} chars`);
  for (const ref of REFS) {
    assert.match(text, new RegExp(`\\(references/${ref}\\.md\\)`), ref);
    const body = await readAssetText(`skills/data/references/${ref}.md`);
    assert.ok(body.length > 400 && body.length < 6000, `${ref}: ${body.length} chars`);
  }
});

test('it uses amauta privacy tools and keeps none of the corporate machinery or private content', async () => {
  const all = [await readAssetText('skills/data/SKILL.md'), ...(await Promise.all(REFS.map((r) => readAssetText(`skills/data/references/${r}.md`))))].join('\n');
  assert.match(all, /amauta privacy (scan|pseudonymize|redact)/);
  assert.match(all, /synthetic/i);
  assert.match(all, /never paste|do not paste|never copy raw rows/i);
  for (const banned of [/di-analyst/, /di_session/, /metagpt/i, /harness-gateway/, /gentle-ai/, /NOLOCK/]) assert.doesNotMatch(all, banned, String(banned));
});

test('pipeline recipes: database, workbook and mail steps as the project\'s own scripts, with no credential in them', async () => {
  const skill = await readAssetText('skills/data/SKILL.md');
  assert.match(skill, /\(references\/pipeline-recipes\.md\)/);
  const r = await readAssetText('skills/data/references/pipeline-recipes.md');
  assert.ok(r.length > 2000 && r.length < 12000, `${r.length} chars`);
  for (const needle of [/"retries"/, /"outputs"/, /AMAUTA_PIPELINE_TRIGGER/, /RefreshAll/, /CalculateUntilAsyncQueriesDone/, /ReplyAll/,
    /\bGO\b/, /amauta pipeline check/, /environment variable|config file/i]) assert.match(r, needle, String(needle));
  for (const banned of [/PWD=\w/, /password\s*=\s*["'][^"']+["']/i, /@[a-z]+\.(com|ec|pe)\b/i, /\\\\Users\\\\/]) assert.doesNotMatch(r, banned, String(banned));
});
