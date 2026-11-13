// T13 re-critique item 9: on a 375px phone the Usage filter bar and the "data as of" line took about 235px before any
// content. The three filters now fold into a native <details> whose summary says the current choice ("30 days · All
// projects · All runtimes"); closed on a phone, open (summary hidden) from 35rem up. No framework, no new dependency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const media = (matches) => () => ({ matches, addEventListener() {} });

async function boot(wide) {
  const env = makeEnv({ '/api/overview': { available: false, totals: {}, daily: [], models: [], runtimes: [] }, '/api/costs': { enabled: false },
    '/api/projects': { projects: [] }, '/api/sessions': { available: false, sessions: [], projects: [] } });
  env.location.hash = '#/usage';
  await runPortal(env, { DOMParser: class {}, queueMicrotask, matchMedia: media(wide) });
  await tick();
  return env;
}

test('the filters fold under a summary that names the current choice', async () => {
  const html = await read('index.html');
  assert.match(html, /<details id="filters-fold" class="filters-fold">\s*<summary id="filters-summary"><\/summary>\s*<div class="filters-fields">[\s\S]*id="days"[\s\S]*id="project"[\s\S]*id="runtime"[\s\S]*<\/div>\s*<\/details>/);
  const env = await boot(false);
  const $ = (id) => env.document.getElementById(id);
  assert.equal($('filters-summary').textContent, '30 days · All projects · All runtimes');
  assert.equal($('filters-fold').open, false, 'closed on a phone');
  $('project').value = 'alpha';
  $('runtime').value = 'codex';
  for (const fn of $('project').listeners.change) fn({ target: $('project') });
  await tick();
  assert.equal($('filters-summary').textContent, '30 days · alpha · Codex');
});

test('open on wider screens, where the summary is hidden', async () => {
  const env = await boot(true);
  assert.equal(env.document.getElementById('filters-fold').open, true);
  const css = (await read('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\n\.filters-fold > summary \{[^}]*display: none/);
  const phone = /@media \(max-width: 560px\) \{([\s\S]*?)\n\}/.exec(css)[1];
  assert.match(phone, /\.filters-fold > summary \{[^}]*display: list-item/);
});
