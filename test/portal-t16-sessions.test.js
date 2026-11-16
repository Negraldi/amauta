// T16a: the Sessions list fits a 1280 px viewport without sideways scroll: long cells wrap or clip (full value in a title), numbers stay whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';
import { boot, tree, view } from './helpers/t15w3.js';

const css = async (f) => readFile(path.join(STATIC, f), 'utf8');
const rule = (src, selector) => { const m = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(src); return m ? m[1] : null; };
const LONG_PROJECT = 'a-very-long-project-name-that-never-breaks-for-anyone', LONG_TITLE = 'Refactor-the-portal-redesign-pipeline-and-then-some-more-words-here';
const S = (x) => ({ session_id: 'aaaaaaaa1', runtime: 'claude', project: LONG_PROJECT, model: 'claude-opus', models: 1, title: LONG_TITLE, messages: 1234, input: 123456789,
  output: 12345678, cache_read: 987654321, cache_write: 12345678, last_ts: '2026-11-10T08:00:00Z', first_ts: '2026-11-09T08:00:00Z', ...x });

test('the list keeps 8 columns, one title/project cell shape, and every long value carries its full text in a title', async () => {
  const env = await boot('#/session', { '/api/sessions': { available: true, projects: [], sessions: [S()] } });
  const all = tree(view(env));
  assert.equal(all.filter((e) => e.tagName === 'th').length, 8);
  assert.match(all.find((e) => e.tagName === 'table').className, /\btbl-sessions\b/);
  const tds = all.filter((e) => e.tagName === 'td');
  assert.match(tds[0].className, /\bsess-main\b/, 'the title cell wraps long words');
  const clip = tree(tds[1]).find((e) => /\bclip\b/.test(e.className));
  assert.ok(clip, 'the project is clipped');
  assert.equal(clip.attrs.title, LONG_PROJECT);
  assert.equal(clip.textContent, LONG_PROJECT);
  const a = tree(tds[0]).find((e) => e.tagName === 'a');
  assert.equal(a.attrs.title, LONG_TITLE);
  assert.ok(tree(tds[0]).some((e) => /\btok\b/.test(e.className) && tree(e).includes(a)), 'the link breaks anywhere');
});

test('CSS: the title cell is capped, the project clips with an ellipsis, the cells are tighter, the scroll box stays for narrower widths', async () => {
  const src = await css('style.css');
  assert.match(rule(src, '.tok') ?? '', /overflow-wrap:\s*anywhere/, 'the title link sits in a .tok');
  assert.match(rule(src, '.sess-main') ?? '', /max-inline-size:\s*\d+(\.\d+)?rem/);
  const clip = rule(src, '.clip') ?? '';
  assert.match(clip, /text-overflow:\s*ellipsis/);
  assert.match(clip, /max-inline-size:\s*\d+(\.\d+)?rem/);
  assert.match(clip, /overflow:\s*hidden/);
  assert.match(rule(src, '.tbl-sessions th, .tbl-sessions td, .tbl-psessions th, .tbl-psessions td') ?? '', /padding-inline:\s*var\(--s2\)/);
  assert.match(rule(src, '.scroll') ?? '', /overflow-x:\s*auto/);
});
