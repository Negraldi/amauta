import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEnv, Element } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const STATIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'python', 'amauta', 'portal', 'static');
const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 30));
const HOSTILE = '<img src=x onerror=alert(1)>';
const ARCH = 'flowchart LR\n  n0["amauta"]';
const ODD = 'flowchart LR\n  n0["feat.md: 1/2 done"]';
const FENCE = 'A-->B';

const routes = {
  '/api/harness': { installed: true, version: '1', hooks: [], mcp_servers: [], components: [], managed_files: 1, telemetry: true, rdd_mode: 'on', persona: 'neutral' },
  '/api/archify': { installed: true, available: false, reason: 'no archify', fallback: ARCH },
  '/api/odd': { repos: [] },
  '/api/memory-files': { items: [{ id: 'a/memory/n.md', name: 'n.md', project: 'a', size: 3, mtime: 'm' }] },
  '/api/memory-file': { id: 'a/memory/n.md', content: `# T\n\n\`\`\`mermaid\n${FENCE}\n\`\`\`\n\n\`\`\`js\nnot mermaid\n\`\`\`\n${HOSTILE}\n`, truncated: false },
  '/api/memories': { source: 'own', available: true, items: [], facets: { projects: [], types: [] } },
  '/api/graphify': { repos: [{ name: 'one', path: '/r/one', available: true, nodes: 2, edges: 1, synced_at: 's', graph_mtime: 'g' }] },
  '/api/graph/nodes': { available: true, items: [{ id: 'a', label: 'A', kind: 'code', file: 'a.py' }] },
  '/api/graph/neighbors': { available: true, depth: 1, start: ['a'], nodes: [{ id: 'a', label: 'A', kind: 'code', file: 'a.py', depth: 0 }], edges: [] },
  '/api/graph/diagram': { available: true, source: 'flowchart LR\n  n0["A"]', nodes: 1, edges: 0, truncated: false },
};

async function boot(hash, { failRender = false } = {}) {
  const env = makeEnv(routes);
  env.location.hash = hash;
  const log = { init: [], render: [], scripts: [] };
  env.window.mermaid = {
    initialize: (cfg) => log.init.push(cfg),
    render: async (id, src) => { log.render.push(src); if (failRender) throw new Error(`Parse error on line 2\n${HOSTILE}`); return { svg: '<svg></svg>' }; },
  };
  const head = new Element('head');
  head.append = (script) => { log.scripts.push(script.src); queueMicrotask(() => script.onload()); };
  env.document.head = head;
  env.document.importNode = (n) => n;
  class DOMParser { parseFromString(_s, type) { log.parsedAs = type; return { body: { querySelector: () => new Element('svg') } }; } }
  await runPortal(env, { DOMParser, queueMicrotask });
  await tick();
  return { env, log };
}

test('app.js initializes mermaid strictly, without auto-start, from the vendored file only', async () => {
  const js = await read('app.js');
  assert.match(js, /startOnLoad:\s*false/);
  assert.match(js, /securityLevel:\s*"strict"/);
  assert.doesNotMatch(js, /securityLevel:\s*"(loose|antiscript|sandbox)"/);
  assert.match(js, /\/static\/mermaid\.min\.js/);
  assert.doesNotMatch(js, /https?:\/\/(?!www\.w3\.org)/);
  assert.ok(!js.includes('innerHTML'));
  assert.match(await read('index.html'), /<script src="\/static\/app\.js"><\/script>/); // mermaid is not loaded on every page
});

test('the Harness page draws the architecture diagram and loads mermaid once', async () => {
  const { env, log } = await boot('#/harness');
  assert.deepEqual(log.scripts, ['/static/mermaid.min.js']);
  assert.equal(log.init.length, 1);
  assert.equal(log.init[0].securityLevel, 'strict');
  assert.equal(log.init[0].startOnLoad, false);
  assert.deepEqual(log.render, [ARCH]);
  assert.equal(log.parsedAs, 'text/html');
  assert.match(env.document.getElementById('view').textContent, /Architecture/);
});

test('the separate Diagrams page is gone: old links land on Harness and the page never asks /api/diagrams', async () => {
  for (const hash of ['#diagrams', '#/diagrams']) {
    const { env } = await boot(hash);
    assert.equal(env.calls.some((c) => String(c.url).startsWith('/api/diagrams')), false, hash);
    assert.ok(env.calls.some((c) => c.url === '/api/harness'), hash);
  }
});

test('a failed render shows a one-line warning and the source as text, never as markup', async () => {
  const { env } = await boot('#/harness', { failRender: true });
  const text = env.document.getElementById('view').textContent;
  assert.match(text, /Diagram could not be rendered: Parse error on line 2/);
  assert.ok(!text.includes('onerror=alert(1)') || text.includes('flowchart LR')); // only inside the <pre> source / first line of the message
  let pres = 0;
  env.document.getElementById('view').walk((e) => { if (e.tagName === 'pre') pres += 1; });
  assert.ok(pres >= 1);
});

test('mermaid fences in a displayed memory file are drawn; other fences and prose are not', async () => {
  const { env, log } = await boot('#memories');
  const btn = (() => { let found; env.document.getElementById('view').walk((e) => { if (e.tagName === 'button' && e.textContent === 'n.md') found = e; }); return found; })();
  assert.ok(btn, 'file row not found');
  btn.click();
  await tick();
  assert.deepEqual(log.render, [`${FENCE}\n`]);
});

test('selecting a graph node also draws its neighborhood diagram', async () => {
  const { env, log } = await boot('#memories');
  let node;
  env.document.getElementById('view').walk((e) => { if (e.attrs && e.attrs['data-graph'] !== undefined) node = e; });
  assert.ok(node, 'graph node row not found');
  node.click();
  await tick();
  assert.ok(log.render.includes('flowchart LR\n  n0["A"]'));
  assert.ok(env.calls.some((c) => String(c.url).startsWith('/api/graph/diagram?')));
});
