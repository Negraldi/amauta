import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const ctx = {};
vm.runInNewContext(await read('wikiroute.js'), ctx);
const R = ctx.AmautaRoute;
const css = await read('style.css');
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(' ');
};
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const cls = (e) => e.className || e.attrs.class || '';
const has = (e, name) => cls(e).split(/\s+/).includes(name);
const HOME = '/home/negraldi/amauta';
const PAGE = {
  kind: 'skill', id: 'x', title: 'x', body_md: null,
  meta: [{ label: 'Path', value: HOME }, { label: 'Skill file', value: `${HOME}/${'a'.repeat(40)}/SKILL.md` }, { label: 'First used', value: '2026-09-20T01:44:09.739Z' }, { label: 'Output tokens of the calling messages', value: '1766', fmt: 'number' }],
  links: [], backlinks: [], sections: [], missing: [], usage: { daily: [], days: 30 },
};
async function boot(hash, routes = {}, extra = {}) {
  process.env.TZ = 'UTC';
  const env = makeEnv({ '/api/wiki/recent': { items: [{ kind: 'memory', id: '7', title: 'm', ts: '2026-10-02T10:05:00.000Z', what: 'memory saved' }] }, '/api/sessions': { available: false }, '/api/themes': { themes: [], tokens: [], max: 50 }, '/api/wiki/page': PAGE, ...routes });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  return env;
}

// ---- 1. dates never break inside the token ----
test('CSS: a .date token never wraps', () => {
  assert.match(rule('.date'), /white-space:\s*nowrap/);
});

test('the sidebar, rail and table cells put every date and date-time in one nowrap .date span', async () => {
  const env = await boot('#/skill/x', {
    '/api/sessions': { available: true, projects: [], sessions: [{ session_id: 'abcdef123456', project: 'p', first_ts: '2026-10-01T00:00:00Z', last_ts: '2026-10-02T09:30:00.123Z', messages: 1, input: 1, output: 2, cache_read: 3, cache_write: 4, model: 'm' }] },
  });
  const dates = (id) => tree(env.document.getElementById(id)).filter((e) => has(e, 'date')).map((e) => e.textContent);
  assert.deepEqual(dates('recent'), ['2026-10-02 10:05']);
  assert.deepEqual(dates('view'), ['2026-09-20 01:44']);
  env.location.hash = '#/session';
  env.listeners.hashchange();
  await tick();
  assert.ok(dates('view').includes('2026-10-02 09:30'), dates('view').join('|'));
});

test('a date inside a sentence is wrapped too, and the sentence text is unchanged', async () => {
  const env = await boot('#/skill/x');
  const recent = env.document.getElementById('recent');
  assert.match(recent.textContent, /memory saved, 2026-10-02 10:05/);
  const spans = tree(recent).filter((e) => has(e, 'date'));
  assert.equal(spans.length, 1);
  assert.equal(spans[0].textContent, '2026-10-02 10:05', 'only the date itself is in the span');
});

// ---- 2. numbers are grouped in every locale ----
test('fmtNumber groups four-digit numbers in Spanish (Intl skips the separator by default)', () => {
  try {
    R.setLocale('es-ES');
    assert.equal(R.fmtNumber(1766), '1.766');
    assert.equal(R.fmtNumber(1234567), '1.234.567');
    assert.equal(R.fmtDecimal(1234.5, 1), '1.234,5');
    R.setLocale('es-MX');
    assert.equal(R.fmtNumber(1766), '1,766');
    R.setLocale('en-US');
    assert.equal(R.fmtNumber(1766), '1,766');
    assert.equal(R.fmtNumber(999), '999');
  } finally { R.setLocale('en-US'); }
});

// ---- 3. paths break only at slashes ----
test('isPathLike and pathSegments split a path after each slash', () => {
  assert.equal(R.isPathLike(HOME), true);
  assert.equal(R.isPathLike('~/.claude/skills/x/SKILL.md'), true);
  for (const no of ['', 'plain text', '/ spaces here', 'a-b', '2026-10-17', null, 42]) assert.equal(R.isPathLike(no), false, String(no));
  assert.deepEqual([...R.pathSegments('/home/negraldi/amauta')], ['/', 'home', '/', 'negraldi', '/', 'amauta']);
  assert.deepEqual([...R.pathSegments('a/b/')], ['a', '/', 'b', '/']);
});

test('a path in the rail is mono text with a wbr after every slash, built as DOM, and breaks nowhere else', async () => {
  const env = await boot('#/skill/x');
  const dds = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'dd');
  const dd = dds.find((d) => d.textContent.startsWith(HOME) && !/SKILL/.test(d.textContent));
  assert.ok(dd, 'path dd');
  const span = tree(dd).find((e) => has(e, 'path'));
  assert.ok(span, 'span.path');
  assert.ok(!has(dd, 'tok'));
  assert.equal(span.textContent, HOME);
  assert.equal(tree(span).filter((e) => e.tagName === 'wbr').length, 3);
  const kids = span.children.map((c) => (c.tagName === 'wbr' ? '|' : c.textContent));
  assert.equal(kids.join(''), '/|home/|negraldi/|amauta');
  const long = dds.find((d) => /SKILL\.md/.test(d.textContent));
  assert.ok(tree(long).some((e) => has(e, 'tok') && e.textContent === 'a'.repeat(40)), 'a very long single segment may break anywhere');
  assert.match(rule('.path'), /font-family:\s*var\(--mono\)/);
  assert.doesNotMatch(rule('.path'), /overflow-wrap:\s*anywhere/);
});

test('the rail number is grouped in the Spanish UI', async () => {
  const env = await boot('#/skill/x', {}, { navigator: { language: 'es-ES' } });
  assert.match(env.document.getElementById('view').textContent, /1\.766/);
});

// ---- 5. import theme: one button, hidden native input ----
test('theme import is one button that opens a visually hidden file input', async () => {
  const env = await boot('#/themes');
  const v = tree(env.document.getElementById('view'));
  const input = v.find((e) => e.attrs.id === 'theme-import');
  assert.equal(input.attrs.type, 'file');
  assert.equal(input.attrs.accept, '.json,application/json');
  assert.ok(has(input, 'visually-hidden'));
  assert.equal(input.attrs.style, undefined);
  assert.equal(input.attrs.tabindex, '-1', 'the button is the keyboard route');
  assert.ok(!v.some((e) => e.tagName === 'label' && e.attrs.for === 'theme-import'), 'no separate label next to the native input');
  const btn = v.find((e) => e.tagName === 'button' && e.textContent === 'Import theme file');
  assert.ok(btn);
  let opened = 0;
  input.click = () => { opened++; };
  btn.click();
  assert.equal(opened, 1);
  const rules = rule('.visually-hidden');
  assert.match(rules, /position:\s*absolute/);
  assert.match(rules, /clip/);
});

test('theme import strings exist in English and Spanish', async () => {
  const en = await boot('#/themes');
  assert.ok(tree(en.document.getElementById('view')).some((e) => e.tagName === 'button' && e.textContent === 'Import theme file'));
  const es = await boot('#/themes', {}, { navigator: { language: 'es-ES' } });
  assert.ok(tree(es.document.getElementById('view')).some((e) => e.tagName === 'button' && e.textContent === 'Importar archivo de tema'));
});
