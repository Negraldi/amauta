// Critique P3 (T11 g): a checkbox and its words are one 24px target (WCAG 2.2 2.5.8). The label wraps the box, is at least
// --hit tall and shows the pointer; the box itself is drawn larger than the 13px browser default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';

const css = (await readFile(path.join(STATIC, 'style.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(' ');

test('label.check is a 24px pointer target and the box is larger than the default', () => {
  assert.match(rule('label.check'), /min-(?:height|block-size):\s*var\(--hit\)/);
  assert.match(rule('label.check'), /cursor:\s*pointer/);
  const box = rule('input[type="checkbox"]');
  const size = /inline-size:\s*([\d.]+)rem/.exec(box);
  assert.ok(size && parseFloat(size[1]) * 16 >= 18, box);
  assert.match(box, /block-size:\s*[\d.]+rem/);
});

test('the Usage cache toggle sits inside its label', async () => {
  const js = await readFile(path.join(STATIC, 'page-activity.js'), 'utf8');
  assert.match(js, /h\("label", \{ class: "check" \}, toggle/);
});
