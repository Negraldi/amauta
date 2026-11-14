// T15 W2 (M1, D5, C2, M2, M3): segmented controls wrap, wide tables give way before they scroll, targets are at least 24px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');

test('class 6 guard: every segmented control in the portal wraps its segments (no hidden sideways scroll)', async () => {
  const files = (await readdir(STATIC)).filter((f) => /^(page-.*|app|paging)\.js$/.test(f));
  let seen = 0;
  for (const f of files) {
    for (const m of (await read(f)).matchAll(/class: "(segmented[^"]*)"/g)) {
      seen += 1;
      assert.match(m[1], /\bsegmented-wrap\b/, `${f}: ${m[0]}`);
    }
  }
  assert.ok(seen >= 4, `found ${seen} segmented controls`);
});

const rule = (css, sel) => new RegExp(`(?:^|\\n)${sel.replace(/[.[\]()*+?^$|]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1];

test('C2: sortable headers wrap and narrow columns get tighter cells, so a table gives way before it scrolls', async () => {
  const css = (await read('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rule(css, 'th[data-key]') ?? '', /white-space:\s*nowrap/);
  assert.match(css, /@media \(width < 72rem\) \{[^@]*th, td \{[^}]*padding-inline: var\(--s2\)/);
});

test('M3: row buttons ("os", "re") are at least 24x24 and a checkbox with its label is one 24px target', async () => {
  const css = (await read('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const link = rule(css, '.row-link') ?? '';
  assert.match(link, /min-inline-size:\s*var\(--hit\)/);
  assert.match(link, /min-block-size:\s*var\(--hit\)/);
  assert.match(rule(css, 'label.check') ?? '', /min-height:\s*var\(--hit\)/);
  for (const f of ['page-harness.js', 'page-activity.js']) {
    assert.match(await read(f), /h\("label", \{ class: "check"/, `${f}: the checkbox sits in label.check`);
  }
});
