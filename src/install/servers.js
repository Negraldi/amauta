import path from 'node:path';
import { quoteArg } from '../core/platform.js';
import { repoRoot } from './assets.js';

export const PYTHON_PATH = path.join(repoRoot, 'python');
/** The interpreter used when install was not told one (`--python`, AMAUTA_PYTHON); commands then carry no flag. */
export const DEFAULT_PYTHON = 'python3';

/** Our Python memory MCP server (stdlib only; replaces the compiled engram binary). */
export const memoryServer = (stateDir, python = DEFAULT_PYTHON) => ({
  type: 'stdio',
  command: python,
  args: ['-P', '-m', 'amauta.memory', 'serve'],
  // AMAUTA_RUNTIME only labels where the server runs; memories are partitioned by project alone, never by runtime.
  env: { PYTHONPATH: PYTHON_PATH, AMAUTA_STATE_DIR: stateDir, AMAUTA_RUNTIME: 'claude' },
});

/**
 * MCP servers registered in .claude.json (added only when absent).
 * The memory server is returned separately (`memory`) because its key depends on what the user already has.
 */
export function desiredMcpServers({ stateDir, rea = false, context7 = false, python } = {}) {
  return {
    memory: memoryServer(stateDir, python),
    codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
    'amauta': { type: 'stdio', command: 'node', args: [path.join(repoRoot, 'src', 'mcp', 'server.js')] },
    // Opt-in (--with-context7 / --with-rea): third-party servers that run unsandboxed; rea alone lists ~300 tools.
    ...(context7 ? { context7: { command: 'npx', args: ['-y', '--package=@upstash/context7-mcp@2.2.5', '--', 'context7-mcp'] } } : {}),
    ...(rea ? { rea: { command: 'npx', args: ['-y', 'rea-agents@6.4.0', 'mcp'] } } : {}),
  };
}

const BIN = path.join(repoRoot, 'bin', 'amauta.js');

/** Quote a path for a POSIX shell only when it contains unsafe characters. */
/** One argument of a hook or MCP command line, quoted for the platform's hook shell (src/core/platform.js). */
export const shellQuote = (p) => quoteArg(p);

/** True for any hook command amauta registered (absolute `node .../amauta.js hook X` or legacy `amauta ...`). */
export const isAmautaHook = (command) =>
  /(^|[\s/'"])amauta\.js['"]?\s+hook(\s|$)/.test(command) || /(^|\s)-m\s+amauta\.[a-z_]+(\s|$)/.test(command) || command.startsWith('amauta ') || /amauta\.(telemetry|usage)['"]?\s+hook(\s|$)/.test(command) ||
  /amauta\.sdd['"]?\s+preflight-hook([\s)]|$)/.test(command);

/** Command prefix the SDD assets use to call our status module (`{{AMAUTA_SDD}}`): `amauta sdd`, portable to Windows. */
export const sddCommand = () => `node ${shellQuote(BIN)} sdd`;

/** The decision the SDD preflight prints when it cannot run for an `sdd-*` dispatch (fail closed, src/hooks/dispatch.js). */
export const PREFLIGHT_DENY = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'SDD preflight hook could not run (python3 missing, import failure or crash); dispatch refused fail-closed. Fix the amauta install (amauta status).',
  },
});

/**
 * Handlers per event and the event's timeout (seconds, the sum of the handlers' own bounds plus slack). One command
 * per event runs them in this order (src/hooks/dispatch.js); the handler names are written into the command.
 */
export const PRIVACY_MATCHER = 'Read|NotebookRead|NotebookEdit';
export const EDIT_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

const EVENT_PLAN = [
  { event: 'UserPromptSubmit', base: ['skill-registry', 'privacy'], telemetry: ['telemetry'], timeout: 20 },
  { event: 'SessionStart', base: ['review-stop', 'graphify-connect', 'sync-check'], telemetry: ['telemetry'], timeout: 60 },
  { event: 'Stop', base: ['review-stop', 'checks'], telemetry: ['telemetry', 'usage'], timeout: 60 },
  { event: 'PostToolUse', base: [], telemetry: ['telemetry'], timeout: 10 },
  { event: 'SubagentStop', base: [], telemetry: ['telemetry', 'usage'], timeout: 20 },
];

const eventCommand = (event, names, { stateDir, runtime, python }) =>
  [`node ${shellQuote(BIN)} hook event ${event}`, ...(stateDir ? [`--state-dir ${shellQuote(stateDir)}`] : []), `--with ${names.join(',')}`,
    ...(python && python !== DEFAULT_PYTHON ? [`--python ${shellQuote(python)}`] : []), ...(runtime ? [`--runtime ${runtime}`] : [])].join(' ');

/** Hook entries registered in settings.json (Claude) or hooks.json (Codex, `runtime: 'codex'`): one per event. */
export function desiredHooks({ stateDir, telemetry = false, sdd = false, runtime, python } = {}) {
  const where = { stateDir, runtime, python };
  const hooks = {};
  for (const p of EVENT_PLAN) {
    const names = [...p.base, ...(telemetry ? p.telemetry : [])];
    if (names.length === 0) continue;
    hooks[p.event] = [{ matcher: '', hooks: [{ type: 'command', command: eventCommand(p.event, names, where), timeout: p.timeout }] }];
  }
  const pre = [];
  // Data files reach the model through Read; Codex reads through its shell, so it gets only the prompt check (plan D4).
  const entry = (matcher, names, timeout, event = 'PreToolUse') =>
    ({ matcher, hooks: [{ type: 'command', command: eventCommand(event, names, where), timeout }] });
  if (runtime !== 'codex') pre.push(entry(PRIVACY_MATCHER, ['privacy'], 10));
  if (sdd) pre.push(entry('Agent', ['sdd-preflight'], 30));
  if (pre.length) hooks.PreToolUse = pre;
  // The edit check (plan D5): Claude's edit tools only; Codex edits arrive as patches through its shell.
  if (runtime !== 'codex') hooks.PostToolUse = [...(hooks.PostToolUse ?? []), entry(EDIT_MATCHER, ['checks'], 60, 'PostToolUse')];
  return hooks;
}

/**
 * True for an MCP server entry that runs one of amauta's own servers, from any checkout: `.../src/mcp/server.js`
 * (only under an `amauta*` path or with AMAUTA_* env, so an unrelated project's server.js is never claimed) or
 * `-m amauta.memory`. Used to replace entries an older checkout or an earlier adapter left behind.
 */
export function isAmautaServer(value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.args)) return false;
  const args = value.args.filter((a) => typeof a === 'string');
  const mod = args.indexOf('amauta.memory');
  if (mod > 0 && args[mod - 1] === '-m') return true;
  const hasAmautaEnv = Object.keys(value.env ?? {}).some((k) => k.startsWith('AMAUTA_'));
  return args.some((a) => /(^|[\\/])src[\\/]mcp[\\/]server\.js$/.test(a) && (/amauta/i.test(a) || hasAmautaEnv));
}

/** Names an older checkout or adapter registered for amauta's own servers; entries under them that run amauta are ours. */
export const AMAUTA_SERVER_NAMES = ['amauta', 'engram', 'amauta-memory'];
/** `amauta-memory` is a retired alias: the memory server is `engram`. */
export const LEGACY_SERVER_ALIASES = ['amauta-memory'];

/** Report lines (`hook <Event>: <command>`) for amauta hooks in a hooks object that are not in `wantedCommands`. */
export function staleAmautaHooks(settings, wantedCommands) {
  const out = [];
  const hooks = settings?.hooks;
  if (hooks === null || typeof hooks !== 'object') return out;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) for (const h of Array.isArray(e?.hooks) ? e.hooks : []) if (typeof h?.command === 'string' && isAmautaHook(h.command) && !wantedCommands.has(h.command)) out.push(`hook ${event}: ${h.command}`);
  }
  return out;
}

/**
 * An amauta server entry that points at another checkout (the server script or PYTHONPATH is not this one's).
 * An entry that points here but was edited is the user's and is never "stale".
 */
export function isStaleAmautaServer(value) {
  if (!isAmautaServer(value)) return false;
  const here = (value.args ?? []).includes(path.join(repoRoot, 'src', 'mcp', 'server.js')) || value.env?.PYTHONPATH === PYTHON_PATH;
  return !here;
}
