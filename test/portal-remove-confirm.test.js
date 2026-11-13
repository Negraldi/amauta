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

// Re-critique T13 item 6: the confirm opens inside the row it concerns, never under the whole table, and focus never lands
// on <body>: Go back returns it to the Remove button, a removal moves it to Undo, Undo returns it to the restored row.
const rowOf = (view, text) => tree(view).find((e) => e.tagName === 'tr' && e.textContent.includes(text));

for (const [kind, label, yes, rowText] of [['sibling', 'Remove Data catalog', 'Remove sibling', 'Data catalog'],
  ['project path', 'Remove /home/u/beta', 'Remove path', '/home/u/beta']]) {
  test(`the ${kind} confirm sits in its row and Go back returns focus to Remove`, async () => {
    const { view, button, confirmBox } = await boot();
    button(label).click();
    await tick();
    const row = rowOf(view, rowText);
    assert.ok(row && tree(row).includes(confirmBox()), 'the confirm group is inside the row');
    button('Go back').click();
    await tick();
    assert.equal(confirmBox(), undefined);
    assert.equal(button(label).focused, true, 'focus is back on the Remove button');
  });

  test(`after a ${kind} removal focus moves to Undo, and after Undo to the restored row's Remove`, async () => {
    const { button } = await boot();
    button(label).click();
    await tick();
    button(yes).click();
    await tick();
    assert.equal(button('Undo').focused, true);
    button('Undo').click();
    await tick();
    assert.equal(button(label).focused, true);
  });
}
