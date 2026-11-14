// T19d: diagram candidates also turn the directions inside subgraphs (a nested `direction LR` defeats a top-level flip), BT and RL
// flowcharts are flipped too, and a flowchart that cannot fit a narrow box without sideways scroll becomes an outline (a list of
// the nodes with their outgoing edges) with a button to see the diagram. The pure parts need no browser; the box uses the fake DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Element } from './helpers/fakedom.js';
import { boot, tick, tree } from './helpers/t15w3.js';

const run = (c, code) => vm.runInContext(code, c);
const json = (x) => JSON.parse(JSON.stringify(x));
const call = (c, fn, ...args) => { c.__a = args; return json(run(c, `${fn}(...__a)`)); };
const ctx = async () => (await boot('#/', { '/api/guide': { pages: [] } })).__ctx;

const NESTED = 'flowchart TB\n  subgraph hooks\n    direction LR\n    A["one"] --> B["two"]\n  end\n  X --> A';

test('a nested direction LR or RL is turned to TB in some candidates, combined with wrapping and spacing', async () => {
  const c = await ctx();
  const list = call(c, 'diagramCandidates', NESTED);
  assert.equal(list[0], NESTED, 'the original first');
  const turned = list.filter((s) => /direction TB/.test(s) && !/direction LR/.test(s));
  assert.ok(turned.length >= 2, 'several candidates with the subgraph turned');
  assert.ok(turned.every((s) => /^%%\{init:/.test(s)), 'with spacing or wrapping');
  assert.ok(turned.some((s) => /wrappingWidth":120/.test(s)), 'with tighter wrapping too');
  const rl = call(c, 'diagramCandidates', NESTED.replace('direction LR', '  direction RL'));
  assert.ok(rl.some((s) => !/direction RL/.test(s) && /direction TB/.test(s)), 'RL turned as well');
});

test('a source without a nested horizontal direction gets no subgraph candidates', async () => {
  const c = await ctx();
  const list = call(c, 'diagramCandidates', 'flowchart TB\n  subgraph g\n    direction TB\n    A --> B\n  end');
  assert.ok(list.every((s) => /direction TB/.test(s)));
});

test('BT and RL flowcharts are flipped (BT to RL, RL to BT keep the arrow sense)', async () => {
  const c = await ctx();
  const bt = call(c, 'diagramCandidates', 'flowchart BT\n  A --> B');
  assert.ok(bt.some((s) => /flowchart RL/.test(s)), 'BT flips to RL');
  const rl = call(c, 'diagramCandidates', 'graph RL\n  A --> B');
  assert.ok(rl.some((s) => /graph BT/.test(s)), 'RL flips to BT');
  assert.ok(bt.length > 1 && rl.length > 1);
});

// ---- the outline of a flowchart too wide for a narrow box ----
const svgOf = (w) => `<svg viewBox="0 0 ${w} 100"></svg>`;
class FakeParser {
  parseFromString(svg) {
    const el = new Element('svg');
    el.style = {};
    el.viewBox = { baseVal: { width: Number(/viewBox="0 0 (\d+)/.exec(svg)[1]) } };
    return { body: { querySelector: () => el } };
  }
}
async function drawn(src, { width, svgWidth, es = false }) {
  const renders = [];
  const env = await boot('#/', { '/api/guide': { pages: [] } }, { DOMParser: FakeParser, ...(es ? { navigator: { language: 'es-ES' } } : {}) });
  const c = env.__ctx;
  env.document.importNode = (n) => n;
  c.__mm = { initialize() {}, render: async (id, source) => { renders.push(source); return { svg: svgOf(svgWidth) }; } };
  run(c, 'mermaidReady = Promise.resolve(__mm)');
  c.__src = src;
  const box = run(c, 'adaptiveDiagram(__src, "Diagram")');
  box.isConnected = true; box.clientWidth = width;
  await tick(80);
  return { c, box, renders };
}
const FLOW = [
  'flowchart LR', '  subgraph core["Core parts"]', '    A["Start"] -->|go| B("Middle")', '  end',
  '  B -- maybe --> C{Decide}', '  C -->|yes| D[End]', '  C -.-> A',
].join('\n');
const lis = (el) => tree(el).filter((e) => e.tagName === 'li');
const buttons = (el) => tree(el).filter((e) => e.tagName === 'button');

test('flowOutline: nodes in source order with labels, outgoing edges with their labels, subgraphs as groups', async () => {
  const c = await ctx();
  const out = call(c, 'flowOutline', FLOW);
  assert.deepEqual(out.map((g) => g.title), ['Core parts', '']);
  assert.deepEqual(out[0].nodes.map((n) => n.label), ['Start', 'Middle']);
  assert.deepEqual(out[0].nodes[0].edges, [{ to: 'Middle', label: 'go' }]);
  assert.deepEqual(out[0].nodes[1].edges, [{ to: 'Decide', label: 'maybe' }]);
  assert.deepEqual(out[1].nodes.map((n) => n.label), ['Decide', 'End']);
  assert.deepEqual(out[1].nodes[0].edges, [{ to: 'End', label: 'yes' }, { to: 'Start', label: '' }]);
  assert.deepEqual(out[1].nodes[1].edges, []);
});

test('a narrow box and a flowchart too wide even at the text floor render the outline, not the diagram', async () => {
  const { box, renders } = await drawn(FLOW, { width: 300, svgWidth: 900 });
  assert.equal(box.getAttribute('role'), undefined, 'a list never sits inside role="img"');
  assert.equal(box.children[0].children[0].children[0].tagName, 'h4');
  assert.equal(box.children[0].children[0].children[0].textContent, 'Core parts');
  const items = lis(box).map((e) => e.textContent);
  assert.ok(items.some((s) => s.startsWith('Start') && s.includes('→ Middle (go)')), items.join('|'));
  assert.ok(items.some((s) => s === '→ Start'), 'an edge without a label has no parentheses');
  assert.ok(items.some((s) => s === '→ End (yes)'));
  assert.equal(tree(box).filter((e) => e.tagName === 'svg').length, 0);
  assert.equal(buttons(box)[0].textContent, 'Show the diagram');
  assert.ok(renders.length >= 1, 'candidates were measured');
});

test('the button swaps in the diagram and another button comes back to the list', async () => {
  const { box, c } = await drawn(FLOW, { width: 300, svgWidth: 900 });
  buttons(box)[0].click();
  await tick(60);
  assert.equal(tree(box).filter((e) => e.tagName === 'svg').length, 1, 'the diagram is drawn');
  assert.equal(tree(box).filter((e) => e.tagName === 'li').length, 0);
  const back = buttons(box)[0];
  assert.equal(back.textContent, 'Show as a list');
  back.click();
  assert.equal(buttons(box)[0].textContent, 'Show the diagram');
  assert.ok(lis(box).length > 0);
  void c;
});

test('Spanish labels the buttons through the dictionary', async () => {
  const { box } = await drawn(FLOW, { width: 300, svgWidth: 900, es: true });
  assert.equal(buttons(box)[0].textContent, 'Ver el diagrama');
  buttons(box)[0].click();
  await tick(60);
  assert.equal(buttons(box)[0].textContent, 'Ver como lista');
});

test('a wide box draws the diagram; so does a narrow box whose diagram scrolls acceptably at the floor', async () => {
  const wide = await drawn(FLOW, { width: 1000, svgWidth: 900 });
  assert.equal(wide.box.children[0].tagName, 'svg');
  const near = await drawn(FLOW, { width: 300, svgWidth: 330 });
  assert.equal(near.box.children[0].tagName, 'svg');
  const mid = await drawn(FLOW, { width: 600, svgWidth: 1342 });
  assert.equal(mid.box.children[0].tagName, 'svg', 'not narrow: it scrolls');
});

test('a wider box after a resize goes back from the outline to the diagram', async () => {
  const { box, c } = await drawn(FLOW, { width: 300, svgWidth: 900 });
  assert.equal(box.children[0].tagName, 'div');
  box.clientWidth = 1000;
  c.__b = box;
  run(c, '__b.relayout()');
  await tick(200);
  assert.equal(box.children[0].tagName, 'svg');
});

test('a sequence keeps its numbered steps', async () => {
  const { box } = await drawn('sequenceDiagram\n  A->>B: hi', { width: 200, svgWidth: 900 });
  assert.equal(box.children[0].tagName, 'ol');
});
