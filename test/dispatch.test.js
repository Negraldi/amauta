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
import { PY } from './helpers/python.js';

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

test('install registers one command per event and matcher, with no env, sh or timeout in it; Codex passes --runtime codex', () => {
  const claude = desiredHooks({ stateDir: '/s', telemetry: true, sdd: true });
  for (const [event, entries] of Object.entries(claude)) {
    assert.equal(new Set(entries.map((e) => e.matcher)).size, entries.length, `${event}: one entry per matcher`);
    for (const entry of entries) {
      assert.equal(entry.hooks.length, 1, event);
      const { command } = entry.hooks[0];
      assert.match(command, new RegExp(`amauta\\.js'? hook event ${event} `));
      assert.doesNotMatch(command, /(^|\s)(env|sh|timeout)\s/);
    }
  }
  assert.match(claude.Stop[0].hooks[0].command, /--with review-stop,checks,telemetry,usage$/);
  assert.deepEqual(claude.PreToolUse.map((e) => e.matcher), ['Read|NotebookRead|NotebookEdit', 'Agent']);
  assert.match(claude.PreToolUse[0].hooks[0].command, /--with privacy$/);
  assert.match(claude.UserPromptSubmit[0].hooks[0].command, /--with skill-registry,privacy,telemetry$/);
  const edit = claude.PostToolUse.find((e) => e.matcher === 'Edit|Write|MultiEdit|NotebookEdit');
  assert.match(edit.hooks[0].command, /--with checks$/, 'the edit check (plan D5)');
  assert.ok(edit.hooks[0].timeout >= 30, 'room for a checker and its baseline');
  const codex = desiredCodexHooks({ stateDir: '/s', telemetry: true });
  assert.equal(codex.PreToolUse, undefined, 'Codex reads files through its shell tool; only the prompt check applies');
  assert.ok(codex.PostToolUse.every((e) => !/--with checks/.test(e.hooks[0].command)), 'Codex edits arrive as patches: no edit check yet');
  assert.match(codex.UserPromptSubmit[0].hooks[0].command, /--with skill-registry,privacy,telemetry --runtime codex$/);
  for (const entries of Object.values(codex)) assert.match(entries[0].hooks[0].command, / --runtime codex$/);
});

test('the privacy handler asks before a data file is read and warns about a secret in a prompt (plan D4)', async () => {
  const stateDir = await tempDir('dispatch-');
  const read = await dispatchEvent({ event: 'PreToolUse', names: ['privacy'], stateDir, python: PY,
    payload: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/work/ventas/clientes.csv' } } });
  assert.equal(read.hookSpecificOutput.permissionDecision, 'ask');
  const prompt = await dispatchEvent({ event: 'UserPromptSubmit', names: ['privacy'], stateDir, python: PY,
    payload: { hook_event_name: 'UserPromptSubmit', prompt: `key ${'AKIA' + 'Q'.repeat(16)}` } });
  assert.match(prompt.systemMessage, /secret/);
  const broken = await dispatchEvent({ event: 'PreToolUse', names: ['privacy'], stateDir, python: path.join(stateDir, 'no-python'),
    payload: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/w/x.csv' } } });
  assert.equal(broken, null, 'fails open: never a deny');
});
