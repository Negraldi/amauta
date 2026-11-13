// T13 re-critique item 13: the Security tables opened Z to A on their name column (the table default is descending). The
// checkers, trusted folders and selected profiles now open A to Z; the redaction counts stay largest first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const SEC = { protections: { memory_guard: 'on', privacy: 'on', checks: 'off', installed: true },
  checkers: ['tsc', 'eslint', 'ruff'].map((name) => ({ name, installed: true, needs_trust: false })),
  trusted: [{ name: 'zeta', path: '/z', since: '2026-01-01' }, { name: 'alpha', path: '/a', since: '2026-01-02' }],
  profiles: { names: ['default'], drafts: 0, selected: [{ project: 'web', profile: 'x' }, { project: 'api', profile: 'y' }] }, redacted: {} };

test('Security name columns open A to Z', async () => {
  const env = makeEnv({ '/api/security': SEC });
  env.location.hash = '#/security';
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  const tables = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'tbody');
  const firstCells = (tb) => tb.children.map((tr) => tr.children[0].textContent);
  assert.deepEqual(firstCells(tables[0]), ['eslint', 'ruff', 'tsc']);
  assert.deepEqual(firstCells(tables[1]), ['alpha', 'zeta']);
  assert.deepEqual(firstCells(tables[2]), ['api', 'web']);
  const sorted = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'th' && e.getAttribute('aria-sort') !== 'none');
  assert.ok(sorted.length >= 3 && sorted.every((th) => th.getAttribute('aria-sort') === 'ascending'));
});
