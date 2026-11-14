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
