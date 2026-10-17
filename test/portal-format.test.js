import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal, STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const ctx = {};
vm.runInNewContext(await read('wikiroute.js'), ctx);
const R = ctx.AmautaRoute;
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const cls = (e) => e.className || e.attrs.class || '';
const css = await read('style.css');
const rule = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(' ');
};

test('fmtNumber groups thousands with Intl and survives bad input', () => {
  assert.equal(R.fmtNumber(319906), '319,906');
  assert.equal(R.fmtNumber('1234567'), '1,234,567');
  assert.equal(R.fmtNumber(0), '0');
  assert.equal(R.fmtNumber(-1500.5), '-1,500.5');
  for (const bad of [null, undefined, '', 'abc', NaN, Infinity, true, {}]) assert.equal(R.fmtNumber(bad), '-', String(bad));
  R.setLocale('de-DE');
  try { assert.equal(R.fmtNumber(1234567), '1.234.567'); } finally { R.setLocale('en-US'); }
  R.setLocale('not a locale!!');
  assert.equal(R.fmtNumber(1234), '1,234', 'an invalid locale keeps the previous one');
});

test('dates are always YYYY-MM-DD and date-times YYYY-MM-DD HH:MM in local time (24h)', () => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    assert.equal(R.fmtDateTime('2026-09-20T01:44:09.739Z'), '2026-09-20 01:44');
    assert.equal(R.fmtDate('2026-09-20T01:44:09.739Z'), '2026-09-20');
    process.env.TZ = 'America/Lima'; // UTC-5, no DST
    assert.equal(R.fmtDateTime('2026-09-20T01:44:09.739Z'), '2026-09-19 20:44');
    assert.equal(R.fmtDate('2026-09-20T01:44:09.739Z'), '2026-09-19');
    assert.equal(R.fmtDateTime('2026-10-01T23:05:00Z'), '2026-10-01 18:05');
    assert.equal(R.fmtDateTime('2026-10-02T04:30:00Z'), '2026-10-01 23:30'); // 24h clock, never AM/PM
    assert.equal(R.fmtDate('2026-09-20'), '2026-09-20', 'a plain date is a calendar date: never shifted by the time zone');
    assert.equal(R.fmtDateTime('2026-09-20'), '2026-09-20');
    assert.equal(R.fmtDateTime(Date.UTC(2026, 0, 2, 12, 0)), '2026-01-02 07:00');
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
  for (const bad of [null, undefined, '', 'yesterday', '2026-13-45', NaN, {}]) {
    assert.equal(R.fmtDate(bad), '-', String(bad));
    assert.equal(R.fmtDateTime(bad), '-', String(bad));
  }
});

test('fmtIso only rewrites whole ISO values and leaves every other string alone', () => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    assert.equal(R.fmtIso('2026-09-20T01:44:09.739Z'), '2026-09-20 01:44');
    assert.equal(R.fmtIso('2026-09-20 01:44:09'), '2026-09-20 01:44');
    assert.equal(R.fmtIso('2026-09-20'), '2026-09-20');
    for (const keep of ['hello', '319906', 'rev 2026-09-20T01:44:09Z', '1.2', '', '2026-09-20T99:99:99Z']) assert.equal(R.fmtIso(keep), keep, keep);
    assert.equal(R.fmtIso(42), 42);
    assert.equal(R.fmtIso(null), null);
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
});

test('fmtMeta formats by the server hint: numbers grouped, ISO values as dates, everything else verbatim', () => {
  assert.equal(R.fmtMeta({ label: 'Calls', value: '319906', fmt: 'number' }), '319,906');
  assert.equal(R.fmtMeta({ label: 'Node id', value: '319906' }), '319906', 'only a number hint groups digits');
  assert.equal(R.fmtMeta({ label: 'Last used', value: '2026-09-20' }), '2026-09-20');
  assert.equal(R.fmtMeta({ label: 'x', value: 'plain text' }), 'plain text');
});

test('isLongToken marks only a single unbroken run of characters (paths, ids, hashes)', () => {
  assert.equal(R.isLongToken('/home/negraldi/.claude/skills/work-unit-commits/SKILL.md'), true);
  assert.equal(R.isLongToken('a'.repeat(40)), true);
  assert.equal(R.isLongToken('Plan commits as reviewable work units'), false);
  assert.equal(R.isLongToken('short'), false);
  assert.equal(R.isLongToken(''), false);
  assert.equal(R.isLongToken(null), false);
});

test('CSS: the rail definition list can never squeeze a value to one character per line', () => {
  const meta = rule('.meta');
  assert.match(meta, /grid-template-columns:\s*minmax\(\s*[\d.]+rem\s*,\s*[\d.]+(rem|%)\s*\)\s+minmax\(\s*0\s*,\s*1fr\s*\)/, meta);
  assert.doesNotMatch(meta, /max-content/);
  const dd = rule('.meta dd');
  assert.doesNotMatch(dd, /overflow-wrap:\s*anywhere/);
  assert.match(dd, /min-width:\s*0/);
  assert.match(rule('.tok'), /overflow-wrap:\s*anywhere/);
  assert.match(rule('.rail'), /min-width:\s*0/);
});

test('CSS: no page-wide overflow-wrap:anywhere (it collapses table columns and grid tracks to one character)', () => {
  assert.doesNotMatch(rule('#view'), /overflow-wrap:\s*anywhere/);
  assert.match(rule('#view'), /overflow-wrap:\s*break-word/);
  const anywhere = [...css.matchAll(/([^{}]+)\{[^}]*overflow-wrap:\s*anywhere[^}]*\}/g)].map((m) => m[1].trim());
  assert.deepEqual(anywhere, ['.tok'], 'only explicit long-token spans may break anywhere');
  assert.match(rule('table'), /width:\s*100%/);
  assert.match(rule('td.n'), /white-space:\s*nowrap/, 'numeric cells never wrap');
});

// ---- the helpers are used by the pages -------------------------------------------------------------------------
const PAGE = {
  kind: 'skill', id: 'artifact-capabilities', title: 'artifact-capabilities', body_md: null,
  meta: [
    { label: 'Calls', value: '319906', fmt: 'number' }, { label: 'First used', value: '2026-09-20T01:44:09.739Z' },
    { label: 'Path', value: '/home/negraldi/.claude/skills/artifact-capabilities/SKILL.md' }, { label: 'Description', value: 'Plan commits as reviewable work units' },
  ],
  links: [], backlinks: [], sections: [{ heading: 'Tokens', items: [{ label: 'Input', value: '1234567', fmt: 'number', kind: null, id: null }, { label: 'Seen', value: '2026-09-20T01:44:09.739Z', kind: null, id: null }] }],
  missing: [], usage: { daily: [], days: 30 },
};
async function boot(hash, routes) {
  process.env.TZ = 'UTC';
  const env = makeEnv({ '/api/wiki/recent': { items: [{ kind: 'memory', id: '7', title: 'm', ts: '2026-10-02T10:05:00.000Z', what: 'memory saved' }] }, '/api/sessions': { available: false }, ...routes });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return env;
}

test('a wiki page shows grouped numbers and readable dates in its rail and sections, never raw ISO or bare digits', async () => {
  const env = await boot('#/skill/artifact-capabilities', { '/api/wiki/page': PAGE });
  const v = env.document.getElementById('view').textContent;
  assert.match(v, /319,906/);
  assert.match(v, /1,234,567/);
  assert.match(v, /2026-09-20 01:44/);
  assert.doesNotMatch(v, /319906|1234567|T01:44|\.739Z/);
  const dds = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'dd');
  const path = dds.find((d) => /SKILL\.md/.test(d.textContent));
  assert.ok(tree(path).some((e) => /\bpath\b/.test(cls(e))), 'a path breaks only at slashes (see portal-polish.test.js)');
  assert.doesNotMatch(cls(path), /\btok\b/);
  assert.doesNotMatch(cls(dds.find((d) => /Plan commits/.test(d.textContent))), /\btok\b/, 'prose wraps at spaces');
});

test('recent changes show a local YYYY-MM-DD HH:MM stamp', async () => {
  const env = await boot('#/skill/artifact-capabilities', { '/api/wiki/page': PAGE });
  const recent = env.document.getElementById('recent').textContent;
  assert.match(recent, /2026-10-02 10:05/);
  assert.doesNotMatch(recent, /T10:05|\.000Z/);
});

test('tables format numbers with grouping and date columns as dates', async () => {
  const env = await boot('#/session', {
    '/api/sessions': { available: true, projects: [], sessions: [{ session_id: 'abcdef123456', project: 'p', first_ts: '2026-10-01T00:00:00Z', last_ts: '2026-10-02T09:30:00.123Z', messages: 12345, input: 1000000, output: 2, cache_read: 3, cache_write: 4, model: 'm' }] },
  });
  const v = env.document.getElementById('view').textContent;
  assert.match(v, /12,345/);
  assert.match(v, /1,000,000/);
  assert.match(v, /2026-10-02 09:30/);
  assert.doesNotMatch(v, /T09:30|\.123Z/);
});
