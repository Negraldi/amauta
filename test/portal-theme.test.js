import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const ctx = {};
vm.runInNewContext(await read('theme.js'), ctx);
const T = ctx.AmautaTheme;
const css = await read('style.css');
const design = await readFile(path.join(STATIC, '..', '..', '..', '..', 'docs', 'DESIGN.md'), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// ---- token list and base themes stay in step with DESIGN.md and style.css ------------------------------------------
test('the token list is exactly the DESIGN.md color table, in order', () => {
  const names = [...design.matchAll(/^\| `--([a-z-]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(plain(T.TOKENS), names);
  assert.equal(names.length, 14);
});

test('the built-in base themes equal the stylesheet values', () => {
  const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(oklch\([^)]+\))/g)].map((m) => [m[1], m[2]]));
  const light = tokens(css.match(/:root \{([\s\S]*?)\n\}/)[1]);
  const dark = tokens(css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1]);
  for (const t of T.TOKENS) {
    assert.equal(T.BASES.light[t], light[t], `light ${t}`);
    assert.equal(T.BASES.dark[t], dark[t], `dark ${t}`);
  }
});

// ---- values --------------------------------------------------------------------------------------------------------
test('only oklch(L C H) within range and #rrggbb are valid values, normalized to lower case', () => {
  for (const ok of ['oklch(0.5 0.1 200)', 'oklch(1 0 0)', 'oklch(0 0 360)', 'oklch(.5 .1 .5)', '#abcdef', '#ABCDEF', 'oklch(0.5   0.1  200)']) assert.ok(T.isValidValue(ok), ok);
  for (const bad of ['red', '#fff', '#abcdeg', '#abcdef00', 'oklch(1 0)', 'oklch(1.1 0 0)', 'oklch(0.5 0.6 0)', 'oklch(0.5 0.1 361)', 'oklch(-1 0 0)', 'oklch(50% 0.1 200)',
    'oklch(0.5 0.1 200 / 0.5)', 'rgb(1,2,3)', 'url(http://x)', 'var(--ink)', 'oklch(0.5 0.1 200); color: red', '', ' ', 5, null, undefined, 'oklch(0.5 0.1 1e2)']) assert.ok(!T.isValidValue(bad), String(bad));
  assert.equal(T.normalizeValue('#ABCDEF'), '#abcdef');
  assert.equal(T.normalizeValue('OKLCH(0.5   0.1  200)'), 'oklch(0.5 0.1 200)');
  assert.equal(T.normalizeValue('nope'), null);
});

// ---- OKLCH -> sRGB and WCAG contrast -------------------------------------------------------------------------------
test('colors convert to hex and to relative luminance', () => {
  assert.equal(T.toHex('oklch(1 0 0)'), '#ffffff');
  assert.equal(T.toHex('oklch(0 0 0)'), '#000000');
  assert.equal(T.toHex('oklch(0.5 0 0)'), '#636363');
  assert.equal(T.toHex('#ABCDEF'), '#abcdef');
  assert.equal(T.toHex('bogus'), null);
  near(T.luminance('#ffffff'), 1, 1e-6);
  near(T.luminance('#000000'), 0, 1e-6);
  near(T.luminance('#808080'), 0.2159, 0.001);
  near(T.luminance('oklch(0.5 0 0)'), 0.125, 0.002);
  // a strongly chromatic color outside sRGB is clipped, never NaN
  assert.ok(Number.isFinite(T.luminance('oklch(0.7 0.4 150)')));
});

test('contrast ratios match the WCAG definition', () => {
  near(T.contrast('#000000', '#ffffff'), 21, 0.001);
  near(T.contrast('#ffffff', '#000000'), 21, 0.001);
  near(T.contrast('#777777', '#ffffff'), 4.48, 0.01);
  assert.ok(T.contrast('#767676', '#ffffff') >= 4.5);
  near(T.contrast('oklch(1 0 0)', 'oklch(0 0 0)'), 21, 0.05);
  near(T.contrast('#123456', '#123456'), 1, 1e-9);
  assert.equal(T.contrast('bogus', '#ffffff'), null);
});

test('the shipped light and dark themes pass the contrast check they are held to', () => {
  for (const base of ['light', 'dark']) assert.deepEqual(plain(T.contrastWarnings(base, {})), [], base);
});

test('low-contrast text tokens produce one warning per failing pair, falling back to the base for the rest', () => {
  const w = T.contrastWarnings('light', { ink: '#bbbbbb' });
  assert.deepEqual(plain(w.map((x) => [x.fg, x.bg])), [['ink', 'bg'], ['ink', 'surface']]);
  assert.ok(w.every((x) => x.ratio < 4.5 && x.ratio > 1 && x.min === 4.5));
  const dark = T.contrastWarnings('dark', { 'ink-muted': 'oklch(0.3 0 0)', bg: '#000000' });
  assert.deepEqual(plain(dark.map((x) => [x.fg, x.bg])), [['ink-muted', 'bg'], ['ink-muted', 'surface']]);
  // the accent doubles as the focus ring, so it must stand out from the page by 3:1
  const ring = T.contrastWarnings('light', { accent: '#f0f0f0' });
  assert.deepEqual(plain(ring.map((x) => [x.fg, x.bg, x.min])), [['accent', 'bg', 3]]);
  // an invalid value is ignored here (the editor reports it separately), so it cannot raise a false warning
  assert.deepEqual(plain(T.contrastWarnings('light', { ink: 'nonsense' })), []);
});

// ---- theme validation (mirrors the server) ---------------------------------------------------------------------------
test('validateTheme mirrors the server schema and reports stable codes', () => {
  const ok = { name: 'Paper', base: 'light', tokens: { bg: 'oklch(0.98 0.01 90)', accent: '#0A6E78' } };
  assert.deepEqual(plain(T.validateTheme(ok)), { ok: true, theme: { name: 'Paper', base: 'light', tokens: { bg: 'oklch(0.98 0.01 90)', accent: '#0a6e78' } }, errors: [] });
  const codes = (o) => plain(T.validateTheme(o).errors.map((e) => e.code));
  assert.deepEqual(codes({ ...ok, extra: 1 }), ['theme.shape']);
  assert.deepEqual(codes([]), ['theme.shape']);
  assert.deepEqual(codes({ name: 'x', base: 'light' }), ['theme.shape']);
  assert.deepEqual(codes({ ...ok, name: '' }), ['theme.name']);
  assert.deepEqual(codes({ ...ok, name: 'x'.repeat(61) }), ['theme.name']);
  assert.deepEqual(codes({ ...ok, base: 'blue' }), ['theme.base']);
  assert.deepEqual(codes({ ...ok, tokens: { color: '#112233' } }), ['theme.token']);
  assert.deepEqual(codes({ ...ok, tokens: { bg: 'red', ink: '#112233' } }), ['theme.value']);
  assert.equal(T.validateTheme({ ...ok, tokens: { bg: 'red' } }).errors[0].token, 'bg');
  assert.equal(T.validateTheme({ ...ok, tokens: { bg: 'red' } }).ok, false);
});

test('slugify makes a server-valid slug', () => {
  const re = /^[a-z0-9][a-z0-9-]{0,39}$/;
  for (const [name, slug] of [['Paper Light', 'paper-light'], ['  Hello,   World!! ', 'hello-world'], ['Ünï Cödé', 'uni-code'], ['---', 'theme'], ['', 'theme'], ['x'.repeat(80), 'x'.repeat(40)], ['A_B', 'a-b']]) {
    assert.equal(T.slugify(name), slug, name);
    assert.match(T.slugify(name), re);
  }
});

// ---- applying a theme: CSSOM only ----------------------------------------------------------------------------------
function fakeRoot() {
  const attrs = {}, props = {}, log = [];
  return {
    attrs, props, log,
    setAttribute: (k, v) => { log.push(['attr', k]); attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
    style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } },
  };
}

test('System follows the OS: no data-theme and no inline tokens', () => {
  const root = fakeRoot();
  T.applyChoice(root, 'dark', []);
  T.applyChoice(root, 'system', []);
  assert.deepEqual(root.attrs, {});
  assert.deepEqual(root.props, {});
});

test('Light and Dark force the scheme and clear every custom token', () => {
  const root = fakeRoot();
  T.applyChoice(root, 'custom:paper', [{ slug: 'paper', name: 'Paper', base: 'light', tokens: { bg: '#ffffff' } }]);
  assert.deepEqual(root.props, { '--bg': '#ffffff' });
  T.applyChoice(root, 'dark', []);
  assert.deepEqual([root.attrs['data-theme'], root.props], ['dark', {}]);
  T.applyChoice(root, 'light', []);
  assert.deepEqual([root.attrs['data-theme'], root.props], ['light', {}]);
});

test('a custom theme sets its base scheme and only its own tokens, through CSSOM properties', () => {
  const root = fakeRoot();
  const themes = [{ slug: 'night', name: 'Night', base: 'dark', tokens: { bg: '#000000', accent: 'oklch(0.8 0.1 30)' } }];
  T.applyChoice(root, 'custom:night', themes);
  assert.equal(root.attrs['data-theme'], 'dark');
  assert.deepEqual(root.props, { '--bg': '#000000', '--accent': 'oklch(0.8 0.1 30)' });
  assert.ok(!('style' in root.attrs), 'never a style attribute');
  T.applyChoice(root, 'custom:night', [{ ...themes[0], tokens: { ink: '#ffffff' } }]);
  assert.deepEqual(root.props, { '--ink': '#ffffff' }, 'tokens of the previous theme are removed');
});

test('an unknown, invalid or errored custom theme is never applied', () => {
  for (const themes of [[], [{ slug: 'x', error: 'bad' }], [{ slug: 'x', name: 'X', base: 'dark', tokens: { bg: 'red' } }], [{ slug: 'x', name: 'X', base: 'dark', tokens: { color: '#112233' } }]]) {
    const root = fakeRoot();
    T.applyChoice(root, 'custom:x', themes);
    assert.deepEqual([root.attrs, root.props], [{}, {}], JSON.stringify(themes));
  }
});

test('previewTheme applies draft tokens live and skips the invalid ones', () => {
  const root = fakeRoot();
  T.previewTheme(root, 'dark', { bg: '#101010', ink: 'oops', accent: 'oklch(0.8 0.1 30)' });
  assert.equal(root.attrs['data-theme'], 'dark');
  assert.deepEqual(root.props, { '--bg': '#101010', '--accent': 'oklch(0.8 0.1 30)' });
});

// ---- the stored choice ---------------------------------------------------------------------------------------------
test('the viewer choice survives garbage and a storage that throws', () => {
  const store = (value) => ({ getItem: () => value });
  assert.equal(T.loadChoice(store('dark')), 'dark');
  assert.equal(T.loadChoice(store('custom:paper')), 'custom:paper');
  for (const bad of [null, '', 'blue', 'custom:', 'custom:../x', 'custom:A', 'DARK', 'custom:' + 'a'.repeat(41)]) assert.equal(T.loadChoice(store(bad)), 'system', String(bad));
  assert.equal(T.loadChoice({ getItem: () => { throw new Error('denied'); } }), 'system');
  assert.equal(T.loadChoice(undefined), 'system');
  const saved = {};
  assert.equal(T.saveChoice({ setItem: (k, v) => { saved[k] = v; } }, 'light'), true);
  assert.deepEqual(saved, { 'amauta-theme': 'light' });
  assert.equal(T.saveChoice({ setItem: () => { throw new Error('quota'); } }, 'light'), false);
  assert.equal(T.saveChoice(undefined, 'light'), false);
  assert.equal(T.saveChoice({ setItem: () => assert.fail('must not store garbage') }, 'javascript:1'), false);
});
