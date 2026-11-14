// T15 W2 (C1, M5, E1, D9, E8, C2): diagram text never under 11px (a scale floor), boxes that overflow say so and are Tab stops only then.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEnv, Element } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

async function ctx() {
  const env = makeEnv({});
  const c = await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await new Promise((r) => setTimeout(r, 40)); // the dictionaries load
  return c;
}
const run = (c, code) => vm.runInContext(code, c);

test('class 5 guard: the scale floor keeps the 13px diagram text at 11px or more', async () => {
  const c = await ctx();
  assert.ok(run(c, 'MIN_DIAGRAM_SCALE * DIAGRAM_TEXT_PX') >= 11 - 1e-9);
  // fit when it stays readable, else the floor, never larger than natural
  assert.equal(run(c, 'diagramScale(1000, 500, false)'), run(c, 'MIN_DIAGRAM_SCALE'));
  assert.equal(run(c, 'diagramScale(1963, 977, false) * DIAGRAM_TEXT_PX') >= 11, true);
  assert.equal(run(c, 'diagramScale(1000, 900, false)'), 0.9);
  assert.equal(run(c, 'diagramScale(500, 900, false)'), 1);
  assert.equal(run(c, 'diagramScale(1963, 977, true)'), 1);
  assert.equal(run(c, 'diagramScale(0, 900, false)'), 1);
});

const svgBox = (viewW, clientWidth, size) => {
  const svg = { style: {}, viewBox: { baseVal: { width: viewW } } };
  return { svg, box: { clientWidth, querySelector: () => svg, getAttribute: () => size } };
};

test('fitDiagram sizes the svg at the floored scale, and at natural size in full mode', async () => {
  const c = await ctx();
  const a = svgBox(1963, 977 + 16);
  const fit = run(c, 'fitDiagram');
  fit(a.box);
  assert.equal(a.svg.style.maxWidth, 'none');
  assert.equal(parseInt(a.svg.style.width, 10), Math.ceil(1963 * (11 / 13)));
  const full = svgBox(1963, 977, 'full');
  fit(full.box);
  assert.equal(full.svg.style.width, '1963px');
  const small = svgBox(600, 977);
  fit(small.box);
  assert.equal(small.svg.style.width, '600px');
  const unseen = svgBox(600, 0);
  fit(unseen.box);
  assert.equal(unseen.svg.style.width, undefined, 'a box not on the page is left for the next sync');
});

test('E8: a scroll box is a Tab stop only while it overflows, and then says more is there', async () => {
  const c = await ctx();
  const sync = run(c, 'syncScroller');
  const make = (scrollWidth, clientWidth, cls = 'scroll') => {
    const el = new Element('div');
    el.className = cls; el.scrollWidth = scrollWidth; el.clientWidth = clientWidth;
    el.setAttribute('tabindex', '0');
    el.parent = [];
    el.nextElementSibling = null;
    el.after = (n) => { el.nextElementSibling = n; };
    return el;
  };
  const fits = make(300, 300);
  sync(fits);
  assert.equal(fits.getAttribute('tabindex'), undefined);
  assert.equal(fits.nextElementSibling, null);
  const wide = make(900, 300);
  sync(wide);
  assert.equal(wide.getAttribute('tabindex'), '0');
  assert.match(wide.nextElementSibling.textContent, /Scroll sideways for more columns/);
  wide.nextElementSibling.className = 'muted scroll-hint';
  sync(wide);
  assert.ok(wide.nextElementSibling, 'the hint is not added twice');
  const diagram = make(900, 300, 'diagram scroll');
  sync(diagram);
  assert.match(diagram.nextElementSibling.textContent, /whole diagram/);
  const unmeasured = new Element('div');
  unmeasured.setAttribute('tabindex', '0');
  sync(unmeasured);
  assert.equal(unmeasured.getAttribute('tabindex'), '0', 'without layout the box stays as built');
});

test('the scripts and CSS are wired: fit.js is served, listed in index.html and the diagram sizes come from JS', async () => {
  const read = (f) => readFile(path.join(STATIC, f), 'utf8');
  assert.match(await read('index.html'), /<script src="\/static\/fit\.js"><\/script>/);
  assert.match(await read('boot.js'), /watchOverflow\(\$\("view"\)\)/);
  assert.match(await read('app.js'), /fitDiagram\(into\)/);
  const css = (await read('style.css')) + (await read('style-pages.css'));
  assert.doesNotMatch(css, /min-width: 40rem/, 'the phone rule that forced a width is replaced by the floor');
});
