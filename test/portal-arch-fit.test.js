// Critique P3 (T11 j): the architecture diagram fits the column by default; a pressed-state button shows it at full size
// inside the same labelled, focusable scroll region.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const read = (f) => readFile(path.join(STATIC, f), 'utf8');

test('fit to width by default, full size on demand, same scroll region', async () => {
  const env = makeEnv({ '/api/harness': { installed: true, version: '1', hooks: [], mcp_servers: [] }, '/api/harness/components': { total: 0, groups: [] },
    '/api/archify': { installed: true, available: false, fallback: 'flowchart LR\n  n0["A"]' }, '/api/skills': { groups: [] } });
  env.location.hash = '#/harness';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const details = tree(env.document.getElementById('view')).find((e) => e.tagName === 'details');
  const region = tree(details).find((e) => e.getAttribute('role') === 'region');
  assert.equal(region.getAttribute('data-size'), 'fit');
  assert.equal(region.getAttribute('tabindex'), '0');
  const size = tree(details).find((e) => e.tagName === 'button' && e.textContent === 'Show at full size');
  assert.ok(size, 'a size toggle');
  assert.equal(size.getAttribute('aria-pressed'), 'false');
  size.click();
  assert.equal(size.getAttribute('aria-pressed'), 'true');
  assert.equal(region.getAttribute('data-size'), 'full');
  assert.ok(region.getAttribute('aria-label'));
});

test('the CSS draws the fitted diagram at the column width and the full one at its natural width', async () => {
  const css = (await read('style-pages.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.arch-scroll\[data-size="fit"\] \.diagram svg \{[^}]*width: 100%/);
  assert.match(css, /\.arch-scroll \.diagram svg \{[^}]*width: var\(--natural-width/);
  assert.match(await read('app.js'), /setProperty\("--natural-width"/);
});
