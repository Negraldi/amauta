// Hook entrypoints for Claude Code. Handlers receive the hook JSON from stdin and may
// return one object to print as JSON on stdout. Hooks fail open: any error, malformed
// input or missing field results in empty stdout and exit code 0.
import { refreshRegistry } from '../registry/skill-registry.js';
import { reviewStop } from '../review/stop.js';

export const handlers = new Map([
  ['skill-registry', async (payload) => {
    if (typeof payload.cwd !== 'string' || payload.cwd === '') return null;
    await refreshRegistry({ cwd: payload.cwd, gitignore: false });
    return null;
  }],
  ['review-stop', (payload) => reviewStop(payload)],
]);

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function parsePayload(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export async function runHook(name, io) {
  const handler = handlers.get(name);
  if (!handler) {
    io.stderr.write(`gentle-lite: unknown hook: ${name ?? ''}\n`);
    return 1;
  }
  try {
    const payload = parsePayload(await readAll(io.stdin ?? process.stdin));
    const decision = await handler(payload);
    if (decision) io.stdout.write(`${JSON.stringify(decision)}\n`);
  } catch {
    // fail open
  }
  return 0;
}
