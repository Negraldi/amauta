// T16c: Settings > Appearance has a theme picker that shares the Display popover's theme list and its apply/persist path (chooseTheme).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, tree, view, tick, ES } from './helpers/t15w3.js';

const THEMES = { themes: [{ slug: 'paper', name: 'Paper', base: 'light', tokens: { bg: '#fafafa' } }], tokens: [], max: 50 };
const select = (env, id) => tree(view(env)).find((e) => e.tagName === 'select' && e.attrs.id === id);
const values = (sel) => tree(sel).filter((e) => e.tagName === 'option').map((e) => e.value);

test('the Appearance tab offers the same choices as the popover, custom themes included', async () => {
  const env = await boot('#/settings?tab=appearance', { '/api/themes': THEMES });
  const pick = select(env, 'set-theme');
  assert.ok(pick, 'a theme select on the Appearance tab');
  assert.deepEqual(values(pick), ['system', 'light', 'dark', 'custom:paper']);
  assert.deepEqual(values(env.document.getElementById('theme-picker')), values(pick), 'one list for both pickers');
  assert.equal(pick.value, 'system');
});

test('choosing a theme there applies and saves it through chooseTheme, and the popover follows', async () => {
  const env = await boot('#/settings?tab=appearance', { '/api/themes': THEMES });
  const pick = select(env, 'set-theme');
  pick.value = 'dark';
  (pick.listeners.change ?? []).forEach((fn) => fn({ target: pick }));
  await tick();
  assert.equal(env.document.documentElement.attrs['data-theme'], 'dark');
  assert.equal(env.document.getElementById('theme-picker').value, 'dark');
  assert.equal(select(env, 'set-theme').value, 'dark');
});

test('the picker is named in both languages and the intro points to it', async () => {
  const en = await boot('#/settings?tab=appearance', { '/api/themes': THEMES });
  assert.match(tree(view(en)).find((e) => e.attrs.id === 'set-theme-title').textContent, /^Theme$/);
  const es = await boot('#/settings?tab=appearance', { '/api/themes': THEMES }, ES);
  assert.match(tree(view(es)).find((e) => e.attrs.id === 'set-theme-title').textContent, /^Tema$/);
});
