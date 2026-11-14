// T18a: every diagram in the portal is adaptive (one entry point, adaptiveDiagram), not only the guide's. The callers must not
// bypass it, onDrawn runs after every layout draw, and diagram kinds without a layout to try pass through unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Element } from './helpers/fakedom.js';
import { STATIC } from './helpers/portalboot.js';
import { boot, tick } from './helpers/t15w3.js';

const FLOW = 'flowchart LR\n  A["Start"] --> B["End"]';
const run = (c, code) => vm.runInContext(code, c);
const json = (x) => JSON.parse(JSON.stringify(x));
const candidates = (c, src) => { c.__s = src; return json(run(c, 'diagramCandidates(__s)')); };

class FakeParser {
  parseFromString(svg) {
    const el = new Element('svg');
    el.style = {};
    el.viewBox = { baseVal: { width: Number(/viewBox="0 0 (\d+)/.exec(svg)[1]) } };
    return { body: { querySelector: () => el } };
  }
}
async function drawn(src, { width, onDrawn }) {
  const renders = [];
  const env = await boot('#/', { '/api/guide': { pages: [] } }, { DOMParser: FakeParser });
  const c = env.__ctx;
  env.document.importNode = (n) => n;
  c.__mm = { initialize() {}, render: async (id, source) => { renders.push(source); return { svg: '<svg viewBox="0 0 400 100"></svg>' }; } };
  run(c, 'mermaidReady = Promise.resolve(__mm)');
  c.__src = src; c.__cb = onDrawn;
  const box = run(c, 'adaptiveDiagram(__src, "Diagram", __cb)');
  box.isConnected = true; box.clientWidth = width;
  await tick(60);
  return { c, box, renders };
}

test('no caller bypasses the adaptive path: diagramBox is gone and every view calls adaptiveDiagram', async () => {
  const files = (await readdir(STATIC)).filter((f) => f.endsWith('.js'));
  const src = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await readFile(path.join(STATIC, f), 'utf8')])));
  for (const f of files) assert.doesNotMatch(src[f], /\bdiagramBox\b/, `${f} still uses diagramBox`);
  for (const f of ['page-harness.js', 'page-wiki.js', 'page-projects.js', 'page-guide.js']) assert.match(src[f], /adaptiveDiagram\(/, f);
  assert.equal((src['page-harness.js'].match(/adaptiveDiagram\(/g) || []).length, 2, 'graph neighbours and the architecture diagram');
  assert.equal((src['page-wiki.js'].match(/adaptiveDiagram\(/g) || []).length, 2, 'node neighbours and markdown blocks');
});

test('an adaptive box can be laid out again (relayout) and onDrawn runs after every layout draw', async () => {
  const seen = [];
  const { c, box } = await drawn(FLOW, { width: 600, onDrawn: (b) => seen.push(b) });
  assert.equal(typeof box.relayout, 'function');
  assert.deepEqual(seen, [box], 'called once after the first draw, with the box');
  box.clientWidth = 300;
  c.__b = box;
  run(c, '__b.relayout()');
  await tick(200);
  assert.equal(seen.length, 2, 'and again after the relayout');
});

test('onDrawn is optional', async () => {
  const { box } = await drawn(FLOW, { width: 600 });
  assert.equal(box.children[0].tagName, 'svg');
});

test('kinds without a layout to try pass through unchanged and still draw', async () => {
  const kinds = ['pie title Pets\n  "Dogs" : 3', 'gantt\n  title T\n  section S\n  A :a1, 2026-01-01, 3d', 'stateDiagram-v2\n  [*] --> A',
    'flowchart BT\n  A --> B', 'graph RL\n  A --> B'];
  const { c } = await drawn(FLOW, { width: 600 });
  for (const k of kinds) assert.deepEqual(candidates(c, k), [k], k.split('\n')[0]);
  for (const k of kinds) {
    const { box, renders } = await drawn(k, { width: 300 });
    assert.deepEqual(renders, [k, k], 'measured once, drawn once, as written');
    assert.equal(box.children[0].tagName, 'svg');
  }
});

test('a source that already starts with an init directive keeps it and can still be flipped', async () => {
  const { c } = await drawn(FLOW, { width: 600 });
  const src = '%%{init: {"theme": "forest"}}%%\ngraph TD\n  A --> B';
  const list = candidates(c, src);
  assert.equal(list[0], src, 'untouched first');
  assert.ok(list.slice(1).every((s) => s.includes('{"theme": "forest"}')), 'the original directive is kept in every candidate');
  assert.ok(list.some((s) => /graph LR/.test(s)), 'the direction is still found after the directive');
  const seq = candidates(c, '%%{init: {"theme": "dark"}}%%\nsequenceDiagram\n  A->>B: hi');
  assert.ok(seq.length > 1 && seq.every((s) => s.includes('"theme": "dark"')));
});
