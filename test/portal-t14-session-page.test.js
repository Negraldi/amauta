// T14 cross-page agreement, session page: labels in the UI language, every count grouped like the rest of the portal, and a
// breadcrumb that names the session by its short id (as the session tables do) instead of repeating the whole title.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const SID = 'b9600f26-aaaa-bbbb-cccc-000000000001';
const PAGE = { kind: 'session', id: SID, title: 'amauta · claude-opus-5-5, 12528 messages · 2026-11-09', body_md: null, missing: [], links: [], backlinks: [],
  meta: [{ label: 'Started', value: '2026-11-09T11:26:00Z' }, { label: 'Last activity', value: '2026-11-13T20:40:00Z' },
    { label: 'Messages', value: '12528', fmt: 'number' }, { label: 'Models', value: 'claude-opus-5-5 (1777), claude-sonnet-5-5 (101)' }],
  sections: [{ heading: 'Tools', items: [{ label: 'Bash', value: '1446 calls', kind: 'tool', id: 'Bash' }] }] };

async function boot(lang) {
  const env = makeEnv({ '/api/wiki/page': PAGE });
  env.location.hash = '#/session/b9600f26';
  await runPortal(env, { DOMParser: class {}, queueMicrotask, navigator: { language: lang } });
  await tick();
  return env;
}

test('in Spanish the session details are in Spanish and every count is grouped', async () => {
  const env = await boot('es-ES');
  const v = env.document.getElementById('view');
  const dts = tree(v).filter((e) => e.tagName === 'dt').map((e) => e.textContent);
  for (const label of ['Inicio', 'Última actividad', 'Mensajes', 'Modelos']) assert.ok(dts.includes(label), dts.join(' | '));
  assert.match(v.textContent, /claude-opus-5-5 \(1\.777\)/);
  assert.match(v.textContent, /1\.446 llamadas/);
  assert.match(tree(v).find((e) => e.tagName === 'h1').textContent, /12\.528/);
});

test('the breadcrumb ends with the short id the session tables show', async () => {
  const env = await boot('en-US');
  const crumbs = tree(env.document.getElementById('view')).filter((e) => e.tagName === 'nav' && /crumbs/.test(e.getAttribute('class') || e.className || ''));
  const last = tree(crumbs[0]).filter((e) => e.tagName === 'li').pop().textContent;
  assert.equal(last, 'b9600f26');
});
