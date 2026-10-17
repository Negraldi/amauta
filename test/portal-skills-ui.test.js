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

const item = (over) => ({ id: 'x', name: 'x', source: 'user', label: 'Your skills', description: null, trigger: null, path: null, uses: 0, sessions: 0, last_used: null, ...over });
const CATALOG = { total: 4, groups: [
  { source: 'installed', label: 'Installed by amauta', items: [item({ id: 'chained-pr', source: 'installed', description: 'Split oversized changes', trigger: 'PRs over 400 lines', uses: 1234, sessions: 3, last_used: '2026-10-02T10:05:00Z' })] },
  { source: 'plugin', label: 'Plugins', items: [item({ id: 'plug:pskill', source: 'plugin', description: XSS, uses: 0 })] },
  { source: 'builtin', label: 'Built into Claude Code', items: [item({ id: 'artifact-capabilities', source: 'builtin', uses: 2 }), item({ id: 'anthropic-skills:docs', source: 'builtin', uses: 1 })] },
] };

test('filterSkills matches name, description and trigger case-insensitively and drops empty groups', () => {
  const names = (g) => JSON.parse(JSON.stringify(g.flatMap((x) => x.items.map((i) => i.id))));
  assert.deepEqual(names(R.filterSkills(CATALOG.groups, '')), ['chained-pr', 'plug:pskill', 'artifact-capabilities', 'anthropic-skills:docs']);
  assert.deepEqual(names(R.filterSkills(CATALOG.groups, 'OVERSIZED')), ['chained-pr']);
  assert.deepEqual(names(R.filterSkills(CATALOG.groups, '400 lines')), ['chained-pr']);
  assert.deepEqual(names(R.filterSkills(CATALOG.groups, 'docs')), ['anthropic-skills:docs']);
  assert.equal(R.filterSkills(CATALOG.groups, 'zzz').length, 0);
  assert.equal(R.filterSkills(undefined, 'x').length, 0);
});

async function boot(hash, over = {}) {
  const env = makeEnv({ '/api/skills': CATALOG, '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false }, ...over });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}
const view = (env) => env.document.getElementById('view');
const hrefs = (el) => tree(el).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));

test('#/skill is a catalog grouped by source with description, trigger and usage, every row linking to its page', async () => {
  const env = await boot('#/skill');
  const v = view(env);
  const headings = tree(v).filter((e) => e.tagName === 'h2').map((e) => e.textContent);
  assert.deepEqual(headings, ['Installed by amauta (1)', 'Plugins (1)', 'Built into Claude Code (2)']);
  assert.match(v.textContent, /Split oversized changes/);
  assert.match(v.textContent, /PRs over 400 lines/);
  assert.match(v.textContent, /1,234 calls/);
  assert.match(v.textContent, /2026-10-02/);
  assert.doesNotMatch(v.textContent, /T10:05/);
  assert.match(v.textContent, /no local file/i);
  const links = hrefs(v);
  for (const id of ['chained-pr', 'plug%3Apskill', 'artifact-capabilities', 'anthropic-skills%3Adocs']) assert.ok(links.includes(`#/skill/${id}`), id);
  assert.equal(tree(v).filter((e) => e.tagName === 'img').length, 0, 'hostile description stays text');
  assert.ok(env.calls.some((c) => c.url === '/api/skills'));
});

test('the catalog filter narrows the rows as you type and says when nothing matches', async () => {
  const env = await boot('#/skill');
  const box = tree(view(env)).find((e) => e.tagName === 'input');
  assert.ok(box, 'a search box');
  box.value = 'capabilities';
  for (const fn of box.listeners.input ?? []) fn({ target: box });
  assert.deepEqual(hrefs(view(env)).filter((h) => h.startsWith('#/skill/')), ['#/skill/artifact-capabilities']);
  box.value = 'zzz';
  for (const fn of box.listeners.input ?? []) fn({ target: box });
  assert.match(view(env).textContent, /No skill matches/);
});

test('an empty catalog teaches where skills come from', async () => {
  const env = await boot('#/skill', { '/api/skills': { groups: [], total: 0 } });
  assert.match(view(env).textContent, /No skills found/);
});

const PAGE = (summary, body) => ({ kind: 'skill', id: 's', title: 's', body_md: body, meta: [{ label: 'Source', value: summary.source }], links: [], backlinks: [], sections: [], missing: [], usage: { daily: [], days: 30 }, summary });

test('a skill page opens with What it does before the SKILL.md body', async () => {
  const env = await boot('#/skill/s', { '/api/wiki/page': PAGE({ description: 'Plan commits', trigger: 'when committing', source: 'Installed by amauta', path: '/home/u/.claude/skills/s/SKILL.md', builtin: false, note: null }, 'Body text.\n') });
  const v = view(env);
  const text = v.textContent;
  assert.ok(text.indexOf('What it does') >= 0 && text.indexOf('What it does') < text.indexOf('Body text.'), text);
  assert.match(text, /Plan commits/);
  assert.match(text, /When it triggers/);
  assert.match(text, /when committing/);
  assert.match(text, /Installed by amauta/);
  assert.match(text, /\/home\/u\/\.claude\/skills\/s\/SKILL\.md/);
});

test('a built-in skill page shows the plain note instead of Installed: no', async () => {
  const note = 'Built into Claude Code (no local file); description unavailable locally.';
  const env = await boot('#/skill/s', { '/api/wiki/page': PAGE({ description: null, trigger: null, source: 'Built into Claude Code', path: null, builtin: true, note }, null) });
  const text = view(env).textContent;
  assert.match(text, /What it does/);
  assert.ok(text.includes(note));
  assert.doesNotMatch(text, /Installed/);
});
