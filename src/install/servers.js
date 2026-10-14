import path from 'node:path';
import { repoRoot } from './assets.js';

const PYTHON_PATH = path.join(repoRoot, 'python');

/** Our Python memory MCP server (stdlib only; replaces the compiled engram binary). */
export const memoryServer = (stateDir) => ({
  type: 'stdio',
  command: 'python3',
  args: ['-P', '-m', 'gentle_lite.memory', 'serve'],
  env: { PYTHONPATH: PYTHON_PATH, GENTLE_LITE_STATE_DIR: stateDir },
});

/**
 * MCP servers registered in .claude.json (added only when absent).
 * The memory server is returned separately (`memory`) because its key depends on what the user already has.
 */
export function desiredMcpServers({ stateDir, rea = false, context7 = false } = {}) {
  return {
    memory: memoryServer(stateDir),
    codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
    'gentle-lite': { type: 'stdio', command: 'node', args: [path.join(repoRoot, 'src', 'mcp', 'server.js')] },
    // Opt-in (--with-context7 / --with-rea): third-party servers that run unsandboxed; rea alone lists ~300 tools.
    ...(context7 ? { context7: { command: 'npx', args: ['-y', '--package=@upstash/context7-mcp@2.2.5', '--', 'context7-mcp'] } } : {}),
    ...(rea ? { rea: { command: 'npx', args: ['-y', 'rea-agents@6.4.0', 'mcp'] } } : {}),
  };
}

const BIN = path.join(repoRoot, 'bin', 'gentle-lite.js');

/** Quote a path for a POSIX shell only when it contains unsafe characters. */
export const shellQuote = (p) => (/^[A-Za-z0-9_./@:+,=-]+$/.test(p) ? p : `'${p.replaceAll("'", `'\\''`)}'`);

/** True for any hook command gentle-lite registered (absolute `node .../gentle-lite.js hook X` or legacy `gentle-lite ...`). */
export const isGentleLiteHook = (command) =>
  /gentle-lite\.js['"]?\s+hook\s/.test(command) || command.startsWith('gentle-lite ') || /gentle_lite\.(telemetry|usage)['"]?\s+hook(\s|$)/.test(command) ||
  /gentle_lite\.sdd['"]?\s+preflight-hook([\s)]|$)/.test(command);

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
  command: ['env', shellQuote(`PYTHONPATH=${PYTHON_PATH}`), shellQuote(`GENTLE_LITE_STATE_DIR=${stateDir}`), `python3 -P -m ${module} hook`].join(' '),
});
const telemetryHook = (stateDir) => pythonHook(stateDir, 'gentle_lite.telemetry', 5);
/** Transcript usage ingestion: only after a turn or subagent ends. */
const USAGE_EVENTS = ['Stop', 'SubagentStop'];

/** Command prefix the SDD assets use to call our status module (`{{GENTLE_LITE_SDD}}`) and the preflight hook command. */
export const sddCommand = () => `env ${shellQuote(`PYTHONPATH=${PYTHON_PATH}`)} python3 -P -m gentle_lite.sdd`;

const PREFLIGHT_DENY = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'SDD preflight hook could not run (python3 missing, import failure or crash); dispatch refused fail-closed. Fix the gentle-lite install (gentle-lite status).',
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
export const sddPreflightCommand = () =>
  [
    `in=$(cat); T=; command -v timeout >/dev/null 2>&1 && T='timeout 20'`,
    `out=$(printf '%s' "$in" | $T ${sddCommand()} preflight-hook) && { [ -z "$out" ] || printf '%s\\n' "$out"; }`,
    `|| { printf '%s' "$in" | grep -q '"subagent_type" *: *"sdd-' && printf '%s\\n' ${shellQuote(PREFLIGHT_DENY)}; true; }`,
  ].join('; ').replace('; ||', ' ||');

/** Hook entries registered in settings.json. */
export function desiredHooks({ stateDir, telemetry = false, sdd = false } = {}) {
  const hooks = {
    UserPromptSubmit: [{ matcher: '', hooks: [hook('skill-registry', 10)] }],
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [hook('review-stop', 30)] }],
    Stop: [{ matcher: '', hooks: [hook('review-stop', 60)] }],
  };
  if (telemetry) {
    for (const event of TELEMETRY_EVENTS) (hooks[event] ??= []).push({ matcher: '', hooks: [telemetryHook(stateDir)] });
    for (const event of USAGE_EVENTS) (hooks[event] ??= []).push({ matcher: '', hooks: [pythonHook(stateDir, 'gentle_lite.usage', 10)] });
  }
  if (sdd) (hooks.PreToolUse ??= []).push({ matcher: 'Agent', hooks: [{ type: 'command', command: sddPreflightCommand(), timeout: 30 }] });
  return hooks;
}
