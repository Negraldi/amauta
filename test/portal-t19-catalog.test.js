// T19e: the Catalog (#/component) filters by runtime (?runtime=claude|codex, a segmented control that keeps its state in the hash
// next to ?kind=), and the instruction blocks amauta writes to CLAUDE.md and AGENTS.md are a catalog kind of their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { boot, tree, view, text, ES } from './helpers/t15w3.js';
import { STATIC, readDicts } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const ctx = {};
vm.runInNewContext(await read('wikiroute.js'), ctx);
const R = ctx.AmautaRoute;
const plain = (x) => JSON.parse(JSON.stringify(x));
const { en: EN, es: ES_DICT } = await readDicts();
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));
const navs = (env) => tree(view(env)).filter((e) => e.tagName === 'nav' && /segmented/.test(e.getAttribute('class') || e.className || ''));
const links = (nav) => tree(nav).filter((e) => e.tagName === 'a');
const item = (kind, id, runtimes, over = {}) => ({ kind, id, title: id, description: `About ${id}`, source: 'Your Claude home', uses: 0, ...(runtimes ? { runtimes } : {}), ...over });
const COMPS = { total: 5, pending: 0, refresh: { servers: 0 }, groups: [
  { kind: 'hook', label: 'Hooks', items: [item('hook', 'claude-hook', ['claude']), item('hook', 'codex-hook', ['codex']), item('hook', 'both-hook', ['claude', 'codex'])] },
  { kind: 'agent', label: 'Agents', items: [item('agent', 'an-agent', ['claude']), item('agent', 'old-agent', null)] }] };
const SKILLS = { total: 1, groups: [{ source: 'x', label: 'Your Codex skills', items: [{ id: 'cx-skill', description: 'Codex skill', uses: 0, runtimes: ['codex'] }] }] };
const ROUTES = { '/api/harness/components': COMPS, '/api/skills': SKILLS };
const ids = (env) => hrefs(view(env)).filter((h) => /^#\/(hook|agent|skill)\//.test(h)).map((h) => h.split('/')[2]);

// ---- runtime filter ----
test('T19e: the route keeps ?runtime= (claude or codex) next to ?kind=, and drops anything else', () => {
  assert.deepEqual(plain(R.parseHash('#/component?runtime=codex')), { kind: 'component', id: '', query: { runtime: 'codex' } });
  assert.deepEqual(plain(R.parseHash('#/component?kind=hook&runtime=claude')), { kind: 'component', id: '', query: { kind: 'hook', runtime: 'claude' } });
  assert.deepEqual(plain(R.parseHash('#/component?runtime=nope')), { kind: 'component', id: '' });
  assert.equal(R.routeHash({ kind: 'component', id: '', query: { runtime: 'codex', kind: 'hook' } }), '#/component?kind=hook&runtime=codex');
});

test('T19e: the Catalog has a Runtime segmented control (All, Claude Code, Codex) that keeps the kind in each link', async () => {
  const env = await boot('#/component?kind=hook', ROUTES);
  const nav = navs(env).find((n) => n.getAttribute('aria-label') === 'Runtime');
  assert.ok(nav, 'a segmented control named Runtime');
  assert.deepEqual(links(nav).map((a) => a.textContent), ['All', 'Claude Code', 'Codex']);
  assert.deepEqual(links(nav).map((a) => a.getAttribute('href')), ['#/component?kind=hook', '#/component?kind=hook&runtime=claude', '#/component?kind=hook&runtime=codex']);
  assert.deepEqual(links(nav).filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.textContent), ['All']);
});

test('T19e: Codex keeps what applies to Codex, an entry for both runtimes shows under either, and the kind counts follow the filter', async () => {
  const codex = await boot('#/component?runtime=codex', ROUTES);
  assert.deepEqual(ids(codex).sort(), ['both-hook', 'codex-hook', 'cx-skill']);
  const kinds = navs(codex).find((n) => n.getAttribute('aria-label') === 'Component kinds');
  assert.deepEqual(links(kinds).map((a) => a.textContent), ['All (3)', 'Skills (1)', 'Hooks (2)', 'Agents (0)']);
  assert.deepEqual(links(kinds).map((a) => a.getAttribute('href')), ['#/component?runtime=codex', '#/component?kind=skill&runtime=codex',
    '#/component?kind=hook&runtime=codex', '#/component?kind=agent&runtime=codex']);
  const rt = navs(codex).find((n) => n.getAttribute('aria-label') === 'Runtime');
  assert.deepEqual(links(rt).filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.textContent), ['Codex']);
  const claude = await boot('#/component?runtime=claude', ROUTES);
  assert.deepEqual(ids(claude).sort(), ['an-agent', 'both-hook', 'claude-hook', 'old-agent'], 'an entry without runtimes counts as Claude Code');
  assert.equal(ids(await boot('#/component', ROUTES)).length, 6, 'no filter lists everything');
});

test('T19e: an empty kind under a runtime says no component of that kind applies to it', async () => {
  const env = await boot('#/component?kind=agent&runtime=codex', ROUTES);
  assert.match(text(env), /No component of this kind applies to Codex\./);
  assert.deepEqual(ids(env), []);
  const es = await boot('#/component?kind=agent&runtime=codex', ROUTES, ES);
  assert.match(text(es), /Ningún componente de este tipo se aplica a Codex\./);
});

test('T19e: the Spanish control reads Todos, Claude Code, Codex', async () => {
  const env = await boot('#/component', ROUTES, ES);
  const nav = navs(env).find((n) => n.getAttribute('aria-label') === 'Entorno');
  assert.deepEqual(links(nav).map((a) => a.textContent), ['Todos', 'Claude Code', 'Codex']);
});

test('T19e: the runtime strings exist in both languages', () => {
  for (const key of ['catalog.runtimes', 'catalog.runtimeAll', 'catalog.noRuntimeKind', 'catalog.noRuntime']) {
    assert.ok(EN[key] && ES_DICT[key], key);
  }
  assert.doesNotMatch(ES_DICT['catalog.noRuntimeKind'], /—/);
});

// ---- instruction blocks as a catalog kind ----
const BLOCKS = { kind: 'instructions', label: 'Instruction blocks', items: [
  item('instructions', 'persona', ['claude'], { description: 'Persona text, no heading.' }),
  item('instructions', 'codegraph-guidance', ['claude', 'codex'], { description: 'Use CodeGraph first.' })] };
const WITH_BLOCKS = { ...COMPS, total: 7, groups: [...COMPS.groups, BLOCKS],
  runtimes: { claude: { found: true, home: '/h/.claude', installed: true, blocks: ['codegraph-guidance', 'persona'], hooks: 1, mcp_servers: 0, skills: 0 },
    codex: { found: true, home: '/h/.codex', installed: true, blocks: ['codegraph-guidance'], hooks: 0, mcp_servers: 0, skills: 0 } } };
const BLOCK_PAGE = { kind: 'instructions', id: 'codegraph-guidance', title: 'codegraph-guidance', body_md: '## CodeGraph\n\nUse CodeGraph first.', links: [], backlinks: [], missing: [],
  meta: [{ label: 'Size in CLAUDE.md (characters)', value: '36', fmt: 'number' }, { label: 'Runtime', value: 'Claude Code, Codex' }],
  sections: [{ heading: 'Configured in', items: [{ label: '/h/.claude/CLAUDE.md', value: 'Your Claude home', kind: null, id: null }] }],
  summary: { description: 'Use CodeGraph first.', trigger: null, when: 'At the start of every session.', source: 'Your Claude home', path: '/h/.claude/CLAUDE.md', builtin: false, note: null } };

test('T19e: instructions is a route kind whose items crumb through Catalog / Instruction blocks', () => {
  assert.deepEqual(plain(R.parseHash('#/instructions/persona')), { kind: 'instructions', id: 'persona' });
  assert.deepEqual(plain(R.parseHash('#/component?kind=instructions')), { kind: 'component', id: '', query: { kind: 'instructions' } });
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/instructions/persona'))), [{ key: 'nav.group.harnessWiki' }, { key: 'nav.catalog', hash: '#/component' },
    { key: 'catalog.kind.instructions', hash: '#/component?kind=instructions' }, { text: 'persona' }]);
  assert.equal(R.hubOf({ kind: 'instructions', id: 'persona' }), 'component');
  assert.equal(R.KINDS.instructions, 'Instruction blocks');
});

test('T19e: the Catalog lists the blocks as a kind, each linked to its page with its runtimes', async () => {
  const env = await boot('#/component', { '/api/harness/components': WITH_BLOCKS, '/api/skills': { total: 0, groups: [] } });
  const kinds = navs(env).find((n) => n.getAttribute('aria-label') === 'Component kinds');
  assert.ok(links(kinds).some((a) => a.textContent === 'Instruction blocks (2)' && a.getAttribute('href') === '#/component?kind=instructions'));
  assert.ok(hrefs(view(env)).includes('#/instructions/codegraph-guidance'));
  assert.match(text(env), /codegraph-guidance[^]*Runtime: Claude Code, Codex/);
  const codex = await boot('#/component?kind=instructions&runtime=codex', { '/api/harness/components': WITH_BLOCKS, '/api/skills': { total: 0, groups: [] } });
  assert.deepEqual(hrefs(view(codex)).filter((h) => h.startsWith('#/instructions/')), ['#/instructions/codegraph-guidance']);
});

test('T19e: a block page shows what it is for, its files and size, runtimes and the block text', async () => {
  const env = await boot('#/instructions/codegraph-guidance', { '/api/wiki/page': BLOCK_PAGE });
  const t = text(env);
  assert.match(t, /Use CodeGraph first\./);
  assert.match(t, /\/h\/\.claude\/CLAUDE\.md/);
  assert.match(t, /Size in CLAUDE\.md \(characters\)/);
  assert.match(t, /Runtime/);
  const es = await boot('#/instructions/codegraph-guidance', { '/api/wiki/page': BLOCK_PAGE }, ES);
  assert.match(text(es), /Bloques de instrucciones[^]*Tamaño en CLAUDE\.md \(caracteres\)/);
});

test('T19e: an unknown block says so in the portal words', async () => {
  const env = await boot('#/instructions/nope', { '/api/wiki/page': { __status: 404, error: 'not found' } });
  assert.match(text(env), /Instruction block not found/);
  assert.match(text(await boot('#/instructions/nope', { '/api/wiki/page': { __status: 404, error: 'not found' } }, ES)), /Bloque de instrucciones no encontrado/);
});

test('T19e: the Overview runtimes table links each block to its page', async () => {
  const env = await boot('#/harness', { '/api/harness': { installed: true, version: '1', rdd_mode: 'on', telemetry: false, managed_files: 1, persona: 'neutral', components: [], hooks: [], mcp_servers: [] },
    '/api/harness/components': WITH_BLOCKS, '/api/archify': { installed: false } });
  const block = hrefs(view(env)).filter((h) => h.startsWith('#/instructions/'));
  assert.deepEqual(block.sort(), ['#/instructions/codegraph-guidance', '#/instructions/codegraph-guidance', '#/instructions/persona']);
});

test('T19e: the strings of the new kind exist in both languages', () => {
  for (const key of ['kind.instructions', 'palette.group.instructions', 'hint.instructions', 'catalog.kind.instructions', 'notfound.instructions']) {
    assert.ok(EN[key] && ES_DICT[key], key);
  }
});
