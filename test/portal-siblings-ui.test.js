// Sibling projects (plan S1d, ADR 0001): health cards on the Projects page and a form under Settings. A card names what
// needs attention with a mark (never color alone); a sibling's name and path are text, never markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const XSS = '<img src=x onerror=alert(1)>';
const SIBS = [{ name: 'Data catalog', path: '/home/u/catalog', mcp: 'oga-catalog', watch: 'cuts/ACTIVE', max_age_days: 35 }];
const HEALTH = { siblings: [
  { name: 'Data catalog', path: '/home/u/catalog', exists: true, state: 'attention',
    git: { date: '2026-11-01T10:00:00+00:00', subject: 'first cut tooling', dirty: 2 },
    mcp: { name: 'oga-catalog', claude: true, codex: false }, watch: { file: 'cuts/ACTIVE', state: 'stale', age_days: 50, max_age_days: 35 } },
  { name: XSS, path: '/home/u/gone', exists: false, state: 'missing' }] };
const PROJECTS = { auto_discover: true, config_repos: [], siblings: SIBS, projects: [
  { name: 'repo', path: '/home/u/repo', origin: ['flag'], odd: { features: 0, done: 0, total: 0, percent: 0 }, sessions: 1, memories: 0,
    graph: { mirrored: false, nodes: 0, edges: 0, synced_at: null, howto: 'x' } }] };

async function boot(hash) {
  const posts = [];
  const env = makeEnv({
    '/api/projects': PROJECTS, '/api/siblings': HEALTH, '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false },
    '/api/settings': { installed: true, current: { persona: 'gentleman', review_mode: 'off', telemetry: 'on',
      modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } }, allowed: {}, undo: { available: false } },
    '/api/projects/config': async (opts) => {
      const body = JSON.parse(opts.body);
      posts.push(body);
      return { ...PROJECTS, siblings: body.siblings ?? SIBS };
    },
  });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return { env, posts, view: env.document.getElementById('view') };
}

test('the Projects page shows each sibling\'s health and what needs attention', async () => {
  const { view } = await boot('#/project');
  const text = view.textContent;
  for (const needle of ['Sibling projects', 'Data catalog', 'first cut tooling', '2 uncommitted changes', 'oga-catalog',
    'cuts/ACTIVE', '50 days old', 'limit 35']) assert.ok(text.includes(needle), needle);
  const cards = tree(view).filter((e) => e.tagName === 'article' && e.attrs['data-state']);
  assert.deepEqual(cards.map((c) => c.attrs['data-state']), ['attention', 'missing']);
  assert.match(cards[0].textContent, /Claude ✓/);
  assert.match(cards[0].textContent, /Codex ✗/);
  assert.match(cards[1].textContent, /folder is missing/);
  assert.equal(tree(view).filter((e) => e.tagName === 'img').length, 0, 'names are text');
});

test('Settings adds and removes a sibling through the projects config', async () => {
  const { view, posts } = await boot('#/settings');
  const field = (id) => tree(view).find((e) => e.attrs?.id === id);
  field('sibling-name').value = 'ETL';
  field('sibling-path').value = '/home/u/etl';
  field('sibling-watch').value = 'out/last.csv';
  field('sibling-age').value = '7';
  tree(view).find((e) => e.tagName === 'button' && e.textContent === 'Add sibling').click();
  await tick();
  assert.deepEqual(posts[0], { siblings: [...SIBS, { name: 'ETL', path: '/home/u/etl', watch: 'out/last.csv', max_age_days: 7 }] });
  tree(view).find((e) => e.tagName === 'button' && e.attrs['aria-label'] === 'Remove Data catalog').click();
  await tick();
  assert.deepEqual(posts.at(-1).siblings.map((s) => s.name), ['ETL']);
});
