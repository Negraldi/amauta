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
  /gentle-lite\.js['"]?\s+hook\s/.test(command) || command.startsWith('gentle-lite ') || /gentle_lite\.telemetry['"]?\s+hook(\s|$)/.test(command);

const hook = (name, timeout) => ({
  type: 'command',
  command: `node ${shellQuote(BIN)} hook ${name}`,
  ...(timeout ? { timeout } : {}),
});

const TELEMETRY_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop'];

/** Local-only telemetry hook: `env` form works in Claude Code hook command strings (run through a shell). */
const telemetryHook = (stateDir) => ({
  type: 'command',
  command: ['env', shellQuote(`PYTHONPATH=${PYTHON_PATH}`), shellQuote(`GENTLE_LITE_STATE_DIR=${stateDir}`), 'python3 -P -m gentle_lite.telemetry hook'].join(' '),
});

/** Hook entries registered in settings.json. */
export function desiredHooks({ stateDir, telemetry = false } = {}) {
  const hooks = {
    UserPromptSubmit: [{ matcher: '', hooks: [hook('skill-registry')] }],
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [hook('review-stop', 30)] }],
    Stop: [{ matcher: '', hooks: [hook('review-stop', 60)] }],
  };
  if (telemetry) {
    for (const event of TELEMETRY_EVENTS) (hooks[event] ??= []).push({ matcher: '', hooks: [telemetryHook(stateDir)] });
  }
  return hooks;
}
