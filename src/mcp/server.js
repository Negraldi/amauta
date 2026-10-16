#!/usr/bin/env node
// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). Hand-rolled on purpose:
// four read-mostly tools do not justify a runtime dependency.
import { realpathSync } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { packageVersion } from '../version.js';
import { tools, toolByName, validateArgs, ToolInputError } from './tools.js';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const reply = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
const fail = (id, code, message) => reply({ id, error: { code, message } });

async function callTool(id, params) {
  const tool = toolByName.get(params?.name);
  if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
  try {
    const args = validateArgs(tool, params.arguments === undefined ? {} : params.arguments);
    const result = await tool.run(args);
    reply({ id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
  } catch (err) {
    reply({ id, result: { isError: true, content: [{ type: 'text', text: err instanceof ToolInputError ? err.message : `error: ${err.message}` }] } });
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined;
  switch (method) {
    case 'initialize': {
      const wanted = params?.protocolVersion;
      return reply({
        id,
        result: {
          protocolVersion: SUPPORTED.includes(wanted) ? wanted : SUPPORTED[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'amauta', version: packageVersion() },
        },
      });
    }
    case 'ping':
      return reply({ id, result: {} });
    case 'tools/list':
      return reply({ id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    case 'tools/call':
      return callTool(id, params);
    default:
      if (!isNotification) fail(id, -32601, `method not found: ${method}`);
  }
}

export function serve(input = process.stdin) {
  // Every reply, including protocol errors, goes through this chain so they leave in arrival order.
  let chain = Promise.resolve();
  const rl = readline.createInterface({ input });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    chain = chain
      .then(() => {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return fail(null, -32700, 'parse error');
        }
        if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') {
          return fail(msg?.id ?? null, -32600, 'invalid request');
        }
        return handle(msg).catch((err) => msg.id !== undefined && fail(msg.id, -32603, err.message));
      })
      .catch(() => {});
  });
  return new Promise((resolve) => rl.on('close', () => chain.then(resolve)));
}

// Compare real paths: the module URL is already resolved, argv[1] may go through a symlink.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) await serve();
