// T15 W3b group D (chrome): the Display button reports its state, copy names buttons by their labels, the catalog filter announces and counts,
// small link targets reach 24 px, the phone search button is an icon with a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIC, readDicts } from './helpers/portalboot.js';
import { boot, tree, view, text, ES } from './helpers/t15w3.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');

test('D18: the Display button says whether its popover is open', async () => {
  const env = await boot('#/', { '/api/wiki/home': { activity: [], spending: { available: false }, health: { installed: false }, impact: null }, '/api/pipelines': { projects: [] } });
  const button = env.document.getElementById('display-open'), prefs = env.document.getElementById('prefs');
  assert.equal(button.attrs['aria-expanded'], 'false');
  for (const fn of prefs.listeners.toggle ?? []) fn({ newState: 'open' });
  assert.equal(button.attrs['aria-expanded'], 'true');
  for (const fn of prefs.listeners.toggle ?? []) fn({ newState: 'closed' });
  assert.equal(button.attrs['aria-expanded'], 'false');
});

test('D18: no sentence names a button that is not there ("Refresh usage" is the button "Refresh")', async () => {
  const d = await readDicts();
  for (const [lang, dict] of Object.entries(d)) {
    const bad = Object.entries(dict).filter(([, v]) => /Refresh usage|Actualizar uso/.test(v));
    assert.deepEqual(bad, [], lang);
  }
});

const COMPS = { total: 3, pending: 0, groups: [
  { kind: 'hook', label: 'Hooks', items: [{ kind: 'hook', id: 'Stop:a', title: 'Stop · alpha', description: null, source: 'x', uses: 0 }] },
  { kind: 'mcp', label: 'MCP servers', items: [{ kind: 'mcp', id: 'engram', title: 'engram', description: null, source: 'x', uses: 0 }, { kind: 'mcp', id: 'alp', title: 'alp', description: null, source: 'x', uses: 0 }] }] };
test('E10: the component filter announces its result and the kind counts follow it', async () => {
  const env = await boot('#/component', { '/api/harness/components': COMPS });
  const box = tree(view(env)).find((e) => e.tagName === 'input' && e.attrs.type === 'search');
  const kinds = () => tree(view(env)).find((e) => e.tagName === 'nav' && e.className.includes('segmented')).children.map((a) => a.textContent);
  assert.deepEqual(kinds(), ['All (3)', 'Hooks (1)', 'MCP servers (2)']);
  box.value = 'alp';
  for (const fn of box.listeners.input ?? []) fn({ target: box });
  assert.deepEqual(kinds(), ['All (2)', 'Hooks (1)', 'MCP servers (1)']);
  box.value = 'zzz';
  for (const fn of box.listeners.input ?? []) fn({ target: box });
  assert.deepEqual(kinds(), ['All (0)', 'Hooks (0)', 'MCP servers (0)']);
  const live = tree(view(env)).find((e) => e.attrs['aria-live'] === 'polite' && /No component matches|matches/i.test(e.textContent));
  assert.ok(live, 'the empty result sits in a live region');
});

test('E10: links in lists and tables are at least 24 px wide', async () => {
  const css = (await read('style.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /(?:^|\})\s*([^{}]*\.items a[^{}]*)\{([^{}]*)\}/.exec(css.replace(/\n/g, ' '));
  assert.ok(m, 'a rule for .items a');
  assert.match(css, /td a, \.refs a, \.items a \{[^}]*min-inline-size:\s*1\.5rem/);
  assert.match(css, /td a, \.refs a, \.items a \{[^}]*display:\s*inline-block/);
});

test('E11/M4: on a phone the search button is an icon with a name, never clipped text', async () => {
  const html = await read('index.html'), css = await read('style.css');
  assert.match(html, /<button id="search-open"[^>]*>[^]*<svg class="search-icon"[^>]*aria-hidden="true"/);
  const narrow = css.slice(css.indexOf('@media (width < 52rem)')); // the collapse rules for a phone
  assert.match(narrow, /\.search-trigger #search-text\s*\{[^}]*clip-path/);
  assert.match(narrow, /\.search-trigger \.search-icon\s*\{[^}]*display:\s*(?:block|inline-block)/);
  const env = await boot('#/', { '/api/wiki/home': { activity: [], spending: { available: false }, health: { installed: false }, impact: null }, '/api/pipelines': { projects: [] } }, ES);
  assert.equal(env.document.getElementById('search-open').attrs['aria-label'], 'Buscar en la wiki');
});
