#!/usr/bin/env node
/**
 * amauta runtime probe (developer tool, never installed by `amauta install`).
 *
 * Purpose: answer, on a real machine, the questions plan N1 cannot answer in CI: which shell runs hook commands,
 * whether a PostToolUse `decision: block` reaches the agent, whether PreToolUse `ask` works, whether hooks fire for
 * tool calls made inside subagents, and how long a Node hook takes to start.
 * Input: the hook JSON on stdin. Args: `--block` (PostToolUse block, once per session) or `--ask` (PreToolUse ask).
 * Output: one JSON line appended to AMAUTA_PROBE_LOG (default <tmp>/amauta-probe.jsonl); a decision on stdout only in
 * the two modes above. Side effects: that log file only. Failure mode: any error exits 0 with empty stdout.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const startupMs = Math.round(process.uptime() * 1000);
const log = process.env.AMAUTA_PROBE_LOG || path.join(os.tmpdir(), 'amauta-probe.jsonl');
const mode = process.argv.includes('--block') ? 'block' : process.argv.includes('--ask') ? 'ask' : 'record';

const readPayload = () => {
  const value = JSON.parse(readFileSync(0, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('payload');
  return value;
};

/** True when this session already got a block, so a block is sent at most once per session. */
const blockedBefore = (session) => {
  try {
    const mark = `"session":${JSON.stringify(session)}`;
    return readFileSync(log, 'utf8').split('\n').some((l) => l.includes('"blocked":true') && l.includes(mark));
  } catch {
    return false;
  }
};

function decide(payload) {
  if (mode === 'ask') {
    const reason = 'amauta probe: ask reached the user';
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } };
  }
  if (mode === 'block' && !blockedBefore(payload.session_id ?? null)) {
    return { decision: 'block', reason: `amauta probe: ${payload.hook_event_name ?? 'hook'} block reached the agent` };
  }
  return null;
}

try {
  const payload = readPayload();
  const decision = decide(payload);
  const row = {
    at: new Date().toISOString(), mode, event: payload.hook_event_name ?? null, tool: payload.tool_name ?? null,
    session: payload.session_id ?? null, payloadKeys: Object.keys(payload).sort(), platform: process.platform,
    node: process.version, startupMs, shell: process.env.SHELL ?? null, comspec: process.env.ComSpec ?? null,
    msystem: process.env.MSYSTEM ?? null, psmodulepath: Boolean(process.env.PSModulePath), cwd: process.cwd(),
    runtime: process.env.AMAUTA_RUNTIME ?? null, blocked: Boolean(decision?.decision === 'block'),
  };
  appendFileSync(log, `${JSON.stringify(row)}\n`);
  if (decision) process.stdout.write(`${JSON.stringify(decision)}\n`);
} catch {
  // fail open: empty stdout, exit 0
}
