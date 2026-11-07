/**
 * One process per hook event (plan N7, ADR 0003 and 0006).
 *
 * Installed command: `node <bin> hook event <Event> [--state-dir DIR] --with a,b,c [--runtime codex]`. The handler list
 * is written by install, so the settings file says exactly what runs. Input: the hook JSON on stdin, read once.
 * Handlers run in the listed order; Node handlers run in this process, Python handlers are started with `spawn` (no
 * shell, no `env` or `timeout` binaries) using AMAUTA_PYTHON or `python3`. Output: at most one merged decision.
 * Side effects: the handlers' own, plus `<state dir>/stop-policy/<session>.json` for the Stop policy (at most two
 * blocks per turn). Failure mode: fail open (no output, exit 0), except the SDD preflight, which denies an `sdd-*`
 * dispatch it could not check.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../core/fsatomic.js';
import { PREFLIGHT_DENY, PYTHON_PATH } from '../install/servers.js';
import { resolveTargets } from '../install/paths.js';
import { syncIfChanged } from '../install/fingerprint.js';
import { refreshRegistry } from '../registry/skill-registry.js';
import { reviewStop } from '../review/stop.js';
import { graphifyConnect } from '../graphify/connect.js';

const TELEMETRY_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop'];
const MAX_STOP_BLOCKS = 2;

/** Start a Python module with the payload on stdin; resolves `{ ok, stdout }`, never rejects. */
function runPython({ python, module, args, raw, env, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const done = (ok) => {
      if (!settled) [settled] = [true, resolve({ ok, stdout })];
    };
    let child;
    try {
      child = spawn(python, ['-P', '-m', module, ...args], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch {
      done(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(false);
    }, timeoutMs);
    child.stdout.on('data', (b) => (stdout += b));
    child.on('error', () => done(false));
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(raw);
  });
}

const parseDecision = (text) => {
  try {
    const v = JSON.parse(text.trim() || 'null');
    return v !== null && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

const isSddDispatch = (payload, raw) =>
  (typeof payload.tool_input?.subagent_type === 'string' && payload.tool_input.subagent_type.startsWith('sdd-')) ||
  /"subagent_type"\s*:\s*"sdd-/.test(raw);

const pythonHandler = (module, events, timeoutMs, args = ['hook']) => ({
  events,
  run: async (payload, ctx) => {
    await runPython({ python: ctx.python, module, args, raw: ctx.raw, env: ctx.pythonEnv, timeoutMs });
    return null; // telemetry and usage never print a decision
  },
});

/** Handlers by name. Node handlers read their targets from the environment set up in `dispatchEvent`. */
export const REGISTRY = {
  'skill-registry': {
    events: ['UserPromptSubmit'],
    run: async (payload) => {
      if (typeof payload.cwd === 'string' && payload.cwd !== '') await refreshRegistry({ cwd: payload.cwd, gitignore: false, optIn: true });
      return null;
    },
  },
  'review-stop': { events: ['SessionStart', 'Stop'], run: (payload) => reviewStop(payload) },
  'graphify-connect': { events: ['SessionStart'], run: (payload) => graphifyConnect(payload) },
  'sync-check': { events: ['SessionStart'], run: async () => (await syncIfChanged({}), null) },
  telemetry: pythonHandler('amauta.telemetry', TELEMETRY_EVENTS, 5000),
  usage: pythonHandler('amauta.usage', ['Stop', 'SubagentStop'], 10000),
  'sdd-preflight': {
    events: ['PreToolUse'],
    run: async (payload, ctx) => {
      // Cut a hung hook off before the 30 s hook timeout kills this process (which would fail open).
      const timeoutMs = Number(process.env.AMAUTA_PREFLIGHT_TIMEOUT_MS) || 20000;
      const r = await runPython({ python: ctx.python, module: 'amauta.sdd', args: ['preflight-hook'], raw: ctx.raw, env: ctx.pythonEnv,
        timeoutMs });
      if (r.ok) return parseDecision(r.stdout);
      return isSddDispatch(payload, ctx.raw) ? JSON.parse(PREFLIGHT_DENY) : null;
    },
  },
};

/** Stop policy: at most MAX_STOP_BLOCKS blocks while Claude keeps going because of a Stop hook; a natural stop resets. */
async function applyStopPolicy(decision, payload, stateDir) {
  const file = path.join(stateDir, 'stop-policy', `${String(payload.session_id ?? 'none').replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
  const before = payload.stop_hook_active ? (await readFile(file, 'utf8').then((t) => JSON.parse(t).blocks, () => 0)) : 0;
  const allowed = decision?.decision === 'block' && before < MAX_STOP_BLOCKS;
  const blocks = allowed ? before + 1 : before;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify({ blocks })}\n`);
  return allowed ? decision : null;
}

/** One decision from several: Stop blocks are joined; a PreToolUse deny beats an ask; otherwise the first one. */
function merge(event, decisions) {
  if (decisions.length <= 1) return decisions[0] ?? null;
  const blocks = decisions.filter((d) => d.decision === 'block');
  if (blocks.length > 0) return { decision: 'block', reason: blocks.map((d) => d.reason).join('\n\n') };
  if (event === 'PreToolUse') {
    const by = (kind) => decisions.find((d) => d.hookSpecificOutput?.permissionDecision === kind);
    return by('deny') ?? by('ask') ?? decisions[0];
  }
  return decisions[0];
}

/** Run `names` for `event` and return the merged decision (or null). */
export async function dispatchEvent(opts) {
  const { event, payload, raw = JSON.stringify(payload), names, registry = REGISTRY, stateDir, runtime, python } = opts;
  const dir = stateDir ?? resolveTargets({}, process.env).stateDir;
  if (stateDir) process.env.AMAUTA_STATE_DIR = stateDir;
  if (runtime) process.env.AMAUTA_RUNTIME = runtime;
  const pythonEnv = { ...process.env, PYTHONPATH: PYTHON_PATH, AMAUTA_STATE_DIR: dir, ...(runtime ? { AMAUTA_RUNTIME: runtime } : {}) };
  const ctx = { raw, pythonEnv, python: python ?? process.env.AMAUTA_PYTHON ?? 'python3' };
  const decisions = [];
  for (const name of names) {
    const handler = registry[name];
    if (!handler || !handler.events.includes(event)) continue;
    try {
      const d = await handler.run(payload, ctx);
      if (d) decisions.push(d);
    } catch {
      // fail open per handler: the others still run
    }
  }
  const merged = merge(event, decisions);
  return event === 'Stop' ? applyStopPolicy(merged, payload, dir) : merged;
}

/** `hook event <Event> [--state-dir DIR] --with a,b [--python EXE] [--runtime codex]` from the CLI. */
export function parseEventArgs(args) {
  const [event, ...rest] = args;
  const opt = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const names = (opt('--with') ?? '').split(',').filter(Boolean);
  return { event, stateDir: opt('--state-dir'), names, runtime: opt('--runtime'), python: opt('--python') };
}
