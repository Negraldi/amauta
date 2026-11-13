// Harness wiki (portal redesign T6): one-line health, install facts, readable diagram, hooks table, one catalog, item pages, security.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

process.env.TZ = 'UTC';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const view = (env) => env.document.getElementById('view');
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));
const cls = (e) => e.getAttribute('class') || e.className || '';
const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const ctx = {};
vm.runInNewContext(await read('wikiroute.js'), ctx);
const R = ctx.AmautaRoute;
const plain = (x) => JSON.parse(JSON.stringify(x));

const HS = { installed: true, version: '0.3.0', rdd_mode: 'on', telemetry: false, managed_files: 3, persona: 'neutral', components: ['core', 'sdd'],
  hooks: [{ event: 'PreToolUse', kind: 'amauta', handlers: ['privacy'] }], mcp_servers: [] };
const comp = (kind, id, title, over = {}) => ({ kind, id, title, description: null, source: 'Your Claude home', uses: 0, ...over });
const HOOKS = [comp('hook', 'PreToolUse:aaaa1111', 'PreToolUse (Bash) · amauta'), comp('hook', 'PreToolUse:bbbb2222', 'PreToolUse (Edit|Write) · amauta'),
  comp('hook', 'Stop:cccc3333', 'Stop · review.sh', { source: 'Plugin plug', disabled: true })];
const COMPS = { total: 4, pending: 0, refresh: { servers: 1 }, groups: [{ kind: 'hook', label: 'Hooks', items: HOOKS },
  { kind: 'plugin', label: 'Plugins', items: [comp('plugin', 'plug', 'plug', { source: 'Plugin plug', disabled: true })] }] };
const SKILLS = { total: 2, groups: [{ source: 'installed', label: 'Installed by amauta', items: [{ id: 'chained-pr', description: 'Split PRs', uses: 3, sessions: 1, last_used: '2026-10-02T10:00:00Z' }] },
  { source: 'builtin', label: 'Built into Claude Code', items: [{ id: 'docs', uses: 0 }] }] };
const FLOW = 'flowchart LR\n  n0["A"]';

async function boot(hash, over = {}, extra = {}) {
  const env = makeEnv({ '/api/harness': HS, '/api/harness/components': COMPS, '/api/skills': SKILLS, '/api/archify': { installed: true, available: false, fallback: FLOW },
    '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false }, '/api/tools': { available: true, tools: [], skills: [], subagents: [], mcp_servers: [], mcp_tools: [] },
    '/api/overview': { available: false }, '/api/costs': { enabled: false, models: [] }, ...over });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  return env;
}

// ---- Overview -------------------------------------------------------------------------------------------------------
test('the overview leads with one health sentence computed from the install and the components', async () => {
  const env = await boot('#/harness');
  const lead = tree(view(env)).find((e) => e.tagName === 'p' && cls(e) === 'lead');
  assert.equal(lead.textContent, 'amauta 0.3.0 is installed; 4 components, 2 need attention (plugin disabled).');
  const ok = await boot('#/harness', { '/api/harness/components': { ...COMPS, groups: [{ kind: 'hook', label: 'Hooks', items: HOOKS.slice(0, 1) }], total: 1 } });
  assert.equal(tree(view(ok)).find((e) => cls(e) === 'lead').textContent, 'amauta 0.3.0 is installed; 1 component, nothing needs attention.');
  const bare = await boot('#/harness', { '/api/harness/components': { __status: 500, error: 'boom' } });
  assert.equal(tree(view(bare)).find((e) => cls(e) === 'lead').textContent, 'amauta 0.3.0 is installed.');
});

test('install facts are a compact definition list with status chips, never metric cards', async () => {
  const env = await boot('#/harness');
  const v = view(env);
  assert.ok(!tree(v).some((e) => /\bcard\b|\bgrid\b/.test(cls(e))), 'no hero-metric tiles');
  const dl = tree(v).find((e) => e.tagName === 'dl');
  assert.ok(dl, 'a definition list');
  const terms = tree(dl).filter((e) => e.tagName === 'dt').map((e) => e.textContent);
  for (const term of ['Version', 'Review mode', 'Telemetry']) assert.ok(terms.includes(term), term);
  const chips = tree(dl).filter((e) => /\bchip\b/.test(cls(e))).map((e) => e.textContent);
  assert.deepEqual(chips, ['● on', '○ off'], 'review on, telemetry off: shape plus text');
});

test('the architecture diagram sits behind Show architecture diagram in a focusable horizontal scroll region', async () => {
  const env = await boot('#/harness');
  const details = tree(view(env)).find((e) => e.tagName === 'details' && /arch/.test(cls(e)));
  assert.ok(details, 'a details block');
  assert.equal(details.children[0].tagName, 'summary');
  assert.equal(details.children[0].textContent, 'Show architecture diagram');
  const region = tree(details).find((e) => e.getAttribute('role') === 'region');
  assert.ok(region, 'a scroll region');
  assert.equal(region.getAttribute('tabindex'), '0');
  assert.ok(region.getAttribute('aria-label'));
  assert.ok(tree(region).some((e) => /diagram/.test(cls(e))));
  const css = (await read('style.css')) + (await read('style-pages.css'));
  assert.match(css, /\.arch-scroll \{[^}]*overflow-x: auto/);
  assert.match(css, /\.arch-scroll [^{]*svg \{[^}]*max-width: none/);
});

test('the hooks table names event, handler, source and status, so look-alike rows are told apart', async () => {
  const env = await boot('#/harness');
  const table = tree(view(env)).find((e) => e.tagName === 'table' && /PreToolUse/.test(e.textContent));
  assert.ok(table, 'a hooks table');
  const heads = tree(table).filter((e) => e.tagName === 'th').map((e) => e.textContent.replace(/ [▲▼]$/, ''));
  assert.deepEqual(heads, ['Event', 'Handler', 'Source', 'Status']);
  const rows = tree(table).filter((e) => e.tagName === 'tr').slice(1).map((r) => r.children.map((c) => c.textContent).join(' | '));
  assert.equal(new Set(rows).size, 3, 'every row is distinct');
  assert.ok(rows.some((r) => /PreToolUse \| amauta \(Bash\) \| Your Claude home \| ● runs/.test(r)), rows.join('\n'));
  assert.ok(rows.some((r) => /Stop \| review\.sh \| Plugin plug \| ○ plugin disabled/.test(r)), rows.join('\n'));
  assert.ok(hrefs(table).includes('#/hook/Stop%3Acccc3333'), 'the handler links to the hook page');
});

// ---- Catalog --------------------------------------------------------------------------------------------------------
test('the catalog route keeps every component kind in ?kind=, and items crumb through Catalog / <kind>', () => {
  for (const kind of ['skill', 'hook', 'mcp', 'mcptool', 'connector', 'tool', 'agent', 'command', 'plugin', 'outputstyle']) {
    assert.deepEqual(plain(R.parseHash(`#/component?kind=${kind}`)), { kind: 'component', id: '', query: { kind } }, kind);
  }
  assert.deepEqual(plain(R.parseHash('#/component?kind=nope')), { kind: 'component', id: '' });
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/hook/X'))), [{ key: 'nav.group.harnessWiki' }, { key: 'nav.catalog', hash: '#/component' },
    { key: 'catalog.kind.hook', hash: '#/component?kind=hook' }, { text: 'X' }]);
  assert.deepEqual(plain(R.crumbs(R.parseHash('#/mcp/engram')))[2], { key: 'catalog.kind.mcp', hash: '#/component?kind=mcp' });
  assert.equal(R.hubOf({ kind: 'mcp', id: 'engram' }), 'component');
  assert.equal(R.hubOf('mcp'), 'usage', 'the old #/mcp list still folds into Tools and skills');
});

test('#/component is one catalog titled Catalog, skills included, with kind links that carry counts', async () => {
  const env = await boot('#/component');
  const v = view(env);
  assert.equal(tree(v).find((e) => e.tagName === 'h1').textContent, 'Catalog');
  assert.equal(env.document.title, 'Catalog - amauta');
  const kinds = tree(v).find((e) => e.tagName === 'nav' && /segmented/.test(cls(e)));
  assert.ok(kinds, 'kind links');
  const links = tree(kinds).filter((e) => e.tagName === 'a');
  assert.deepEqual(links.map((a) => a.getAttribute('href')), ['#/component', '#/component?kind=skill', '#/component?kind=hook', '#/component?kind=plugin']);
  assert.deepEqual(links.map((a) => a.textContent), ['All (6)', 'Skills (2)', 'Hooks (3)', 'Plugins (1)']);
  assert.deepEqual(links.filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.textContent), ['All (6)']);
  assert.deepEqual(tree(v).filter((e) => e.tagName === 'h2').map((e) => e.textContent), ['Skills (2)', 'Hooks (3)', 'Plugins (1)']);
  for (const l of ['#/skill/chained-pr', '#/skill/docs', '#/hook/PreToolUse%3Aaaaa1111', '#/plugin/plug']) assert.ok(hrefs(v).includes(l), l);
});

test('?kind=skill shows only skills in the same catalog (no separate skill page)', async () => {
  const env = await boot('#/component?kind=skill');
  const v = view(env);
  assert.equal(tree(v).find((e) => e.tagName === 'h1').textContent, 'Catalog');
  assert.deepEqual(tree(v).filter((e) => e.tagName === 'h2').map((e) => e.textContent), ['Skills (2)']);
  const current = tree(v).filter((e) => e.tagName === 'a' && e.getAttribute('aria-current') === 'true').map((a) => a.textContent);
  assert.deepEqual(current, ['Skills (2)']);
  assert.match(v.textContent, /Split PRs/);
  assert.match(v.textContent, /Installed by amauta/);
});

test('the All view chunks a long kind to its first 8 items with a link to the rest; a text filter narrows every kind', async () => {
  const many = Array.from({ length: 12 }, (_, i) => comp('hook', `Stop:${String(i).padStart(8, '0')}`, `Stop · h${i}`));
  const env = await boot('#/component', { '/api/harness/components': { total: 12, pending: 0, refresh: { servers: 0 }, groups: [{ kind: 'hook', label: 'Hooks', items: many }] } });
  const v = view(env);
  assert.equal(hrefs(v).filter((h) => h.startsWith('#/hook/')).length, 8);
  const more = tree(v).find((e) => e.tagName === 'a' && /Show all/.test(e.textContent));
  assert.equal(more.getAttribute('href'), '#/component?kind=hook');
  assert.match(more.textContent, /12/);
  const box = tree(v).find((e) => e.tagName === 'input' && e.attrs.type === 'search');
  box.value = 'h11';
  for (const fn of box.listeners.input ?? []) fn({ target: box });
  assert.deepEqual(hrefs(view(env)).filter((h) => h.startsWith('#/hook/')), ['#/hook/Stop%3A00000011']);
});

test('Refresh descriptions is a secondary action below the list header, after the filters', async () => {
  const env = await boot('#/component');
  const all = tree(view(env));
  const at = (pred) => all.findIndex(pred);
  const refresh = at((e) => e.tagName === 'button' && /Refresh descriptions/.test(e.textContent));
  assert.ok(refresh > at((e) => e.tagName === 'input' && e.attrs.type === 'search'), 'after the filter box');
  assert.ok(refresh < at((e) => e.tagName === 'h2'), 'before the first group');
});

test('an empty catalog teaches where components and skills come from; a failed load shows the error panel with Retry', async () => {
  const env = await boot('#/component', { '/api/harness/components': { total: 0, pending: 0, groups: [] }, '/api/skills': { total: 0, groups: [] } });
  assert.match(view(env).textContent, /Components come from settings\.json/);
  assert.match(view(env).textContent, /Skills live in/);
  const bad = await boot('#/component', { '/api/harness/components': { __status: 500, error: 'boom' } });
  assert.ok(tree(view(bad)).some((e) => /error-panel/.test(cls(e))));
  assert.ok(tree(view(bad)).some((e) => e.tagName === 'button' && e.textContent === 'Retry'));
});

// ---- Item pages -----------------------------------------------------------------------------------------------------
const CMD = 'node /home/u/.amauta/runtime/node_modules/amauta/bin/amauta.js hook dispatch PreToolUse privacy,secret-scan,review-stop';
const PATH = '/home/u/.claude/settings.json';
const HOOK_PAGE = { kind: 'hook', id: 'PreToolUse:aaaa1111', title: 'PreToolUse (Bash) · amauta', body_md: null,
  meta: [{ label: 'Event', value: 'PreToolUse' }, { label: 'Command', value: CMD }], links: [], backlinks: [], missing: [],
  sections: [{ heading: 'Source of these facts', items: [{ label: PATH, value: 'Your Claude home', kind: null, id: null }] }],
  summary: { description: 'Guards prompts', trigger: null, when: 'Before a tool runs.', source: 'Your Claude home', path: PATH, builtin: false, note: null },
  explain: { pending: null, note: null } };

test('a hook page says where it comes from once, keeps the long command in the main column, and invites an explanation', async () => {
  const env = await boot('#/hook/PreToolUse%3Aaaaa1111', { '/api/wiki/page': HOOK_PAGE });
  const v = view(env);
  assert.ok(!tree(v).some((e) => e.tagName === 'h2' && /Source of these facts/.test(e.textContent)), 'one origin, not two');
  assert.equal(v.textContent.split(PATH).length - 1, 1, 'the path shows once');
  const rail = tree(v).find((e) => e.tagName === 'aside');
  assert.doesNotMatch(rail.textContent, /hook dispatch/, 'the command is not squeezed into the rail');
  const pre = tree(v).find((e) => e.tagName === 'pre' && e.textContent === CMD);
  assert.ok(pre, 'the command is a code block in the main column');
  assert.match(v.textContent, /No explanation written yet\. Request one and ask Claude Code to process the queue \(skill amauta-wiki-explain\)\./);
  const css = (await read('style.css')) + (await read('style-pages.css'));
  assert.match(css, /\.doc pre\.code \{[^}]*white-space: pre-wrap/, 'the command wraps instead of overflowing');
});

test('an item breadcrumb is Harness wiki / Catalog / <kind> / <item title>, the kind linking to the filtered catalog', async () => {
  const env = await boot('#/hook/PreToolUse%3Aaaaa1111', { '/api/wiki/page': HOOK_PAGE });
  const nav = tree(view(env)).find((e) => e.tagName === 'nav' && /crumbs/.test(cls(e)));
  assert.deepEqual(nav.children[0].children.map((li) => li.textContent), ['Harness wiki', 'Catalog', 'Hooks', 'PreToolUse (Bash) · amauta']);
  assert.deepEqual(hrefs(nav), ['#/component', '#/component?kind=hook']);
  assert.equal(env.document.title, 'PreToolUse (Bash) · amauta - amauta');
});

test('a skill page drops the rail Source row when What it does already names the source', async () => {
  const page = { kind: 'skill', id: 's', title: 's', body_md: null, meta: [{ label: 'Source', value: 'Installed by amauta' }, { label: 'Uses', value: 3 }], links: [], backlinks: [],
    sections: [], missing: [], summary: { description: 'Plan commits', trigger: null, source: 'Installed by amauta', path: null, builtin: false, note: null } };
  const env = await boot('#/skill/s', { '/api/wiki/page': page });
  const rail = tree(view(env)).find((e) => e.tagName === 'aside');
  assert.ok(!tree(rail).some((e) => e.tagName === 'dt' && e.textContent === 'Source'));
  assert.equal(view(env).textContent.split('Installed by amauta').length - 1, 1);
});

// ---- Security and titles --------------------------------------------------------------------------------------------
const SEC = { protections: { memory_guard: 'on', privacy: 'on', checks: 'off', installed: true },
  checkers: [{ name: 'node', installed: true, needs_trust: false }, { name: 'tsc', installed: false, needs_trust: true }],
  trusted: [], profiles: { names: ['default'], drafts: 0, selected: [] }, redacted: {} };

test('Security opens with one summary sentence and protection chips, then the tables use the same chip vocabulary', async () => {
  const env = await boot('#/security', { '/api/security': SEC });
  const v = view(env);
  const lead = tree(v).find((e) => e.tagName === 'p' && cls(e) === 'lead');
  assert.equal(lead.textContent, '2 of 3 protections are on; 1 of 2 checkers found.');
  const all = tree(v);
  assert.ok(all.indexOf(lead) < all.findIndex((e) => e.tagName === 'table'), 'the sentence comes before the tables');
  const chips = all.filter((e) => /\bchip\b/.test(cls(e))).map((e) => e.textContent);
  for (const c of ['● Memory guard: on', '● Privacy hook: on', '○ Checks: off', '● yes', '○ no']) assert.ok(chips.includes(c), `${c} in ${chips}`);
});

test('the browser tab title follows the page heading on every hub', async () => {
  for (const [hash, title] of [['#/tool', 'Tools and skills'], ['#/harness', 'Harness'], ['#/security', 'Security'], ['#/component?kind=hook', 'Catalog']]) {
    const env = await boot(hash, { '/api/security': SEC });
    assert.equal(env.document.title, `${title} - amauta`, hash);
  }
});

test('in Spanish the health sentence, catalog title and explanation invitation are translated', async () => {
  const ES = { navigator: { language: 'es-ES' } };
  const h = await boot('#/harness', {}, ES);
  assert.equal(tree(view(h)).find((e) => cls(e) === 'lead').textContent, 'amauta 0.3.0 está instalado; 4 componentes, 2 requieren atención (plugin desactivado).');
  const c = await boot('#/component', {}, ES);
  assert.equal(tree(view(c)).find((e) => e.tagName === 'h1').textContent, 'Catálogo');
  const p = await boot('#/hook/PreToolUse%3Aaaaa1111', { '/api/wiki/page': HOOK_PAGE }, ES);
  assert.match(view(p).textContent, /Todavía no hay explicación\./);
  const en = JSON.parse(await read('i18n/en.json')), es = JSON.parse(await read('i18n/es.json'));
  for (const k of Object.keys(en)) if (/^(catalog|harness|sec)\./.test(k)) assert.ok(k in es, `es has ${k}`);
});
