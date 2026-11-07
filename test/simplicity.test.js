// Simplicity ratchet (ADR 0004): files listed in test/simplicity-baseline.json may not get worse and must record any
// improvement; every other authored file must stay within the limits and open with a header comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, authoredFiles, measure, overLimits, readmeLines } from '../scripts/dev/simplicity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(path.join(root, 'test', 'simplicity-baseline.json'), 'utf8'));
const HINT = 'run `node scripts/dev/simplicity.mjs --write` after an improvement, never to accept a regression';

test('no authored file is worse than its baseline, and new files meet every limit', () => {
  const problems = [];
  for (const rel of authoredFiles(root)) {
    const over = overLimits(measure(root, rel));
    const base = baseline.files[rel] ?? {};
    for (const [key, value] of Object.entries(over)) {
      if (key === 'noHeader' ? !base.noHeader : value > (base[key] ?? 0)) problems.push(`${rel}: ${key} ${value} (baseline ${base[key] ?? 'none'})`);
    }
  }
  assert.deepEqual(problems, [], `limits ${JSON.stringify(LIMITS)}`);
});

test('the baseline is tight: improvements and deleted files are recorded', () => {
  const stale = [];
  const files = new Set(authoredFiles(root));
  for (const [rel, base] of Object.entries(baseline.files)) {
    if (!files.has(rel)) {
      stale.push(`${rel}: no longer exists`);
      continue;
    }
    const over = overLimits(measure(root, rel));
    for (const [key, value] of Object.entries(base)) if ((over[key] ?? 0) < value) stale.push(`${rel}: ${key} improved to ${over[key] ?? 'within limit'}`);
  }
  assert.deepEqual(stale, [], HINT);
});

test('README.md does not grow (target 200 lines)', () => {
  assert.ok(readmeLines(root) <= Math.max(LIMITS.readme, baseline.readme), `README.md has ${readmeLines(root)} lines`);
});
