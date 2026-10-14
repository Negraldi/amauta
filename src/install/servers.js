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
export function desiredMcpServers({ stateDir } = {}) {
  return {
    memory: memoryServer(stateDir),
    context7: { command: 'npx', args: ['-y', '--package=@upstash/context7-mcp@2.2.5', '--', 'context7-mcp'] },
    codegraph: { type: 'stdio', command: 'codegraph', args: ['serve', '--mcp'] },
    rea: { command: 'npx', args: ['-y', 'rea-agents@6.4.0', 'mcp'] },
    'gentle-lite': { type: 'stdio', command: 'node', args: [path.join(repoRoot, 'src', 'mcp', 'server.js')] },
  };
}

const BIN = path.join(repoRoot, 'bin', 'gentle-lite.js');

/** Quote a path for a POSIX shell only when it contains unsafe characters. */
export const shellQuote = (p) => (/^[A-Za-z0-9_./@:+,=-]+$/.test(p) ? p : `'${p.replaceAll("'", `'\\''`)}'`);

/** True for any hook command gentle-lite registered (absolute `node .../gentle-lite.js hook X` or legacy `gentle-lite ...`). */
export const isGentleLiteHook = (command) =>
  /gentle-lite\.js['"]?\s+hook\s/.test(command) || command.startsWith('gentle-lite ') || /gentle_lite\.(telemetry|usage)['"]?\s+hook(\s|$)/.test(command) ||
  /gentle_lite\.sdd['"]?\s+preflight-hook(\s|$)/.test(command);

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
 * Preflight hook command with a shell-level fail-closed guard: when the Python hook cannot start or exits
 * non-zero, the shell prints a PreToolUse deny decision and still exits 0. (Claude Code only blocks on exit 2
 * or an explicit deny, so a bare launcher failure would otherwise fail open.)
 */
export const sddPreflightCommand = () => `${sddCommand()} preflight-hook || printf '%s\\n' ${shellQuote(PREFLIGHT_DENY)}`;

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
