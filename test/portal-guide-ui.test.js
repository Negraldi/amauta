// The guide (odd/tasks/portal-guide.md): a Guide tab in Harness, a list of pages, each rendered from Markdown with its
// diagrams, in the portal's language. Page text is text, never markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const INDEX = { lang: 'en', pages: [{ slug: 'overview', title: 'amauta at a glance' }, { slug: 'kernel', title: 'The kernel' }] };
const PAGE = (slug) => ({ slug, lang: 'en', title: slug === 'kernel' ? 'The kernel' : 'amauta at a glance',
  markdown: `# ${slug === 'kernel' ? 'The kernel' : 'amauta at a glance'}\n\n## What it is made of\n\nParts <img src=x onerror=alert(1)>.\n\n` +
    '```mermaid\nflowchart LR\n  A --> B\n```\n\nSee [[guide:kernel|the kernel]].\n' });

async function boot(hash) {
  const asked = [];
  const env = makeEnv({
    '/api/guide': INDEX, '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false },
    '/api/guide/page': async (opts, url) => {
      const q = new URL(url, 'http://x').searchParams;
      asked.push([q.get('slug'), q.get('lang')]);
      return PAGE(q.get('slug'));
    },
  });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return { env, asked, view: env.document.getElementById('view') };
}

test('Harness has a Guide tab that opens on the overview, with the list of pages', async () => {
  const { view, asked } = await boot('#/guide');
  const links = tree(view).filter((e) => e.tagName === 'a').map((e) => e.getAttribute('href'));
  assert.ok(links.includes('#/harness') && links.includes('#/guide'), 'a tab of Harness');
  assert.ok(links.includes('#/guide/kernel'), 'the list of pages');
  assert.deepEqual(asked[0], ['overview', 'en']);
  assert.match(view.textContent, /What it is made of/);
});

test('a page renders its Markdown, its diagrams and links to other pages; markup stays text', async () => {
  const { view, asked } = await boot('#/guide/kernel');
  assert.deepEqual(asked[0], ['kernel', 'en']);
  assert.ok(tree(view).some((e) => e.className === 'diagram scroll'), 'a diagram box');
  assert.equal(tree(view).filter((e) => e.tagName === 'img').length, 0);
  assert.ok(tree(view).some((e) => e.tagName === 'a' && e.getAttribute('href') === '#/guide/kernel'));
});
