// Critique P2 (T11 d): one tab vocabulary. Tabs (underlined, aria-current="page") are views of one page kept in the URL;
// a segmented control is a filter of the same list and looks the same whether its items are links or buttons. A segmented
// control never wraps one segment onto a row of its own: it scrolls sideways, like the tabs on a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';

const css = (await readFile(path.join(STATIC, 'style.css'), 'utf8') + await readFile(path.join(STATIC, 'style-pages.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].split(',').map((s) => s.trim()), body: m[2] }));
const together = (...sels) => blocks.find((b) => sels.every((s) => b.sel.includes(s)));
const design = await readFile(path.join(STATIC, '..', '..', '..', '..', 'docs', 'DESIGN.md'), 'utf8');

test('DESIGN.md states when to use tabs and when a segmented control', () => {
  assert.match(design, /Tabs are views of one page, kept in the URL/);
  assert.match(design, /segmented control is a filter of the same list/);
});

test('a segmented control scrolls sideways instead of wrapping one segment alone', () => {
  const seg = blocks.filter((b) => b.sel.includes('.segmented')).map((b) => b.body).join(' ');
  assert.match(seg, /flex-wrap:\s*nowrap/);
  assert.match(seg, /overflow-x:\s*auto/);
  assert.match(seg, /max-inline-size:\s*100%/);
});

test('link and button segments share one look in every state', () => {
  assert.ok(together('.segmented button', '.segmented a'), 'base');
  assert.match(together('.segmented button', '.segmented a').body, /white-space:\s*nowrap/);
  assert.match(together('.segmented button', '.segmented a').body, /min-block-size/);
  assert.ok(together('.segmented button:hover:not(:disabled)', '.segmented a:hover'), 'hover');
  assert.ok(together('.segmented button:active:not(:disabled)', '.segmented a:active'), 'active');
});

// Re-critique T13 item 8: the Catalog's kind filter had 11 segments (1512px) in a 719px column at 1024px, six behind a thin
// scrollbar. A filter with more segments than one row holds wraps inside its group (segmented-wrap) with one gap size, so
// every kind is reachable without sideways scrolling; the choice stays in ?kind=.
test('a long segmented filter wraps inside its group, with one gap size, and DESIGN.md names the exception', async () => {
  const wrap = together('.segmented.segmented-wrap');
  assert.ok(wrap, '.segmented.segmented-wrap rule');
  assert.match(wrap.body, /flex-wrap:\s*wrap/);
  assert.match(wrap.body, /overflow-x:\s*visible/);
  assert.match(wrap.body, /gap:\s*var\(--s1\)/);
  assert.match(design, /segmented-wrap/);
  const wiki = await readFile(path.join(STATIC, 'page-wiki.js'), 'utf8');
  assert.match(wiki, /class: "segmented segmented-wrap", "aria-label": t\("catalog\.kinds"\)/);
});
