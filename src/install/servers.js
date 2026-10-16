import path from 'node:path';
import { repoRoot } from './assets.js';

const PYTHON_PATH = path.join(repoRoot, 'python');

/** Our Python memory MCP server (stdlib only; replaces the compiled engram binary). */
export const memoryServer = (stateDir) => ({
  type: 'stdio',
  command: 'python3',
  args: ['-P', '-m', 'amauta.memory', 'serve'],
  env: { PYTHONPATH: PYTHON_PATH, AMAUTA_STATE_DIR: stateDir },
});

/**
 * MCP servers registered in .claude.json (added only when absent).
 * The memory server is returned separately (`memory`) because its key depends on what the user already has.
 */
export function desiredMcpServers({ stateDir, rea = false, context7 = false } = {}) {
  return {
    memory: memoryServer(stateDir),
    codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
    'amauta': { type: 'stdio', command: 'node', args: [path.join(repoRoot, 'src', 'mcp', 'server.js')] },
    // Opt-in (--with-context7 / --with-rea): third-party servers that run unsandboxed; rea alone lists ~300 tools.
    ...(context7 ? { context7: { command: 'npx', args: ['-y', '--package=@upstash/context7-mcp@2.2.5', '--', 'context7-mcp'] } } : {}),
    ...(rea ? { rea: { command: 'npx', args: ['-y', 'rea-agents@6.4.0', 'mcp'] } } : {}),
  };
}

const BIN = path.join(repoRoot, 'bin', 'amauta.js');

/** Quote a path for a POSIX shell only when it contains unsafe characters. */
export const shellQuote = (p) => (/^[A-Za-z0-9_./@:+,=-]+$/.test(p) ? p : `'${p.replaceAll("'", `'\\''`)}'`);

/** True for any hook command amauta registered (absolute `node .../amauta.js hook X` or legacy `amauta ...`). */
export const isAmautaHook = (command) =>
  /amauta\.js['"]?\s+hook\s/.test(command) || command.startsWith('amauta ') || /amauta\.(telemetry|usage)['"]?\s+hook(\s|$)/.test(command) ||
  /amauta\.sdd['"]?\s+preflight-hook([\s)]|$)/.test(command);

const hook = (name, timeout) => ({
  type: 'command',
  command: `node ${shellQuote(BIN)} hook ${name}`,
  ...(timeout ? { timeout } : {}),
});

const TELEMETRY_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop'];

/** Local-only telemetry hook: `env` form works in Claude Code hook command strings (run through a shell). */
const pythonHook = (stateDir, module, timeout) => ({
  type: 'command',
  timeout,
  command: ['env', shellQuote(`PYTHONPATH=${PYTHON_PATH}`), shellQuote(`AMAUTA_STATE_DIR=${stateDir}`), `python3 -P -m ${module} hook`].join(' '),
});
const telemetryHook = (stateDir) => pythonHook(stateDir, 'amauta.telemetry', 5);
/** Transcript usage ingestion: only after a turn or subagent ends. */
const USAGE_EVENTS = ['Stop', 'SubagentStop'];

/** Command prefix the SDD assets use to call our status module (`{{AMAUTA_SDD}}`) and the preflight hook command. */
export const sddCommand = () => `env ${shellQuote(`PYTHONPATH=${PYTHON_PATH}`)} python3 -P -m amauta.sdd`;

const PREFLIGHT_DENY = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'SDD preflight hook could not run (python3 missing, import failure or crash); dispatch refused fail-closed. Fix the amauta install (amauta status).',
  },
});

/**
 * Preflight hook command with a shell-level fail-closed guard. Claude Code only blocks on exit 2 or an explicit deny,
 * so a bare launcher failure would otherwise fail open. The shell reads the payload, runs the Python hook under
 * `timeout 20` when timeout(1) exists (so a hang is cut off before the 30 s hook timeout kills the whole shell, which
 * would fail open), and prints the hook's own output only when it succeeded. When it failed (cannot start, crash,
 * non-zero exit, hang) any partial output is discarded and the deny decision is printed, but only for `sdd-*`
 * dispatches: other agents stay silent. Residual gaps: no `sh`, or no timeout(1) and a hung hook.
 */
export const sddPreflightCommand = () => {
  const readPayload = `in=$(cat); T=; command -v timeout >/dev/null 2>&1 && T='timeout 20'`;
  const onSuccess = `[ -z "$out" ] || printf '%s\\n' "$out"`;
  const onFailure = `printf '%s' "$in" | grep -q '"subagent_type" *: *"sdd-' && printf '%s\\n' ${shellQuote(PREFLIGHT_DENY)}`;
  const run = `if out=$(printf '%s' "$in" | $T ${sddCommand()} preflight-hook); then ${onSuccess}; else ${onFailure}; fi`;
  // Trailing `true`: a failing branch (e.g. closed stdout) must still exit 0, a non-blocking hook error rather than exit 2.
  return [readPayload, run, 'true'].join('; ');
};

/** Hook entries registered in settings.json. */
export function desiredHooks({ stateDir, telemetry = false, sdd = false } = {}) {
  const hooks = {
    UserPromptSubmit: [{ matcher: '', hooks: [hook('skill-registry', 10)] }],
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [hook('review-stop', 30)] }],
    Stop: [{ matcher: '', hooks: [hook('review-stop', 60)] }],
  };
  if (telemetry) {
    for (const event of TELEMETRY_EVENTS) (hooks[event] ??= []).push({ matcher: '', hooks: [telemetryHook(stateDir)] });
    for (const event of USAGE_EVENTS) (hooks[event] ??= []).push({ matcher: '', hooks: [pythonHook(stateDir, 'amauta.usage', 10)] });
  }
  if (sdd) (hooks.PreToolUse ??= []).push({ matcher: 'Agent', hooks: [{ type: 'command', command: sddPreflightCommand(), timeout: 30 }] });
  return hooks;
}
