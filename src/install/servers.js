import path from 'node:path';
import { repoRoot } from './assets.js';

/** MCP servers registered in .claude.json (added only when absent). */
export function desiredMcpServers() {
  return {
    engram: { type: 'stdio', command: 'engram', args: ['mcp', '--tools=agent'], env: {} },
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
export const isGentleLiteHook = (command) => /gentle-lite\.js['"]?\s+hook\s/.test(command) || command.startsWith('gentle-lite ');

const hook = (name, timeout) => ({
  type: 'command',
  command: `node ${shellQuote(BIN)} hook ${name}`,
  ...(timeout ? { timeout } : {}),
});

/** Hook entries registered in settings.json. */
export function desiredHooks() {
  return {
    UserPromptSubmit: [{ matcher: '', hooks: [hook('skill-registry')] }],
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [hook('review-stop', 30)] }],
    Stop: [{ matcher: '', hooks: [hook('review-stop', 60)] }],
  };
}
