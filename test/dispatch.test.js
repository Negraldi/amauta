// One hook process per event (plan N7, ADR 0003/0006): handlers run in order, decisions merge, the Stop policy caps
// blocks per turn, Python handlers start without a shell, and the SDD preflight fails closed for sdd-* only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchEvent } from '../src/hooks/dispatch.js';
import { desiredHooks } from '../src/install/servers.js';
import { desiredCodexHooks } from '../src/install/codex.js';
import { tempDir } from './helpers/tmp.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');
const block = (reason) => ({ events: ['Stop'], run: async () => ({ decision: 'block', reason }) });
const registry = { a: block('first problem'), b: block('second problem'), quiet: { events: ['Stop'], run: async () => null } };

test('blocks from several Stop handlers become one combined block', async () => {
  const stateDir = await tempDir('dispatch-');
  const out = await dispatchEvent({ event: 'Stop', payload: { session_id: 's', stop_hook_active: false }, names: ['a', 'quiet', 'b'], registry, stateDir });
  assert.deepEqual(out, { decision: 'block', reason: 'first problem\n\nsecond problem' });
});

test('the Stop policy blocks at most twice per turn and resets on a natural stop', async () => {
  const stateDir = await tempDir('dispatch-');
  const run = (active) => dispatchEvent({ event: 'Stop', payload: { session_id: 's', stop_hook_active: active }, names: ['a'], registry, stateDir });
  assert.equal((await run(false))?.decision, 'block');
  assert.equal((await run(true))?.decision, 'block');
  assert.equal(await run(true), null);
  assert.equal((await run(false))?.decision, 'block');
});

test('a handler for another event, an unknown name or a throwing handler is skipped', async () => {
  const stateDir = await tempDir('dispatch-');
  const reg = { ...registry, boom: { events: ['Stop'], run: async () => { throw new Error('x'); } }, start: { events: ['SessionStart'], run: async () => ({ decision: 'block', reason: 'no' }) } };
  const out = await dispatchEvent({ event: 'Stop', payload: { session_id: 's' }, names: ['boom', 'start', 'nope'], registry: reg, stateDir });
  assert.equal(out, null);
});

test('the SDD preflight denies an sdd-* dispatch when Python cannot run, and stays silent for other agents', async () => {
  const stateDir = await tempDir('dispatch-');
  const call = (agent) => dispatchEvent({
    event: 'PreToolUse', payload: { tool_name: 'Agent', tool_input: { subagent_type: agent } }, names: ['sdd-preflight'], stateDir, python: path.join(stateDir, 'no-python'),
  });
  assert.equal((await call('sdd-apply')).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(await call('general-purpose'), null);
});

test('the CLI entry `hook event` reads stdin once, fails open and exits 0', () => {
  const r = spawnSync(process.execPath, [bin, 'hook', 'event', 'Stop', '--with', 'review-stop'], { encoding: 'utf8', input: 'not json' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('install registers one command per event, with no env, sh or timeout in it; Codex passes --runtime codex', () => {
  const claude = desiredHooks({ stateDir: '/s', telemetry: true, sdd: true });
  for (const [event, entries] of Object.entries(claude)) {
    assert.equal(entries.length, 1, event);
    assert.equal(entries[0].hooks.length, 1, event);
    const { command } = entries[0].hooks[0];
    assert.match(command, new RegExp(`amauta\\.js'? hook event ${event} `));
    assert.doesNotMatch(command, /(^|\s)(env|sh|timeout)\s/);
  }
  assert.match(claude.Stop[0].hooks[0].command, /--with review-stop,telemetry,usage$/);
  assert.equal(claude.PreToolUse[0].matcher, 'Agent');
  const codex = desiredCodexHooks({ stateDir: '/s', telemetry: true });
  assert.equal(codex.PreToolUse, undefined);
  for (const entries of Object.values(codex)) assert.match(entries[0].hooks[0].command, / --runtime codex$/);
});
