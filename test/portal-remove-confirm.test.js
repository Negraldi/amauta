// Critique P2 (T11 a): Remove in Settings > Projects and siblings asks first, names what is lost, and offers Undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const SIBS = [{ name: 'Data catalog', path: '/home/u/catalog', mcp: 'oga-catalog', watch: 'cuts/ACTIVE', max_age_days: 35 },
  { name: 'ETL', path: '/home/u/etl' }];
const PROJECTS = (body = {}) => ({ auto_discover: true, config_repos: body.repos ?? ['/home/u/beta'], siblings: body.siblings ?? SIBS, projects: [] });

async function boot() {
  const posts = [];
  const env = makeEnv({ '/api/projects': PROJECTS(), '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false },
    '/api/siblings': { siblings: [] }, '/api/overview': { available: false },
    '/api/settings': { installed: true, current: {}, allowed: {}, undo: { available: false } },
    '/api/projects/config': async (opts) => { const b = JSON.parse(opts.body); posts.push(b); return PROJECTS(b); } });
  env.location.hash = '#/settings?tab=projects';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const view = env.document.getElementById('view');
  const button = (label) => tree(view).find((e) => e.tagName === 'button' && (e.attrs['aria-label'] === label || e.textContent === label));
  const confirmBox = () => tree(view).find((e) => e.attrs.role === 'group' && /confirm/.test(e.className || ''));
  return { env, posts, view, button, confirmBox };
}

test('removing a sibling asks first and names the fields that are forgotten', async () => {
  const { posts, button, confirmBox } = await boot();
  button('Remove Data catalog').click();
  await tick();
  assert.deepEqual(posts, [], 'nothing is sent before the confirm');
  const box = confirmBox();
  assert.ok(box, 'a confirm group appears');
  for (const needle of ['Data catalog', 'oga-catalog', 'cuts/ACTIVE', '35', '/home/u/catalog', 'not touched']) assert.ok(box.textContent.includes(needle), needle);
  assert.ok(tree(box).some((e) => e.tagName === 'button' && e.className === 'primary' && e.textContent === 'Remove sibling'));
  button('Go back').click();
  await tick();
  assert.equal(confirmBox(), undefined, 'Go back closes it');
  assert.deepEqual(posts, []);
});

test('a confirmed sibling removal can be undone, back in its place', async () => {
  const { posts, button, view } = await boot();
  button('Remove Data catalog').click();
  await tick();
  button('Remove sibling').click();
  await tick();
  assert.deepEqual(posts.at(-1).siblings.map((s) => s.name), ['ETL']);
  assert.ok(tree(view).some((e) => e.attrs.role === 'status' && /Removed Data catalog/.test(e.textContent)));
  button('Undo').click();
  await tick();
  assert.deepEqual(posts.at(-1).siblings, SIBS, 'every field and the order come back');
});

test('a sibling without optional fields says only that its entry goes', async () => {
  const { button, confirmBox } = await boot();
  button('Remove ETL').click();
  await tick();
  assert.match(confirmBox().textContent, /ETL/);
  assert.doesNotMatch(confirmBox().textContent, /MCP server|watched/i);
});

test('removing a saved project path asks first and can be undone', async () => {
  const { posts, button, confirmBox } = await boot();
  button('Remove /home/u/beta').click();
  await tick();
  assert.deepEqual(posts, []);
  assert.match(confirmBox().textContent, /\/home\/u\/beta/);
  assert.match(confirmBox().textContent, /not touched/);
  button('Remove path').click();
  await tick();
  assert.deepEqual(posts.at(-1), { repos: [] });
  button('Undo').click();
  await tick();
  assert.deepEqual(posts.at(-1), { repos: ['/home/u/beta'] });
});
