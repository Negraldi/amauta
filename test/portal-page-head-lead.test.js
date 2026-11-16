// The lead of a page head sits on its own row under the title. `#view p` caps paragraphs at 72ch, and a capped flex
// basis no longer fills the row, so the lead must lift the cap and keep the measure with padding instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the page-head lead fills its row and keeps a 72ch measure', async () => {
  const css = await readFile(new URL('../python/amauta/portal/static/style.css', import.meta.url), 'utf8');
  const rule = /\.page-head > \.lead \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'rule present');
  assert.match(rule[1], /flex:\s*0 0 100%/);
  assert.match(rule[1], /max-width:\s*none/);
  assert.match(rule[1], /padding-right:\s*max\(0px, calc\(100% - 72ch\)\)/);
});
