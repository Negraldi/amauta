// T19h: findings of the browser review. F1: the outline of a flowchart uses the same translated, decoded labels as the drawn diagram and
// never lists a subgraph id (an edge to or from a subgraph uses its title); F2: focus follows the diagram/list toggle; F3: the
// palette starts empty and clears with its input; F4: the catalog intro follows the runtime filter; F6: error titles from an id;
// F7: repo and project selects sorted. Pure parts run in the fake DOM context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Element } from './helpers/fakedom.js';
import { boot, tick, tree } from './helpers/t15w3.js';

const run = (c, code) => vm.runInContext(code, c);
const json = (x) => JSON.parse(JSON.stringify(x));
const call = (c, fn, ...args) => { c.__a = args; return json(run(c, `${fn}(...__a)`)); };
const ctx = async (extra = {}) => (await boot('#/', { '/api/guide': { pages: [] } }, extra)).__ctx;

const ARCH = [
  'flowchart LR', '  n0["Runtime"]', '  subgraph g1["amauta kernel"]', '    n2["Dispatch"]', '  end',
  '  subgraph g3["Hooks"]', '    n4["Stop"]', '  end',
  '  n0 -->|"fires"| g3', '  g3 -->|"runs handlers"| g1', '  n0 -->|"memory reads#44; writes"| n2',
].join('\n');

test('F1: the outline never lists a subgraph id; edges to and from a subgraph use its title', async () => {
  const c = await ctx();
  const out = call(c, 'flowOutline', ARCH);
  const nodes = out.flatMap((g) => g.nodes);
  assert.ok(nodes.every((n) => !/^g\d+$/.test(n.id) && !/^g\d+$/.test(n.label)), JSON.stringify(nodes));
  const runtime = nodes.find((n) => n.label === 'Runtime');
  assert.deepEqual(runtime.edges.map((e) => e.to), ['Hooks', 'Dispatch']);
  const hooks = out.find((g) => g.title === 'Hooks');
  assert.deepEqual(hooks.edges, [{ to: 'amauta kernel', label: 'runs handlers' }], 'an edge out of a subgraph hangs on its group');
  assert.equal(runtime.edges[1].label, 'memory reads, writes', 'entity codes are decoded');
});

test('F1: in Spanish the outline translates node, subgraph and edge labels like the drawn diagram', async () => {
  const env = await boot('#/', { '/api/guide': { pages: [] } }, { navigator: { language: 'es-ES' } });
  const c = env.__ctx;
  c.__src = ARCH;
  const el = run(c, 'outlineList(__src, "x")');
  const text = tree(el).map((e) => e.textContent).join('|');
  assert.ok(text.includes('dispara'), text);
  assert.ok(text.includes('ejecuta los manejadores'), text);
  assert.ok(!text.includes('(fires)') && !/\bg\d+\b/.test(text), text);
});

test('F1: the outline box wraps instead of growing to the diagram width', async () => {
  const css = (await import('node:fs')).readFileSync(new URL('../python/amauta/portal/static/style-pages.css', import.meta.url), 'utf8');
  assert.match(css, /\.arch-scroll \.diagram\.outline\s*\{[^}]*width:\s*auto/);
});

// ---- F2: focus follows the toggle that re-renders itself ----
class FakeParser {
  parseFromString(svg) {
    const el = new Element('svg');
    el.style = {};
    el.viewBox = { baseVal: { width: Number(/viewBox="0 0 (\d+)/.exec(svg)[1]) } };
    return { body: { querySelector: () => el } };
  }
}
test('F2: after the diagram/list toggle the new toggle button has focus', async () => {
  const env = await boot('#/', { '/api/guide': { pages: [] } }, { DOMParser: FakeParser });
  const c = env.__ctx;
  env.document.importNode = (n) => n;
  c.__mm = { initialize() {}, render: async () => ({ svg: '<svg viewBox="0 0 900 100"></svg>' }) };
  run(c, 'mermaidReady = Promise.resolve(__mm)');
  c.__src = 'flowchart LR\n  A["a"] --> B["b"]';
  const box = run(c, 'adaptiveDiagram(__src, "Diagram")');
  box.isConnected = true; box.clientWidth = 300;
  await tick(80);
  const button = () => tree(box).find((e) => e.tagName === 'button');
  button().click();
  assert.equal(button().focused, true, 'the button to see the list has focus');
  await tick(60);
  button().focused = false;
  button().click();
  assert.equal(button().focused, true, 'the button to see the diagram has focus');
  assert.match(box.className, /outline/, 'the outline box wraps');
});
