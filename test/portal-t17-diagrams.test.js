// T17b: a diagram picks the layout that fits the width it gets (direction, wrapped labels, spacing); a sequence that cannot fit
// even at the text floor is shown as ordered steps. The pure parts (candidates, the choice, the step parser) need no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { makeEnv, Element } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';
import { boot, tree, ES } from './helpers/t15w3.js';

const FLOW = 'flowchart LR\n  A["Start"] --> B["End"]';
const SEQ = 'sequenceDiagram\n  participant U as User\n  participant P as Portal\n  U->>P: open page\n  P-->>U: html\n  P->>P: cache it\n  Note over U: waits';
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const json = (x) => JSON.parse(JSON.stringify(x));
async function ctx(extra = {}) {
  const c = await runPortal(makeEnv({}), { DOMParser: class {}, queueMicrotask, ...extra });
  await tick(40);
  return c;
}
const run = (c, code) => vm.runInContext(code, c);
const call = (c, fn, ...args) => { c.__a = args; return json(run(c, `${fn}(...__a)`)); };

test('flowchart candidates: the original first, then tighter spacing and the flipped direction with wrapped labels', async () => {
  const c = await ctx();
  const list = call(c, 'diagramCandidates', FLOW);
  assert.equal(list[0], FLOW, 'the original source is untouched');
  assert.ok(list.length >= 4);
  assert.ok(list.slice(1).every((s) => s.startsWith('%%{init:')), 'only our code prepends the init directive');
  assert.ok(list.some((s) => /flowchart TD/.test(s) && /wrappingWidth/.test(s)), 'flipped LR to TD with wrapped labels');
  assert.ok(list.some((s) => /flowchart LR/.test(s) && /nodeSpacing/.test(s)), 'same direction, tighter');
  const td = call(c, 'diagramCandidates', 'graph TD\n  A --> B');
  assert.ok(td.some((s) => /graph LR/.test(s)), 'TD flips to LR');
});

test('sequence candidates wrap messages with decreasing width and actor margin; other diagrams have one candidate', async () => {
  const c = await ctx();
  const list = call(c, 'diagramCandidates', SEQ);
  assert.equal(list[0], SEQ);
  const cfg = list.slice(1).map((s) => JSON.parse(/^%%\{init:(.*)\}%%/.exec(s)[1]).sequence);
  assert.ok(cfg.length >= 3 && cfg.every((q) => q.wrap === true));
  assert.deepEqual(cfg.map((q) => q.width), [...cfg.map((q) => q.width)].sort((a, b) => b - a));
  assert.deepEqual(cfg.map((q) => q.actorMargin), [...cfg.map((q) => q.actorMargin)].sort((a, b) => b - a));
  assert.deepEqual(call(c, 'diagramCandidates', 'erDiagram\n  A ||--o{ B : has'), ['erDiagram\n  A ||--o{ B : has']);
  assert.deepEqual(call(c, 'diagramCandidates', 'flowchart\n  A --> B'), ['flowchart\n  A --> B'], 'no direction, nothing to flip');
});

test('pickLayout: the first layout that fits, else the narrowest; nothing measured is no choice', async () => {
  const c = await ctx();
  const m = [{ source: 'a', width: 900 }, { source: 'b', width: 500 }, { source: 'c', width: 450 }, { source: 'd', width: 300 }];
  assert.deepEqual(call(c, 'pickLayout', m, 480), { source: 'c', width: 450, fits: true });
  assert.deepEqual(call(c, 'pickLayout', m, 5000), { source: 'a', width: 900, fits: true });
  assert.deepEqual(call(c, 'pickLayout', m, 100), { source: 'd', width: 300, fits: false });
  assert.deepEqual(call(c, 'pickLayout', [{ source: 'a', width: Infinity }, { source: 'b', width: 700 }], 100), { source: 'b', width: 700, fits: false });
  assert.equal(call(c, 'pickLayout', [], 400), null);
});

test('needsSteps: only a sequence whose width, even scaled to the text floor, is wider than the box', async () => {
  const c = await ctx();
  const floor = run(c, 'MIN_DIAGRAM_SCALE');
  assert.equal(call(c, 'needsSteps', SEQ, 400 / floor + 10, 400), true);
  assert.equal(call(c, 'needsSteps', SEQ, 400 / floor - 10, 400), false, 'scrolling at the floor is still allowed');
  assert.equal(call(c, 'needsSteps', FLOW, 9999, 400), false, 'a flowchart scrolls instead');
});

test('sequenceSteps: names through aliases, replies and self messages marked, notes and directives skipped', async () => {
  const c = await ctx();
  const steps = call(c, 'sequenceSteps', SEQ);
  assert.deepEqual(steps, [
    { from: 'User', to: 'Portal', text: 'open page', reply: false, self: false },
    { from: 'Portal', to: 'User', text: 'html', reply: true, self: false },
    { from: 'Portal', to: 'Portal', text: 'cache it', reply: false, self: true }]);
  const raw = call(c, 'sequenceSteps', 'sequenceDiagram\n  autonumber\n  actor A\n  A-)B: ping\n  B--)A: pong\n  A->>+B: go');
  assert.deepEqual(raw.map((s) => [s.from, s.to, s.reply]), [['A', 'B', false], ['B', 'A', true], ['A', 'B', false]]);
  assert.deepEqual(call(c, 'sequenceSteps', 'sequenceDiagram\n  Note over A: x'), []);
});

// ---- the drawn box ----
const svgOf = (w) => `<svg viewBox="0 0 ${w} 100"></svg>`;
function mermaidMock(widthOf, renders) {
  return { initialize() {}, render: async (id, source) => { renders.push(source); return { svg: svgOf(widthOf(source)) }; } };
}
class FakeParser {
  parseFromString(svg) {
    const el = new Element('svg');
    el.style = {};
    el.viewBox = { baseVal: { width: Number(/viewBox="0 0 (\d+)/.exec(svg)[1]) } };
    return { body: { querySelector: () => el } };
  }
}
async function drawn(src, { width, widthOf, es = false }) {
  const renders = [];
  const env = await boot('#/', { '/api/guide': { pages: [] } }, { DOMParser: FakeParser, ...(es ? ES : {}) });
  const c = env.__ctx;
  env.document.importNode = (n) => n;
  c.__mm = mermaidMock(widthOf, renders);
  run(c, 'mermaidReady = Promise.resolve(__mm)');
  c.__src = src;
  const box = run(c, 'adaptiveDiagram(__src, "Diagram")');
  box.isConnected = true; box.clientWidth = width;
  await tick();
  return { c, box, renders, env };
}
const widthByInit = (map) => (source) => { const m = /wrappingWidth":(\d+)|"width":(\d+)/.exec(source); return map(source, m ? Number(m[1] || m[2]) : 0); };

test('a diagram that fits as written is drawn as written (the first candidate)', async () => {
  const { box, renders } = await drawn(FLOW, { width: 600, widthOf: () => 400 });
  assert.deepEqual(renders, [FLOW, FLOW], 'measured once, then drawn');
  assert.ok(box.children[0].tagName === 'svg');
});

test('a narrow box gets the first candidate that fits; the drawn one is the chosen source, not the last measured', async () => {
  const widthOf = (s) => (/flowchart TD/.test(s) ? 250 : 900);
  const { box, renders } = await drawn(FLOW, { width: 300, widthOf });
  const last = renders[renders.length - 1];
  assert.match(last, /flowchart TD/);
  assert.ok(renders.length >= 3, 'measured candidates until one fit, then drew it');
  assert.equal(box.children[0].tagName, 'svg');
  assert.equal(box.getAttribute('role'), 'img');
});

test('when nothing fits, the narrowest candidate is drawn (fitDiagram then scales it to the floor)', async () => {
  const w = widthByInit((s, n) => 2000 + (s === FLOW ? 0 : n));
  const { renders } = await drawn(FLOW, { width: 300, widthOf: w });
  const widths = renders.slice(0, -1).map((s) => w(s));
  const lastW = w(renders[renders.length - 1]);
  assert.equal(lastW, Math.min(...widths), 'the narrowest measured');
});

test('a sequence that cannot fit even at the text floor is an ordered list of steps without role="img"', async () => {
  const { box } = await drawn(SEQ, { width: 200, widthOf: () => 900 });
  const list = box.children[0];
  assert.equal(list.tagName, 'ol');
  assert.equal(box.getAttribute('role'), undefined, 'a list never sits inside role="img"');
  const items = tree(list).filter((e) => e.tagName === 'li');
  assert.equal(items.length, 3);
  assert.equal(items[0].textContent, 'User → Portalopen page');
  assert.match(items[1].textContent, /^Portal → User \(reply\)html$/);
  assert.equal(items[2].textContent, 'Portalcache it', 'a self message shows only the participant');
});

test('Spanish marks the reply through the dictionary', async () => {
  const { box } = await drawn(SEQ, { width: 200, widthOf: () => 900, es: true });
  assert.match(tree(box).filter((e) => e.tagName === 'li')[1].textContent, /\(respuesta\)/);
});

test('a sequence that scrolls acceptably at the floor is drawn, not turned into steps', async () => {
  const { box } = await drawn(SEQ, { width: 300, widthOf: () => 330 });
  assert.equal(box.children[0].tagName, 'svg');
  assert.equal(box.getAttribute('role'), 'img');
});

test('on a width change the layout is picked again; the stale result of an earlier pick is ignored', async () => {
  const widthOf = (s) => (/flowchart TD/.test(s) ? 250 : 900);
  const { box, renders, c } = await drawn(FLOW, { width: 1000, widthOf });
  assert.equal(renders[renders.length - 1], FLOW, 'wide: as written');
  box.clientWidth = 300;
  c.__b = box;
  run(c, '__b.relayout()'); run(c, '__b.relayout()'); // two quick changes: only the last one draws
  await tick(200);
  assert.match(renders[renders.length - 1], /flowchart TD/);
  const sizes = renders.length;
  run(c, '__b.relayout()'); // same width: nothing to redo
  await tick(100);
  assert.equal(renders.length, sizes, 'an unchanged width does not redraw');
  box.clientWidth = 1000; run(c, '__b.relayout()'); await tick(200);
  assert.equal(renders[renders.length - 1], FLOW, 'wide again: as written');
});

test('a theme redraw draws the chosen layout, not the original', async () => {
  const widthOf = (s) => (/flowchart TD/.test(s) ? 250 : 900);
  const { c, renders } = await drawn(FLOW, { width: 300, widthOf });
  const before = renders.length;
  run(c, 'mermaidKey = ""');
  await run(c, 'redrawDiagrams()');
  await tick();
  assert.equal(renders.length, before + 1, 'one draw, no re-measuring');
  assert.match(renders[renders.length - 1], /flowchart TD/);
});

test('the guide draws its diagrams through adaptiveDiagram; mermaid stays strict', async () => {
  const read = (f) => readFile(path.join(STATIC, f), 'utf8');
  assert.match(await read('page-guide.js'), /adaptiveDiagram\(src/);
  assert.match(await read('app.js'), /securityLevel: "strict"/);
  assert.match(await read('index.html'), /<script src="\/static\/diagram-layout\.js"><\/script>/);
  const server = await readFile(path.join(STATIC, '..', 'server.py'), 'utf8');
  assert.match(server, /"diagram-layout\.js": JS/);
  const d = JSON.parse(await read('i18n/en.json'));
  assert.ok(d['diagram.reply']);
});
