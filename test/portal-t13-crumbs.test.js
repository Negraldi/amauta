// T13 re-critique item 11: an item's crumb is its page title, never its id ("709" for a memory); the trail never names the
// open tab (Settings did, Memory did not).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const PAGE = { kind: 'memory', id: '709', title: 'Portal crumbs decision', body_md: 'x', meta: [], links: [], backlinks: [], sections: [], missing: [] };

test('a memory page crumb says its title, not its id', async () => {
  const env = makeEnv({ '/api/wiki/page': PAGE });
  env.location.hash = '#/memory/709';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const nav = tree(env.document.getElementById('view')).find((e) => e.tagName === 'nav' && e.className === 'crumbs');
  const items = tree(nav).filter((e) => e.tagName === 'li').map((e) => e.textContent);
  assert.equal(items.at(-1), 'Portal crumbs decision');
  assert.ok(!items.includes('709'), items.join(' / '));
});
