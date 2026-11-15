// T20c: under the Codex filter the Catalog says where the Codex tools come from (recorded use, not an official list) and, when
// no Codex tool was recorded, says so in a sentence instead of leaving the list silently empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, tree, view, text, ES } from './helpers/t15w3.js';
import { readDicts } from './helpers/portalboot.js';

const { en: EN, es: ES_DICT } = await readDicts();
const tool = (id, runtimes, over = {}) => ({ kind: 'tool', id, title: id, description: `About ${id}`, source: 'Seen in recorded Codex sessions', uses: 1, runtimes, ...over });
const comps = (tools, n) => ({ total: tools.length, pending: 0, refresh: { servers: 0 }, runtimes: { claude: { found: true }, codex: { found: true, tools: n } },
  groups: [{ kind: 'tool', label: 'Built-in tools', items: tools }] });
const SKILLS = { total: 0, groups: [] };
const LIST = [tool('Bash', ['claude'], { source: 'Built into Claude Code' }), tool('exec', ['codex']), tool('clock.sleep', ['codex'])];
const open = (hash, c, extra) => boot(hash, { '/api/harness/components': c, '/api/skills': SKILLS }, extra);
const hrefs = (env) => tree(view(env)).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));

test('T20c: the Codex filter lists the recorded Codex tools, links each to its page and says they are not an official list', async () => {
  const env = await open('#/component?runtime=codex', comps(LIST, 2));
  assert.deepEqual(hrefs(env).filter((h) => h.startsWith('#/tool/')), ['#/tool/exec', '#/tool/clock.sleep']);
  assert.match(text(env), /2 Codex tools are listed\. They were found in recorded Codex sessions on this machine[^]*not official/);
  assert.match(text(env), /2 of 3 things in your harness apply to Codex/, 'the intro counts what is listed');
});
test('T20c: one Codex tool reads in the singular', async () => {
  const env = await open('#/component?runtime=codex', comps([LIST[0], LIST[1]], 1));
  assert.match(text(env), /1 Codex tool is listed\. It was found in recorded Codex sessions/);
});
test('T20c: with no recorded Codex tool the Catalog says so', async () => {
  const env = await open('#/component?runtime=codex', comps([LIST[0]], 0));
  assert.match(text(env), /No Codex tool calls are recorded on this machine yet, so no Codex tools are listed\./);
  const kind = await open('#/component?kind=tool&runtime=codex', comps([LIST[0]], 0));
  assert.match(text(kind), /No Codex tool calls are recorded/);
});
test('T20c: the note is only for the Codex filter and only when the server counted', async () => {
  for (const [hash, c] of [['#/component', comps(LIST, 2)], ['#/component?runtime=claude', comps(LIST, 2)],
    ['#/component?runtime=codex', { ...comps(LIST, 2), runtimes: { codex: { found: true } } }]]) {
    assert.doesNotMatch(text(await open(hash, c)), /recorded Codex sessions on this machine|No Codex tool calls/, hash);
  }
  const hook = { kind: 'hook', label: 'Hooks', items: [{ kind: 'hook', id: 'h', title: 'h', description: '', source: 'x', uses: 0, runtimes: ['codex'] }] };
  const other = await open('#/component?kind=hook&runtime=codex', { ...comps(LIST, 2), groups: [hook] });
  assert.doesNotMatch(text(other), /recorded Codex sessions on this machine/, 'another kind does not carry the note');
});
test('T20c: the notes are in Spanish, in the formal register', async () => {
  const es = await open('#/component?runtime=codex', comps(LIST, 2), ES);
  assert.match(text(es), /2 herramientas de Codex/);
  const none = await open('#/component?runtime=codex', comps([LIST[0]], 0), ES);
  assert.match(text(none), /Aún no hay llamadas a herramientas de Codex registradas en este equipo/);
  for (const key of ['catalog.codexTools.one', 'catalog.codexTools.other', 'catalog.codexToolsNone']) assert.ok(EN[key] && ES_DICT[key], key);
  assert.doesNotMatch(ES_DICT['catalog.codexTools.other'] + ES_DICT['catalog.codexToolsNone'], /\b(vos|tenés|podés)\b/);
});
