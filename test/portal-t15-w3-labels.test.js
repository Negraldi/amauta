// T15 W3 group 1 (class 4): raw enum values the server sends get a label in both languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, page, text, view, ES } from './helpers/t15w3.js';

const memory = page('memory', { id: '7', title: 'A memory', meta: [{ label: 'Type', value: 'session_summary' }, { label: 'Project', value: 'amauta' },
  { label: 'Scope', value: 'project' }, { label: 'Source', value: 'own' }] });

test('B1: a memory page labels Type, Scope and Source like the list does (es)', async () => {
  const env = await boot('#/memory/7', { '/api/wiki/page': memory }, ES);
  assert.match(text(env), /Resumen de sesión/);
  assert.doesNotMatch(text(env), /session_summary/);
  assert.doesNotMatch(text(env), /Ámbito\s*project|Origen\s*own/);
});
test('B1: the same page in English', async () => {
  const env = await boot('#/memory/7', { '/api/wiki/page': memory });
  assert.match(text(env), /Session summary/);
  assert.match(text(env), /Scope\s*Project/);
  assert.match(text(env), /amauta memory/);
});

const hook = page('hook', { id: 'Stop:abc', title: 'amauta usage', meta: [{ label: 'Event', value: 'Stop' }, { label: 'Hook type', value: 'command' }, { label: 'Scope', value: 'user' }] });
test('C8: hook scope and type are words in Spanish', async () => {
  const env = await boot('#/hook/x', { '/api/wiki/page': hook }, ES);
  assert.doesNotMatch(text(env), /Ámbito\s*user|Tipo de hook\s*command/);
  assert.match(text(env), /Tipo de hook\s*Comando/);
  assert.match(text(env), /Ámbito\s*Usuario/);
});
const mcp = page('mcp', { id: 'engram', title: 'engram', meta: [{ label: 'Type', value: 'stdio' }] });
test('C8: the MCP transport is a word', async () => {
  const env = await boot('#/mcp/engram', { '/api/wiki/page': mcp }, ES);
  assert.doesNotMatch(text(env), /Tipo\s*stdio/);
  assert.match(text(env), /Proceso local/);
});

const node = page('node', { id: 'r::n1', title: 'ref_node_fs', meta: [{ label: 'Kind', value: 'concept' }, { label: 'Node id', value: 'ref_node_fs' }],
  sections: [{ heading: 'imports_from (incoming)', relation: 'imports_from', direction: 'incoming', items: [{ label: 'Helper', kind: 'node', id: 'r::h', value: 'code' }] },
    { heading: 're_exports (outgoing)', relation: 're_exports', direction: 'outgoing', items: [{ label: 'Other', kind: 'node', id: 'r::o', value: 'concept' }] }],
  diagram: { source: 'flowchart LR\n  n0["ref_node_fs #40;concept#41;"]\n  n0 -->|"imports_from"| n1["B #40;code#41;"]', nodes: 2, edges: 1 } });
test('D7: relation headings and neighbour kinds are words, both ways (es)', async () => {
  const env = await boot('#/node/r%3A%3An1', { '/api/wiki/page': node }, ES);
  const t = text(env);
  assert.match(t, /Importado desde por|Importado por/);
  assert.match(t, /Reexporta/);
  assert.doesNotMatch(t, /imports_from|re_exports|incoming|outgoing/);
  assert.match(t, /Código/);
});
test('D7: the English headings read as sentences', async () => {
  const env = await boot('#/node/r%3A%3An1', { '/api/wiki/page': node });
  assert.match(text(env), /Imported by/);
  assert.match(text(env), /Re-exports/);
});
test('D7: the diagram source gets labelled relations and kinds', async () => {
  const env = await boot('#/node/r%3A%3An1', { '/api/wiki/page': node }, ES);
  const ctx = env.__ctx;
  assert.ok(ctx, 'boot exposes the context');
  const out = ctx.localizeGraphSource(node.diagram.source);
  assert.match(out, /\|"importa desde"\|/);
  assert.match(out, /#40;Concepto#41;/);
  assert.match(out, /#40;Código#41;/);
});
test('D7: the heading is the label and the internal id sits beside it as secondary text', async () => {
  const env = await boot('#/node/r%3A%3An1', { '/api/wiki/page': page('node', { id: 'r::n1', title: 'Readable name', meta: [{ label: 'Node id', value: 'ref_node_fs' }] }) });
  const h1 = [...(function* () { const all = []; view(env).walk((e) => all.push(e)); yield* all; })()].find((e) => e.tagName === 'h1');
  assert.equal(h1.textContent, 'Readable name');
  assert.match(text(env), /ref_node_fs/);
});

const T = { messages: 10, sessions: 2, input: 1, output: 1, cache_read: 1, cache_write: 1, latest: '2026-11-09T21:10:00Z', first: '2026-11-01T00:00:00Z' };
const MODELS = [{ model: 'claude-a', messages: 9, input: 10, output: 10, cache_read: 0, cache_write: 0 },
  { model: 'claude-b', messages: 3, input: 900, output: 90, cache_read: 5000, cache_write: 0 }, { model: '<synthetic>', messages: 1, input: 0, output: 0, cache_read: 0, cache_write: 0 }];
const overview = { available: true, totals: T, cache_hit_ratio: 0.5, daily: [], models: MODELS, runtimes: [], events: 4, dropped_events: 0 };
test('D15: the model table opens sorted by the share, labels the synthetic model and says what the share is of', async () => {
  const env = await boot('#/usage', { '/api/overview': overview, '/api/costs': { enabled: false, models: [] } });
  const rows = tree0(view(env)).filter((e) => e.tagName === 'tr').map((r) => r.textContent).filter((x) => /claude-|ynthetic/.test(x));
  assert.match(rows[0], /^claude-b/);
  assert.doesNotMatch(text(env), /<synthetic>/);
  assert.match(text(env), /No model call/);
  assert.match(text(env), /Share of all tokens, cache included/);
  assert.match(text(env), /telemetry events? .*all time/i);
});
function tree0(el) { const all = []; el.walk((e) => all.push(e)); return all; }

test('E6: the harness page spells the persona like Settings does', async () => {
  const hs = { installed: true, version: '1', hooks: [], mcp_servers: [], persona: 'gentleman', components: [], managed_files: 0, telemetry: true, rdd_mode: 'off' };
  const env = await boot('#/harness', { '/api/harness': hs, '/api/skills': { skills: [] }, '/api/archify': { installed: false } });
  assert.match(text(env), /Persona\s*Gentleman/);
  assert.doesNotMatch(text(env), /Persona\s*gentleman/);
});

import { readDicts } from './helpers/portalboot.js';
// Guard: each enum value the server sends for these fields has a label in both languages, or the fallback is deliberate.
// Unknown values (a user's own memory type, a relation graphify adds later) are shown as sent: enumLabel / humanRelation.
const SENT = {
  memtype: ['note', 'decision', 'bugfix', 'discovery', 'convention', 'config', 'session_summary', 'architecture', 'pattern', 'learning', 'preference', 'reference', 'manual'],
  memscope: ['project', 'personal'], memsource: ['own', 'engram'], scope: ['user', 'project', 'plugin'], hooktype: ['command', 'http', 'prompt', 'agent'],
  transport: ['stdio', 'http', 'sse'], 'rel.out': ['calls', 'contains', 'imports_from', 'imports', 'indirect_call', 'method', 'references', 'rationale_for', 'inherits', 're_exports', 'cites', 'dynamic_import', 'uses', 'defines'],
  'rel.in': ['calls', 'contains', 'imports_from', 'imports', 'indirect_call', 'method', 'references', 'rationale_for', 'inherits', 're_exports', 'cites', 'dynamic_import', 'uses', 'defines'],
  'rel.edge': ['calls', 'imports_from', 'contains'], 'graph.kind': ['code', 'document', 'paper', 'image', 'video', 'rationale', 'concept'],
  'pipemode': ['process', 'preview'],
};
test('every enum value the server sends has a label in en and es', async () => {
  const d = await readDicts();
  const missing = [];
  for (const [prefix, values] of Object.entries(SENT)) for (const v of values) for (const lang of ['en', 'es']) if (!d[lang][`${prefix}.${v}`]) missing.push(`${lang}:${prefix}.${v}`);
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(d.en).sort(), Object.keys(d.es).sort());
});
