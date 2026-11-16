// T17a: the guide has no contents column; a labelled page selector sits above the article, previous / next links below it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIC, readDicts } from './helpers/portalboot.js';
import { boot, tree, view, ES } from './helpers/t15w3.js';

const PAGES = ['overview', 'kernel', 'memory'].map((slug, i) => ({ slug, title: ['At a glance', 'The kernel', 'Memory'][i] }));
const routes = (slug) => ({ '/api/guide': { pages: PAGES }, '/api/guide/page': { slug, title: PAGES.find((p) => p.slug === slug).title, markdown: '# T\n\nBody text.' } });
const guide = (hash, slug, extra) => boot(hash, routes(slug), extra);
const find = (env, pred) => tree(view(env)).filter(pred);

test('the contents column is gone: no guide-nav, no two-column grid', async () => {
  const env = await guide('#/guide/kernel', 'kernel');
  assert.equal(find(env, (e) => /\bguide-nav\b/.test(e.className || '')).length, 0);
  assert.equal(find(env, (e) => e.className === 'guide').length, 0);
  const css = await readFile(path.join(STATIC, 'style-pages.css'), 'utf8');
  assert.doesNotMatch(css, /\.guide-nav|\.guide \{/);
  assert.match(css, /\.guide-page \{[^}]*max-inline-size: none/);
});

test('a labelled selector above the article lists "n. Title", marks the current page and says "n of m"', async () => {
  const env = await guide('#/guide/kernel', 'kernel');
  const sel = find(env, (e) => e.tagName === 'select')[0];
  assert.ok(sel, 'a select');
  const label = find(env, (e) => e.tagName === 'label' && e.getAttribute('for') === sel.getAttribute('id'))[0];
  assert.equal(label.textContent, 'Guide page');
  assert.deepEqual(sel.options.map((o) => [o.getAttribute('value'), o.textContent]),
    [['overview', '1. At a glance'], ['kernel', '2. The kernel'], ['memory', '3. Memory']]);
  assert.equal(sel.options.filter((o) => o.getAttribute('selected') !== undefined).map((o) => o.getAttribute('value')).join(), 'kernel');
  assert.match(view(env).textContent, /2 of 3/);
  const kids = tree(view(env));
  assert.ok(kids.indexOf(sel) < kids.findIndex((e) => e.tagName === 'article'), 'above the article');
});

test('changing the selector navigates to that page', async () => {
  const env = await guide('#/guide/kernel', 'kernel');
  const sel = find(env, (e) => e.tagName === 'select')[0];
  sel.listeners.change[0]({ target: { value: 'memory' } });
  assert.equal(env.location.hash, '#/guide/memory');
});

test('previous / next links sit below the article with a small label and the page title; the ends have one link', async () => {
  const env = await guide('#/guide/kernel', 'kernel');
  const nav = find(env, (e) => e.tagName === 'nav' && /guide-pager/.test(e.className || ''))[0];
  assert.equal(nav.getAttribute('aria-label'), 'Guide pages');
  const links = tree(nav).filter((e) => e.tagName === 'a');
  assert.deepEqual(links.map((a) => [a.getAttribute('href'), a.textContent]), [['#/guide/overview', 'PreviousAt a glance'], ['#/guide/memory', 'NextMemory']]);
  const kids = tree(view(env));
  assert.ok(kids.indexOf(nav) > kids.findIndex((e) => e.tagName === 'article'), 'below the article');
  const first = await guide('#/guide', 'overview');
  const only = find(first, (e) => e.tagName === 'nav' && /guide-pager/.test(e.className || ''))[0];
  assert.deepEqual(tree(only).filter((e) => e.tagName === 'a').map((a) => a.getAttribute('href')), ['#/guide/kernel']);
});

test('the strings are translated (usted) and the unused contents key is gone; both dictionaries keep the same keys', async () => {
  const d = await readDicts();
  assert.deepEqual(Object.keys(d.en).sort(), Object.keys(d.es).sort());
  assert.ok(!('guide.contents' in d.en) && !('guide.contents' in d.es));
  const es = await guide('#/guide/kernel', 'kernel', ES);
  assert.match(view(es).textContent, /2 de 3/);
  assert.match(view(es).textContent, /Anterior/);
  assert.equal(d.es['guide.pick'], 'Página de la guía');
  assert.equal(d.es['guide.position'], '{n} de {total}');
  assert.equal(d.es['guide.prev'], 'Anterior');
  assert.equal(d.es['guide.next'], 'Siguiente');
  assert.equal(d.es['guide.pager'], 'Páginas de la guía');
});
