import { parseArgs } from 'node:util';
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTargets } from '../install/paths.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// No host option on purpose: the Python portal binds 127.0.0.1 only.
const OPTIONS = {
  port: { type: 'string' },
  'claude-home': { type: 'string' },
  'engram-db': { type: 'string' },
  'state-dir': { type: 'string' },
  graphify: { type: 'string' },
  repo: { type: 'string', multiple: true },
};

/** Pure: the command, argv and environment used to start the Python portal. */
export function buildPortalSpawn(args, env = process.env) {
  const { values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true });
  if (values.port !== undefined && !(/^\d+$/.test(values.port) && Number(values.port) <= 65535)) throw new Error(`invalid port: ${values.port}`);
  const targets = resolveTargets({ claudeHome: values['claude-home'], stateDir: values['state-dir'] }, env);
  const out = ['-P', '-m', 'gentle_lite.portal'];
  if (values.port !== undefined) out.push('--port', values.port);
  if (values['claude-home'] !== undefined) out.push('--claude-home', values['claude-home']);
  if (values['engram-db'] !== undefined) out.push('--engram-db', values['engram-db']);
  if (values.graphify !== undefined) out.push('--graphify', values.graphify);
  for (const r of values.repo ?? []) out.push('--repo', path.resolve(r));
  const pythonPath = path.join(repoRoot, 'python');
  return {
    command: 'python3',
    args: out,
    env: { ...env, PYTHONPATH: env.PYTHONPATH ? `${pythonPath}${path.delimiter}${env.PYTHONPATH}` : pythonPath, GENTLE_LITE_STATE_DIR: targets.stateDir },
  };
}

function defaultSpawn(command, args, opts) {
  return new Promise((resolve) => {
    const child = nodeSpawn(command, args, opts);
    child.on('error', () => resolve(1));
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1)));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  });
}

export async function runPortal(args, io, { spawn = defaultSpawn } = {}) {
  let built;
  try {
    built = buildPortalSpawn(args);
  } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
  return spawn(built.command, built.args, { env: built.env, stdio: 'inherit' });
}

export function registerPortalCommands(commands) {
  commands.set('portal', { summary: 'Start the read-only control portal on 127.0.0.1 (--port --claude-home --engram-db --state-dir --graphify --repo)', run: (args, io) => runPortal(args, io) });
}
