import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('vendored Source Serif 4 woff2 files match the manifest and NOTICE, with the OFL text shipped alongside', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'assets', 'manifest.json'), 'utf8'));
  const m = manifest.vendored['source-serif-4'];
  assert.equal(m.license, 'OFL-1.1');
  assert.equal(m.package, '@fontsource/source-serif-4');
  assert.equal(m.files.length, 3);
  const notice = await readFile(path.join(root, 'NOTICE'), 'utf8');
  assert.ok(notice.includes(`@fontsource/source-serif-4@${m.version}`));
  for (const f of m.files) {
    const bytes = await readFile(path.join(root, f.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256, f.path);
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${f.path} is not woff2`);
    assert.ok(notice.includes(f.sha256), `NOTICE lacks the sha256 of ${f.path}`);
  }
  const ofl = await readFile(path.join(root, m.licenseFile), 'utf8');
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
});
