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

export const HOOK_PREFIX = 'gentle-lite ';

const hook = (command, timeout) => ({ type: 'command', command, ...(timeout ? { timeout } : {}) });

/** Hook entries registered in settings.json. */
export function desiredHooks() {
  return {
    UserPromptSubmit: [{ matcher: '', hooks: [hook('gentle-lite hook skill-registry')] }],
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [hook('gentle-lite hook review-stop', 30)] }],
    Stop: [{ matcher: '', hooks: [hook('gentle-lite hook review-stop', 60)] }],
  };
}
