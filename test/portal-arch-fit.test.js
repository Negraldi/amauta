// Critique P3 (T11 j), re-critique T13 item 3: fitting a 1962px diagram into a 703px column drew its 13px labels at about
// 4.6px. The diagram now opens at its natural size inside the labelled, focusable sideways scroller; "Fit to width" is the
// optional overview (a pressed-state toggle whose label never changes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const read = (f) => readFile(path.join(STATIC, f), 'utf8');

test('natural size by default, fit to width on demand, same scroll region', async () => {
  const env = makeEnv({ '/api/harness': { installed: true, version: '1', hooks: [], mcp_servers: [] }, '/api/harness/components': { total: 0, groups: [] },
    '/api/archify': { installed: true, available: false, fallback: 'flowchart LR\n  n0["A"]' }, '/api/skills': { groups: [] } });
  env.location.hash = '#/harness';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const details = tree(env.document.getElementById('view')).find((e) => e.tagName === 'details');
  const region = tree(details).find((e) => e.getAttribute('role') === 'region');
  assert.equal(region.getAttribute('data-size'), 'full');
  assert.equal(region.getAttribute('tabindex'), '0');
  const size = tree(details).find((e) => e.tagName === 'button' && e.textContent === 'Fit to width');
  assert.ok(size, 'a size toggle');
  assert.equal(size.getAttribute('aria-pressed'), 'false');
  size.click();
  assert.equal(size.getAttribute('aria-pressed'), 'true');
  assert.equal(size.textContent, 'Fit to width'); // the pressed state, not the label, says it is on
  assert.equal(region.getAttribute('data-size'), 'fit');
  size.click();
  assert.equal(region.getAttribute('data-size'), 'full');
  assert.ok(region.getAttribute('aria-label'));
});

test('the CSS draws the fitted diagram at the column width and the full one at its natural width', async () => {
  const css = (await read('style-pages.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.arch-scroll\[data-size="fit"\] \.diagram svg \{[^}]*width: 100%/);
  assert.match(css, /\.arch-scroll \.diagram svg \{[^}]*width: var\(--natural-width/);
  assert.match(await read('app.js'), /setProperty\("--natural-width"/);
});
