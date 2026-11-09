// Editorial skills (plan D9c): executive-editorial and institutional-presentation, rewritten from v19. Branding comes
// from the selected profile (ADR 0007), never from an organization's assets copied into the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest, readAssetText } from '../src/install/assets.js';

for (const name of ['executive-editorial', 'institutional-presentation']) {
  test(`${name} is registered, trigger-first, concise and neutral`, async () => {
    assert.ok((await loadManifest()).skills.includes(name));
    const text = await readAssetText(`skills/${name}/SKILL.md`);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)[1];
    assert.match(fm, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(fm, /^description: "Trigger: [^"\n]+"$/m);
    assert.ok(text.length < 6000);
    assert.match(text, /profile/i, 'brand from the selected profile');
    assert.match(text, /source,\s+period,\s+population\s+and\s+denominator/);
    for (const banned of [/assets\/brand/, /Example Organization/, /harness/i, /receipt/i, /gentle-ai/]) assert.doesNotMatch(text, banned, String(banned));
  });
}
