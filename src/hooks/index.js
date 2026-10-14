// Hook entrypoints for Claude Code. Handlers read the hook JSON from stdin and
// may print one JSON object to stdout; exit code 0 with empty stdout is a no-op.
// Real implementations land in a later work unit; for now both are placeholders.

const noop = async () => 0;

export const handlers = new Map([
  ['skill-registry', noop],
  ['review-stop', noop],
]);

export async function runHook(name, io) {
  const handler = handlers.get(name);
  if (!handler) {
    io.stderr.write(`gentle-lite: unknown hook: ${name ?? ''}\n`);
    return 1;
  }
  return handler(io);
}
