import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tempDir } from './helpers/tmp.js';

const probe = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'probe', 'probe-hook.mjs');
const run = (args, payload, log) =>
  spawnSync(process.execPath, [probe, ...args], { encoding: 'utf8', input: JSON.stringify(payload), env: { ...process.env, AMAUTA_PROBE_LOG: log } });
const lines = async (file) => (await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));

test('probe hook records the event, the runtime facts and prints nothing by default', async () => {
  const dir = await tempDir('probe-');
  const log = path.join(dir, 'probe.jsonl');
  const r = run([], { hook_event_name: 'PreToolUse', tool_name: 'Read', session_id: 's1', agent_id: 'a1' }, log);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const [row] = await lines(log);
  assert.equal(row.event, 'PreToolUse');
  assert.equal(row.tool, 'Read');
  assert.equal(row.platform, process.platform);
  assert.deepEqual(row.payloadKeys, ['agent_id', 'hook_event_name', 'session_id', 'tool_name']);
  assert.equal(typeof row.startupMs, 'number');
  assert.ok('shell' in row && 'comspec' in row && 'msystem' in row);
});

test('probe --block blocks once per session, --ask asks', async () => {
  const dir = await tempDir('probe-');
  const log = path.join(dir, 'probe.jsonl');
  const payload = { hook_event_name: 'PostToolUse', tool_name: 'Edit', session_id: 's2' };
  const first = run(['--block'], payload, log);
  assert.deepEqual(JSON.parse(first.stdout), { decision: 'block', reason: 'amauta probe: PostToolUse block reached the agent' });
  assert.equal(run(['--block'], payload, log).stdout, '');
  const ask = run(['--ask'], { hook_event_name: 'PreToolUse', tool_name: 'Read', session_id: 's3' }, log);
  assert.equal(JSON.parse(ask.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('probe hook fails open on malformed stdin', async () => {
  const dir = await tempDir('probe-');
  const r = spawnSync(process.execPath, [probe, '--block'], { encoding: 'utf8', input: 'not json', env: { ...process.env, AMAUTA_PROBE_LOG: path.join(dir, 'p.jsonl') } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
