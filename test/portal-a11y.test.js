import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const css = await read('style.css');
const html = await read('index.html');
const app = await read('app.js');
const design = await readFile(path.join(STATIC, '..', '..', '..', '..', 'docs', 'DESIGN.md'), 'utf8');

// ---- OKLCH -> sRGB -> WCAG contrast ------------------------------------------------------------------------
function oklchToRgb([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((v) => Math.min(1, Math.max(0, v))); // linear sRGB, clipped to gamut
}
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b; // linear components already
export const contrast = (fg, bg) => { const x = luminance(oklchToRgb(fg)), y = luminance(oklchToRgb(bg)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function tokensIn(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*oklch\(([^)]+)\)/g)) out[m[1]] = m[2].trim().split(/\s+/).map(Number);
  return out;
}
const lightBlock = css.match(/:root \{([\s\S]*?)\n\}/)[1];
const mediaDark = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/)[1];
const forcedDark = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1];
const SCHEMES = { light: tokensIn(lightBlock), dark: tokensIn(forcedDark) };

test('the two dark declarations (OS preference and forced) carry identical tokens', () => {
  assert.deepEqual(tokensIn(mediaDark), SCHEMES.dark);
});

test('DESIGN.md token table matches the stylesheet in both schemes', () => {
  for (const m of design.matchAll(/^\| `--([a-z-]+)` \| ([0-9. ]+) \| ([0-9. ]+) \|/gm)) {
    const [name, light, dark] = [m[1], m[2].trim().split(/\s+/).map(Number), m[3].trim().split(/\s+/).map(Number)];
    assert.deepEqual(SCHEMES.light[name], light, `light --${name}`);
    assert.deepEqual(SCHEMES.dark[name], dark, `dark --${name}`);
  }
});

const TEXT = ['ink', 'ink-muted', 'accent', 'warn', 'ok'];
const SURFACES = ['bg', 'surface', 'sidebar', 'accent-soft'];
for (const scheme of ['light', 'dark']) {
  test(`text colors reach 4.5:1 on every surface in the ${scheme} scheme`, () => {
    const t = SCHEMES[scheme];
    for (const fg of TEXT) for (const bg of SURFACES) {
      const r = contrast(t[fg], t[bg]);
      assert.ok(r >= 4.5, `${scheme}: --${fg} on --${bg} is ${r.toFixed(2)}:1`);
    }
  });
}

test('the primary button text (surface on accent) is readable in both schemes', () => {
  for (const scheme of ['light', 'dark']) assert.ok(contrast(SCHEMES[scheme].surface, SCHEMES[scheme].accent) >= 4.5, scheme);
});

// ---- responsive logic --------------------------------------------------------------------------------------
test('the right rail shows from 72rem up and collapses below it; the sidebar collapses below 52rem', () => {
  assert.match(css, /\.page \{ display: grid; grid-template-columns: minmax\(0, var\(--measure\)\) var\(--rail-w\);/);
  const rail = css.match(/@media \(width < 72rem\) \{([\s\S]*?)\n\}/);
  assert.ok(rail, 'collapse below 72rem uses an exclusive range so exactly 72rem keeps the rail');
  assert.match(rail[1], /\.page \{ grid-template-columns: minmax\(0, var\(--measure\)\)/);
  const side = css.match(/@media \(width < 52rem\) \{([\s\S]*?)\n\}/);
  assert.ok(side, 'sidebar collapse below 52rem');
  assert.match(side[1], /\.shell \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(side[1], /\.nav-toggle \{ display: inline-block/);
  assert.doesNotMatch(css, /@media \(max-width: (72|52)rem\)/);
});

// ---- keyboard ---------------------------------------------------------------------------------------------
test('a skip link is the first focusable element and targets the focusable main region', () => {
  const body = html.slice(html.indexOf('<body>'));
  assert.match(body, /^<body>\s*<a class="skip"[^>]*href="#view">/);
  assert.match(html, /<main id="view" tabindex="-1">/);
  assert.match(css, /\.skip:focus \{ top: /);
});

test('focus is always visible: a ring for :focus-visible and no outline removed without a reason', () => {
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px; \}/);
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*outline:\s*(none|0)\b/g)) assert.equal(m[1].trim(), '#view', `outline removed on ${m[1].trim()}`);
});

test('every clickable element built in app.js is a button, link, sortable header with keys, or a listbox option', () => {
  const calls = [];
  for (const m of app.matchAll(/\bonclick:/g)) {
    const before = app.slice(0, m.index);
    const open = before.lastIndexOf('h("');
    calls.push([before.slice(open + 3, before.indexOf('"', open + 3)), app.slice(open, m.index + 60)]);
  }
  assert.ok(calls.length > 5);
  for (const [tag, attrs] of calls) {
    if (tag === 'button' || tag === 'a') continue;
    if (tag === 'th') { assert.match(attrs, /tabindex: 0/); assert.match(app, /onkeydown: \(e\) => \{ if \(e\.key === "Enter" \|\| e\.key === " "\)/, 'sortable headers react to Enter and Space'); continue; }
    if (tag === 'div' && /role: "option"/.test(attrs)) continue; // driven by arrow keys and aria-activedescendant on the search input
    assert.fail(`<${tag}> has a click handler but no keyboard route: ${attrs.slice(0, 80)}`);
  }
});

test('scrollable regions can be reached with the keyboard', () => {
  assert.match(app, /h\("div", \{ class: "scroll", tabindex: 0, role: "region", "aria-label": [^}]+\}, h\("table"/);
});

// ---- filters ----------------------------------------------------------------------------------------------
const rctx = {};
vm.runInNewContext(await read('wikiroute.js'), rctx);
const R = rctx.AmautaRoute;

test('Range and Project filters show on Usage and on list views that read them, never on a page (id) or other routes', () => {
  assert.equal(R.showsFilters({ kind: 'usage', id: '' }), true);
  for (const kind of ['session', 'tool', 'mcp']) {
    assert.equal(R.showsFilters({ kind, id: '' }), true, `${kind} list`);
    assert.equal(R.showsFilters({ kind, id: 'x' }), false, `${kind} page`);
  }
  for (const kind of ['home', 'memory', 'feature', 'node', 'harness', 'settings', 'lint', 'skill', 'unknown']) assert.equal(R.showsFilters({ kind, id: '' }), false, kind); // the skill catalog has its own filter
});

test('the shell hides the filter bar through showsFilters, not a hard-coded list', () => {
  assert.match(app, /\$\("filters"\)\.hidden = !R\.showsFilters\(route\);/);
  assert.doesNotMatch(app, /FILTERED/);
});

// ---- themes: whatever tokens a theme sets, diagrams stay light and focus stays visible ---------------------------------
test('diagram cards pin their own light tokens, so a dark or custom theme cannot make Mermaid text unreadable', () => {
  const rule = css.match(/\n\.diagram \{([^}]*)\}/)[1];
  const pinned = tokensIn(rule);
  for (const name of ['bg', 'surface', 'ink', 'ink-muted', 'line']) assert.deepEqual(pinned[name], SCHEMES.light[name], `--${name} is pinned to the light value`);
  assert.match(css, /\.archify-frame \{[^}]*background: oklch\(1 0 0\)/);
  assert.ok(contrast(pinned.ink, pinned.bg) >= 4.5 && contrast(pinned['ink-muted'], pinned.surface) >= 4.5);
});

test('forced schemes also set color-scheme so native controls follow the portal theme', () => {
  assert.match(css, /:root\[data-theme="dark"\] \{ color-scheme: dark; \}/);
  assert.match(css, /:root\[data-theme="light"\] \{ color-scheme: light; \}/);
});

test('the focus ring is a 2px accent outline on every element, and the theme editor controls inherit it', () => {
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--accent\); outline-offset: 2px; \}/);
  assert.doesNotMatch(css.replace(/#view \{[^}]*\}/, ''), /outline:\s*(none|0)\b/, 'only the programmatically focused <main> hides its outline');
});
