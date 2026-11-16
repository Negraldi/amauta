// T20d: before stacking everything, a flowchart gets lighter stacked candidates that only put the nodes of an edge-free subgraph in
// a column. Chains inside a subgraph and sibling subgraphs stay side by side, so a wide box gets a shorter drawing. Then inner
// candidates stack the nodes of every subgraph and leave only the sibling subgraphs side by side (a middle width).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { boot } from './helpers/t15w3.js';

const json = (x) => JSON.parse(JSON.stringify(x));
const call = (c, fn, ...args) => { c.__a = args; return json(vm.runInContext(`${fn}(...__a)`, c)); };
const ctx = async () => (await boot('#/', { '/api/guide': { pages: [] } })).__ctx;

const ARCH = [
  'flowchart TB', '  n0["Root"]', '  subgraph hooks["Hook events"]', '    direction TB', '    H1["one"]', '    H2["two"]', '    H3["three"]', '    H1 --> H2', '  end',
  '  subgraph mcp["MCP servers"]', '    direction TB', '    M1["a"]', '    M2["b"]', '    M3["c"]', '  end',
  '  n0 --> hooks', '  n0 --> mcp',
].join('\n');

test('light stacked candidates come before the full ones and only chain the nodes of an edge-free subgraph', async () => {
  const list = call(await ctx(), 'diagramCandidates', ARCH);
  const stacked = list.filter((s) => /~~~/.test(s));
  const light = stacked.filter((s) => !/hooks ~~~ mcp/.test(s) && !/H2 ~~~ H3/.test(s));
  assert.equal(light.length, 2, 'two wrapping widths');
  assert.deepEqual(stacked.slice(0, 2), light, 'tried before the full stack');
  assert.equal(stacked.length, 6);
  for (const s of light) {
    assert.match(s, /M1 ~~~ M2/);
    assert.match(s, /M2 ~~~ M3/);
    assert.doesNotMatch(s, /H2 ~~~ H3/, 'a subgraph with edges keeps its own layout');
    assert.match(s, /^%%\{init:/);
  }
});

test('inner stacked candidates sit between the light and the full ones: every subgraph in a column, siblings side by side', async () => {
  const stacked = call(await ctx(), 'diagramCandidates', ARCH).filter((s) => /~~~/.test(s));
  const inner = stacked.slice(2, 4);
  for (const s of inner) {
    assert.match(s, /M1 ~~~ M2/);
    assert.match(s, /H2 ~~~ H3/, 'a subgraph with edges is stacked too');
    assert.doesNotMatch(s, /H1 ~~~ H2/, 'connected nodes are not chained');
    assert.doesNotMatch(s, /hooks ~~~ mcp/, 'sibling subgraphs stay side by side');
  }
  for (const s of stacked.slice(4)) assert.match(s, /hooks ~~~ mcp/);
  const noSiblings = 'flowchart TB\n  subgraph g\n    direction TB\n    A --> B\n    C\n  end\n  subgraph k\n    direction TB\n    D\n    E\n  end';
  const list = call(await ctx(), 'diagramCandidates', noSiblings).filter((s) => /~~~/.test(s));
  assert.equal(list.length, 4, 'inner equals full without sibling subgraphs: light and full only');
});

test('no light candidate when it would equal the full stack or chain nothing', async () => {
  const c = await ctx();
  const only = 'flowchart TB\n  subgraph g\n    direction TB\n    A\n    B\n  end';
  assert.equal(call(c, 'diagramCandidates', only).filter((s) => /~~~/.test(s)).length, 2, 'light equals full: once');
  const chained = 'flowchart TB\n  subgraph g\n    direction TB\n    A --> B\n    C\n  end';
  const list = call(c, 'diagramCandidates', chained).filter((s) => /~~~/.test(s));
  assert.equal(list.length, 2);
  for (const s of list) assert.match(s, /B ~~~ C/);
});
