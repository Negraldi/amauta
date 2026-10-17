import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const helper = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'tmp.js')).href;

test('temp dirs made through the helper are removed when the test process exits', () => {
  const script = `import { tempDir } from ${JSON.stringify(helper)};
const d = await tempDir('amauta-tmpcheck-');
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync(d + '/nested'); writeFileSync(d + '/nested/f.txt', 'x');
console.log(d);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const dir = r.stdout.trim();
  assert.ok(dir.includes('amauta-tmpcheck-'), dir);
  assert.equal(existsSync(dir), false, `${dir} was left behind`);
});

test('the sync variant is removed at exit too', () => {
  const script = `import { tempDirSync } from ${JSON.stringify(helper)};
console.log(tempDirSync('amauta-tmpcheck-sync-'));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const dir = r.stdout.trim();
  assert.ok(dir.includes('amauta-tmpcheck-sync-'), dir);
  assert.equal(existsSync(dir), false, `${dir} was left behind`);
});
