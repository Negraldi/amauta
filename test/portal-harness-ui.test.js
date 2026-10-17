import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const XSS = '<img src=x onerror=alert(1)>';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const ctx = {};
vm.runInNewContext(await readFile(path.join(STATIC, 'wikiroute.js'), 'utf8'), ctx);
const R = ctx.AmautaRoute;
const plain = (x) => JSON.parse(JSON.stringify(x));

const row = (kind, id, over) => ({ kind, id, title: id, description: null, source: 'Your Claude home', uses: 0, ...over });
const CATALOG = { total: 4, pending: 0, groups: [
  { kind: 'hook', label: 'Hooks', items: [row('hook', 'Stop:abc12345', { title: 'Stop: amauta usage', description: 'Imports usage into the local database' })] },
  { kind: 'mcp', label: 'MCP servers', items: [row('mcp', 'engram', { description: XSS })] },
  { kind: 'agent', label: 'Agents', items: [row('agent', 'plug:agent-x', { title: 'plug:agent-x', source: 'Plugin plug', description: 'Reviews code' })] },
  { kind: 'plugin', label: 'Plugins', items: [row('plugin', 'plug', { source: 'Plugin plug' })] },
] };

async function boot(hash, over = {}, extra = {}) {
  const env = makeEnv({ '/api/harness/components': CATALOG, '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false }, ...over });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  return env;
}
const view = (env) => env.document.getElementById('view');
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));

test('the route table knows every harness component kind and the catalog route', () => {
  for (const k of ['hook', 'mcptool', 'connector', 'agent', 'command', 'plugin', 'outputstyle', 'component']) assert.ok(k in R.KINDS, k);
  assert.deepEqual(plain(R.parseHash('#/hook/Stop%3Aabc12345')), { kind: 'hook', id: 'Stop:abc12345' });
  assert.deepEqual(plain(R.parseHash('#/component')), { kind: 'component', id: '' });
  assert.equal(R.formatHash('mcptool', 'engram/mem_save'), '#/mcptool/engram%2Fmem_save');
});

test('filterComponents matches title, id, description and source and drops empty groups', () => {
  const ids = (g) => plain(g.flatMap((x) => x.items.map((i) => i.id)));
  assert.deepEqual(ids(R.filterComponents(CATALOG.groups, '')), ['Stop:abc12345', 'engram', 'plug:agent-x', 'plug']);
  assert.deepEqual(ids(R.filterComponents(CATALOG.groups, 'REVIEWS')), ['plug:agent-x']);
  assert.deepEqual(ids(R.filterComponents(CATALOG.groups, 'plugin plug')), ['plug:agent-x', 'plug']);
  assert.deepEqual(ids(R.filterComponents(CATALOG.groups, 'usage')), ['Stop:abc12345']);
  assert.equal(R.filterComponents(CATALOG.groups, 'zzz').length, 0);
  assert.equal(R.filterComponents(undefined, 'x').length, 0);
});

test('#/component lists every component grouped by kind, each row linking to its page', async () => {
  const env = await boot('#/component');
  const v = view(env);
  const headings = tree(v).filter((e) => e.tagName === 'h2').map((e) => e.textContent);
  assert.deepEqual(headings, ['Hooks (1)', 'MCP servers (1)', 'Agents (1)', 'Plugins (1)']);
  assert.match(v.textContent, /Imports usage into the local database/);
  const links = hrefs(v);
  for (const l of ['#/hook/Stop%3Aabc12345', '#/mcp/engram', '#/agent/plug%3Aagent-x', '#/plugin/plug']) assert.ok(links.includes(l), l);
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0, 'hostile description stays text');
  assert.ok(env.calls.some((c) => c.url === '/api/harness/components'));
});

test('the component filter narrows rows and says when nothing matches', async () => {
  const env = await boot('#/component');
  const box = tree(view(env)).find((e) => e.tagName === 'input');
  box.value = 'engram';
  for (const fn of box.listeners.input ?? []) fn({ target: box });
  assert.deepEqual(hrefs(view(env)).filter((h) => /^#\/(hook|mcp|agent|plugin)\//.test(h)), ['#/mcp/engram']);
  box.value = 'zzz';
  for (const fn of box.listeners.input ?? []) fn({ target: box });
  assert.match(view(env).textContent, /No component matches/);
});

test('the navigation links to the component catalog', async () => {
  const env = await boot('#/component');
  assert.ok(hrefs(env.document.getElementById('nav')).includes('#/component'));
});

const PAGE = (kind, summary, over = {}) => ({ kind, id: 'x', title: 'Stop: amauta usage', body_md: null, meta: [{ label: 'Event', value: 'Stop' }], links: [{ kind: 'plugin', id: 'plug', title: 'plug' }], backlinks: [], sections: [{ heading: 'Source of these facts', items: [{ label: '/home/u/.claude/settings.json', value: 'Your Claude home', kind: null, id: null }] }], missing: [], summary, ...over });

test('a hook page opens with What it does and When it runs, then the source', async () => {
  const sm = { description: 'Imports usage', trigger: null, when: 'When Claude finishes answering.', source: 'Your Claude home', path: '/home/u/.claude/settings.json', builtin: false, note: null };
  const env = await boot('#/hook/x', { '/api/wiki/page': PAGE('hook', sm) });
  const text = view(env).textContent;
  assert.ok(text.indexOf('What it does') >= 0 && text.indexOf('What it does') < text.indexOf('Source of these facts'), text);
  assert.match(text, /Imports usage/);
  assert.match(text, /When it runs/);
  assert.match(text, /When Claude finishes answering/);
  assert.match(text, /\/home\/u\/\.claude\/settings\.json/);
  assert.match(text, /Hook/);
});

test('a component page with no description shows the plain note', async () => {
  const sm = { description: null, trigger: null, when: null, source: 'Usage only', path: null, builtin: false, note: 'No curated summary for this command: read the command itself.' };
  const env = await boot('#/hook/x', { '/api/wiki/page': PAGE('hook', sm) });
  assert.match(view(env).textContent, /No curated summary for this command/);
});

const TOOL_SM = { description: 'Runs a shell command.', trigger: null, when: 'To run tests and builds.', source: 'Built into Claude Code', path: null, builtin: true, note: null, i18n: { es: { description: 'Ejecuta un comando de shell.', when: 'Para ejecutar pruebas y compilaciones.' } } };
const ES = { navigator: { language: 'es-ES' } };

test('a built-in tool page shows its own Spanish text when the language is Spanish and English otherwise', async () => {
  const es = await boot('#/tool/Bash', { '/api/wiki/page': PAGE('tool', TOOL_SM) }, ES);
  assert.match(view(es).textContent, /Ejecuta un comando de shell/);
  assert.match(view(es).textContent, /Para ejecutar pruebas y compilaciones/);
  assert.doesNotMatch(view(es).textContent, /Runs a shell command/);
  const en = await boot('#/tool/Bash', { '/api/wiki/page': PAGE('tool', TOOL_SM) });
  assert.match(view(en).textContent, /Runs a shell command/);
});

test('the catalog rows of built-in tools use the Spanish description too', async () => {
  const groups = [{ kind: 'tool', label: 'Built-in tools', items: [row('tool', 'Bash', { source: 'Built into Claude Code', description: 'Runs a shell command.', i18n: { es: { description: 'Ejecuta un comando de shell.' } } })] }];
  const es = await boot('#/component', { '/api/harness/components': { total: 1, pending: 0, groups } }, ES);
  assert.match(view(es).textContent, /Ejecuta un comando de shell/);
  assert.match(view(es).textContent, /Herramientas integradas \(1\)/);
});

test('the connector and MCP tool kinds open as wiki pages', async () => {
  for (const kind of ['connector', 'mcptool']) {
    const env = await boot(`#/${kind}/x`, { '/api/wiki/page': PAGE(kind, { description: 'Some text', trigger: null, when: null, source: 'Usage only', path: null, builtin: false, note: null }) });
    assert.match(view(env).textContent, /What it does/, kind);
  }
});
