// T15 W3b group C (repeated explanation, class 14) and the session page / Today wording it touches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, page, tree, view, text, ES } from './helpers/t15w3.js';

process.env.TZ = 'UTC';

const SESSION = page('session', { id: 'b9600f26-aaaa', title: 'amauta · Fix the portal bug · 2026-10-23',
  meta: [{ label: 'Project', value: 'amauta', kind: 'project' }, { label: 'Started', value: '2026-10-23T08:00:00Z' }] });
test('A7: the session page heading is what the session was about, not its project and date again', async () => {
  const env = await boot('#/session/b9600f26', { '/api/wiki/page': SESSION });
  assert.equal(tree(view(env)).find((e) => e.tagName === 'h1').textContent, 'Fix the portal bug');
  assert.ok(tree(view(env)).some((e) => e.tagName === 'dt' && e.textContent === 'Started'));
});
test('A8: the project of a session is a link to its page', async () => {
  const env = await boot('#/session/b9600f26', { '/api/wiki/page': SESSION });
  const a = tree(view(env)).find((e) => e.tagName === 'a' && e.attrs.href === '#/project/amauta');
  assert.ok(a, 'a link to #/project/amauta');
});

const SETTINGS = { installed: true, current: { persona: 'gentleman', review_mode: 'off', telemetry: 'on', privacy: 'on', checks: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } }, allowed: {}, undo: { available: false } };
test('E9: "those hooks are removed" is said once for the three hook switches (es)', async () => {
  const env = await boot('#/settings', { '/api/settings': SETTINGS }, ES);
  assert.equal((text(env).match(/esos hooks se eliminan/g) || []).length, 0);
  assert.equal((text(env).match(/se elimina/g) || []).length, 1);
});
test('E9: the Appearance language control has one visible name', async () => {
  const env = await boot('#/settings?tab=appearance', { '/api/themes': { themes: [], tokens: [], max: 50 } }, ES);
  assert.equal(tree(view(env)).filter((e) => /^Idioma$/.test(e.textContent) && ['h2', 'label'].includes(e.tagName)).length, 1);
  assert.ok(tree(view(env)).find((e) => e.attrs.id === 'set-lang').attrs['aria-labelledby']);
});

test('A11: a project sessions tab has a short scope line and rows with the title and start date', async () => {
  const sessions = { available: true, projects: [], sessions: [{ session_id: 'aaaaaaaa1', runtime: 'claude', project: 'amauta', model: 'm', models: 1, messages: 1, input: 1, output: 1,
    cache_read: 0, cache_write: 0, first_ts: '2026-11-09T08:00:00Z', last_ts: '2026-11-10T08:00:00Z', title: 'Fix the portal' }] };
  const env = await boot('#/project/amauta?tab=sessions', { '/api/sessions': sessions, '/api/wiki/page': page('project', { id: 'amauta', title: 'amauta', meta: [], progress: null }) });
  const scope = tree(view(env)).find((e) => e.tagName === 'p' && /newest first/i.test(e.textContent));
  assert.ok(scope && scope.textContent.length < 130, scope && scope.textContent);
  assert.match(text(env), /Fix the portal/);
  assert.match(text(env), /started 2026-11-09/);
});

const FEED = (items) => ({ '/api/wiki/home': { activity: [{ day: '2026-11-14', items }], spending: { available: false }, health: { installed: false }, impact: null }, '/api/pipelines': { projects: [] } });
test('A7: a session row on Today puts a separator before its details', async () => {
  const item = { kind: 'session', id: 's1', title: 'amauta · Fix it', ts: '2026-11-14T10:00:00Z', started: '2026-11-13T08:00:00Z', what: '3 messages' };
  const env = await boot('#/', FEED([item]));
  const li = tree(view(env)).find((e) => e.tagName === 'li' && /Fix it/.test(e.textContent));
  assert.match(li.textContent, /Fix it · 3 messages/);
});

const LINTP = { window_days: 30, scanned: { memories: 3, capped: false }, categories: [
  { id: 'orphans', title: 'Orphan memories', note: 'Why: no links.', count: 2, truncated: false, items: [
    { kind: 'memory', id: '7', title: 'Same title', detail: null, project: 'amauta', updated: '2026-10-02T10:00:00Z' },
    { kind: 'memory', id: '8', title: 'Same title', detail: null, project: null, updated: '2026-10-03T10:00:00Z' }] },
  { id: 'unspaced', title: 'Notes saved without spaces', note: 'Because.', count: 0, truncated: false, items: [] }] };
test('B5: lint rows with the same title carry project, date and id; no project says so', async () => {
  const env = await boot('#/lint', { '/api/wiki/lint': LINTP });
  const rows = tree(view(env)).filter((e) => e.tagName === 'li' && /Same title/.test(e.textContent)).map((e) => e.textContent);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /amauta · 2026-10-02 · #7/);
  assert.match(rows[1], /no project · 2026-10-03 · #8/);
});
test('B12: long lint pages get an in-page index that moves focus to a section', async () => {
  const env = await boot('#/lint', { '/api/wiki/lint': LINTP });
  const nav = tree(view(env)).find((e) => e.tagName === 'nav' && /On this page/.test(e.attrs['aria-label'] || ''));
  assert.ok(nav, 'an index nav');
  const buttons = tree(nav).filter((e) => e.tagName === 'button');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Orphan memories (2)', 'Notes saved without spaces (0)']);
  const h2 = tree(view(env)).find((e) => e.tagName === 'h2' && /^Orphan memories/.test(e.textContent));
  assert.equal(h2.attrs.tabindex, '-1');
  buttons[0].click();
  assert.equal(h2.focused, true);
});

test('C7: the MCP sentence is the lead of the catalog group once; a server page links to the list instead', async () => {
  const lead = 'A Model Context Protocol server: the agent starts it.';
  const comps = { total: 2, pending: 0, groups: [{ kind: 'mcp', label: 'MCP servers', lead, items: [
    { kind: 'mcp', id: 'a', title: 'a', description: null, source: 'Your Claude home', uses: 0 }, { kind: 'mcp', id: 'b', title: 'b', description: null, source: 'Your Claude home', uses: 0 }] }] };
  const env = await boot('#/component', { '/api/harness/components': comps });
  assert.equal((text(env).match(/Model Context Protocol server/g) || []).length, 1);
  const pg = page('mcp', { id: 'a', title: 'a', summary: { description: null, when: null, generic: true, source: 'Your Claude home', path: null, trigger: null } });
  const one = await boot('#/mcp/a', { '/api/wiki/page': pg });
  assert.doesNotMatch(text(one), /Model Context Protocol/);
  assert.ok(tree(view(one)).some((e) => e.tagName === 'a' && e.attrs.href === '#/component?kind=mcp'));
});

const M = (reason) => ({ label: 'Error rate', suppressed: true, reason, exposed: { value: null, n: 2 }, baseline: { value: null, n: 3 }, delta: null });
const IMPACT = { available: true, note: 'N', days: 30, exposed_sessions: 2, control_sessions: 3, control_scope: 'same-project', min_sessions: 5, outcomes_recorded: true,
  metrics: { error_rate: M('fewer than 5 sessions'), retry_rate: M('fewer than 5 sessions'), tokens_per_turn: M('fewer than 5 sessions'), test_failure_rate: M('fewer than 5 sessions'),
    unused_after_load: { suppressed: true, reason: 'fewer than 5 sessions', n: 2 } },
  changes: { versions: [], commits: [], changes: [{ kind: 'installed', label: 'v2', when: '2026-10-01', before_sessions: 1, after_sessions: 1, suppressed: true, reason: 'fewer than 5 sessions' }] } };
test('D12: the "fewer than 5 sessions" caveat of a skill page is said once', async () => {
  const env = await boot('#/skill/x', { '/api/wiki/page': page('skill', { id: 'x', title: 'x', impact: IMPACT }) });
  assert.equal((text(env).match(/fewer than 5 sessions/g) || []).length, 1);
});
const HOOKP = page('hook', { id: 'Stop:abc', title: 'Stop · x', summary: { description: null, when: 'w', source: 'Your Claude home', path: '/h/settings.json', trigger: null, generic: false },
  sections: [{ heading: 'Configured in', items: [{ label: '/h/settings.json', value: 'Your Claude home' }] }] });
test('C10: a hook page names where it is configured once', async () => {
  const env = await boot('#/hook/Stop%3Aabc', { '/api/wiki/page': HOOKP });
  assert.equal((text(env).match(/\/h\/settings\.json/g) || []).length, 1);
});

const crumbItems = (env) => tree(tree(view(env)).find((e) => e.tagName === 'nav' && e.className === 'crumbs')).filter((e) => e.tagName === 'li').map((e) => e.textContent);
test('A14: a session page crumb goes Activity / Usage / Sessions, like the sidebar entry it sits under', async () => {
  const env = await boot('#/session/b9600f26', { '/api/wiki/page': page('session', { id: 'b9600f26-aaaa', title: 'p · x · 2026-10-01' }) });
  assert.deepEqual(crumbItems(env), ['Activity', 'Usage', 'Sessions', 'b9600f26']);
});
test('A14: a project page title follows one pattern whatever the project is called', async () => {
  for (const name of ['amauta', 'ortho-conv']) {
    const env = await boot(`#/project/${name}`, { '/api/wiki/page': page('project', { id: name, title: name, meta: [], progress: null }) });
    assert.equal(env.document.title, `Project ${name} - amauta`, name);
  }
});

test('B13: a memory store that is missing hides the search box and the type select', async () => {
  const env = await boot('#/memory?source=engram', { '/api/memories': { available: false, items: [], facets: { types: [] } } });
  assert.ok(!tree(view(env)).some((e) => e.tagName === 'select' || (e.tagName === 'input' && e.attrs.type !== 'checkbox')), 'no filters over nothing');
  assert.match(text(env), /engram/i);
});
test('B14: a memory without a project says so on its page', async () => {
  const env = await boot('#/memory/9', { '/api/wiki/page': page('memory', { id: '9', title: 'Loose', meta: [{ label: 'Type', value: 'note' }] }) });
  const dts = tree(view(env)).filter((e) => e.tagName === 'dt').map((e) => e.textContent);
  assert.ok(dts.includes('Project'), dts.join(','));
  assert.match(text(env), /Project\s*no project/);
});
test('B7: a memory file page lists its frontmatter keys as details', async () => {
  const pg = page('memfile', { id: '-a/memory/fm.md', title: 'fm.md', body_md: 'Body', meta: [{ label: 'Project', value: 'a' }, { label: 'Size', value: '120', fmt: 'number' }, { label: 'name', value: 'Feedback style' }] });
  const env = await boot('#/memfile/-a%2Fmemory%2Ffm.md', { '/api/wiki/page': pg });
  const dts = tree(view(env)).filter((e) => e.tagName === 'dt').map((e) => e.textContent);
  assert.deepEqual(dts, ['Project', 'Size', 'name']);
});

test('A15: Today says how fresh its data is, like Usage', async () => {
  const item = { kind: 'memory', id: '1', title: 'A', ts: '2026-11-14T10:00:00Z', what: '' };
  const env = await boot('#/', FEED([item, { ...item, id: '2', ts: '2026-11-14T12:30:00Z' }]));
  assert.match(text(env), /Data as of 2026-11-14 12:30; Refresh imports newer activity\./);
});

test('D7: a node page heading is its readable label with the internal id as small secondary text, once', async () => {
  const pg = page('node', { id: 'r::n1', title: 'Helper', meta: [{ label: 'Kind', value: 'code' }, { label: 'Node id', value: 'ref_node_fs' }] });
  const env = await boot('#/node/r%3A%3An1', { '/api/wiki/page': pg });
  assert.equal(tree(view(env)).find((e) => e.tagName === 'h1').textContent, 'Helper');
  const sub = tree(view(env)).find((e) => /\bh1-sub\b/.test(e.className));
  assert.ok(sub && sub.textContent.includes('ref_node_fs'));
  assert.equal((text(env).match(/ref_node_fs/g) || []).length, 1, 'the id is said once');
});
