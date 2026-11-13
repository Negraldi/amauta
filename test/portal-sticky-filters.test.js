// Critique P3 (T11 k): the Activity filter bar stays under the top bar while the page scrolls, on wide screens only (on a
// 375px phone it is three rows tall and would cover the content, so it scrolls away there). It follows the top bar's
// real height, measured once per resize, never polled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';

const css = (await readFile(path.join(STATIC, 'style.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

test('the filter bar is sticky under the top bar from 52rem up, and only there', () => {
  const wide = /@media \(width >= 52rem\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(wide, 'a wide-screen block');
  assert.match(wide[1], /\.page-bar \{[^}]*position: sticky;[^}]*top: var\(--topbar-h, [\d.]+rem\);[^}]*z-index: var\(--z-sticky\)/);
  const base = /\n\.page-bar \{([^}]*)\}/.exec(css)[1];
  assert.doesNotMatch(base, /sticky/);
});

test('boot.js measures the top bar with a ResizeObserver, guarded', async () => {
  const js = await readFile(path.join(STATIC, 'boot.js'), 'utf8');
  assert.match(js, /new ResizeObserver\([\s\S]{0,200}--topbar-h/);
  assert.doesNotMatch(js, /setInterval\([^)]*topbar/);
});
