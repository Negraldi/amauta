import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'gentle-lite.js');
const run = (args, input = '{}') => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', input });

for (const name of ['skill-registry', 'review-stop']) {
  test(`placeholder hook ${name} exits 0 with empty stdout`, () => {
    const r = run(['hook', name]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
}

test('an unknown hook name exits 1 with a message', () => {
  const r = run(['hook', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown hook: nope/);
});
