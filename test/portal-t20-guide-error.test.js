// T20b: a guide page that fails to load keeps its own title (from the guide's page list) in the h1 and the document title;
// when the list is unknown too, or the page is not in it, the generic title stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, tree, view } from './helpers/t15w3.js';

const HTTP500 = { __status: 500, error: 'boom' };
const PAGES = { pages: [{ slug: 'overview', title: 'At a glance' }, { slug: 'portal', title: 'The portal' }] };
const h1 = (env) => tree(view(env)).filter((e) => e.tagName === 'h1');
const retry = (env) => tree(view(env)).filter((e) => e.tagName === 'button' && /^Retry$/.test(e.textContent));

test('T20b: a failed guide page keeps its own title, with Retry', async () => {
  const env = await boot('#/guide/portal', { '/api/guide': PAGES, '/api/guide/page': HTTP500 });
  assert.equal(h1(env).length, 1);
  assert.equal(h1(env)[0].textContent, 'The portal');
  assert.equal(env.document.title, 'The portal - amauta');
  assert.equal(retry(env).length >= 1, true);
});
test('T20b: a page the guide does not list keeps the generic title', async () => {
  const env = await boot('#/guide/nope', { '/api/guide': PAGES, '/api/guide/page': HTTP500 });
  assert.equal(h1(env)[0].textContent, 'Guide');
  assert.equal(env.document.title, 'Guide - amauta');
});
test('T20b: when the page list failed too, the title stays generic', async () => {
  const env = await boot('#/guide/portal', { '/api/guide': HTTP500, '/api/guide/page': HTTP500 });
  assert.equal(h1(env)[0].textContent, 'Guide');
});
