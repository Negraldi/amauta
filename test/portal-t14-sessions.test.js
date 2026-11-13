// T14 cross-page agreement, session tables: the model cell names the session's main model (the server sends the one with
// the most messages) and says when there were others ("claude-opus-5-5 +1").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const T = (x) => ({ messages: 1, input: 1, output: 1, cache_read: 0, cache_write: 0, last_ts: '2026-11-10T08:00:00Z', ...x });
export const SESSIONS = { available: true, projects: [], sessions: [
  T({ session_id: 'aaaaaaaa1', project: 'amauta', model: 'claude-opus-5-5', models: 2 }),
  T({ session_id: 'bbbbbbbb2', project: 'amauta', model: 'claude-sonnet-5-5', models: 1 })] };

async function cells(hash, routes) {
  const env = makeEnv({ '/api/sessions': SESSIONS, ...routes });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask });
  await tick();
  return tree(env.document.getElementById('view')).filter((e) => e.tagName === 'td').map((e) => e.textContent);
}

test('a session that used several models names the main one and how many others', async () => {
  const text = await cells('#/session', {});
  assert.ok(text.includes('claude-opus-5-5 +1'), text.join(' | '));
  assert.ok(text.includes('claude-sonnet-5-5'), text.join(' | '));
});
