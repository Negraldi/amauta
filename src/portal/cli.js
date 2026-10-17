import { parseArgs } from 'node:util';
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTargets } from '../install/paths.js';
import { runLaunch } from './launch.js';
import { runInstallLauncher } from './launcher.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// No host option on purpose: the Python portal binds 127.0.0.1 only.
export const OPTIONS = {
  port: { type: 'string' },
  'idle-exit': { type: 'string' },
  'claude-home': { type: 'string' },
  'engram-db': { type: 'string' },
  'state-dir': { type: 'string' },
  repo: { type: 'string', multiple: true },
};

/** Project paths listed in `<stateDir>/portal.json` (absolute strings only; the portal validates them again). A missing or broken file lists none. */
export function configuredRepos(stateDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(stateDir, 'portal.json'), 'utf8'));
    return Array.isArray(data?.repos) ? data.repos.filter((r) => typeof r === 'string' && path.isAbsolute(r) && !r.includes('\0')) : [];
  } catch {
    return [];
  }
}

/** Pure: the command, argv and environment used to start the Python portal. */
export function buildPortalSpawn(args, env = process.env) {
  const { values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true });
  if (values.port !== undefined && !(/^\d+$/.test(values.port) && Number(values.port) <= 65535)) throw new Error(`invalid port: ${values.port}`);
  if (values['idle-exit'] !== undefined && !(Number(values['idle-exit']) > 0)) throw new Error(`invalid --idle-exit: ${values['idle-exit']} (seconds, greater than 0)`);
  const targets = resolveTargets({ claudeHome: values['claude-home'], stateDir: values['state-dir'] }, env);
  const out = ['-P', '-m', 'amauta.portal'];
  if (values.port !== undefined) out.push('--port', values.port);
  if (values['idle-exit'] !== undefined) out.push('--idle-exit', values['idle-exit']);
  if (values['claude-home'] !== undefined) out.push('--claude-home', values['claude-home']);
  if (values['engram-db'] !== undefined) out.push('--engram-db', values['engram-db']);
  const repos = new Set((values.repo ?? []).map((r) => path.resolve(r)));
  for (const r of configuredRepos(targets.stateDir)) repos.add(path.resolve(r));
  for (const r of repos) out.push('--repo', r);
  const pythonPath = path.join(repoRoot, 'python');
  return {
    command: 'python3',
    args: out,
    env: { ...env, PYTHONPATH: env.PYTHONPATH ? `${pythonPath}${path.delimiter}${env.PYTHONPATH}` : pythonPath, AMAUTA_STATE_DIR: targets.stateDir },
  };
}

const SIGNAL_CODES = { SIGINT: 130, SIGTERM: 143 };

export function defaultSpawn(command, args, opts, io = { stderr: process.stderr }) {
  return new Promise((resolve) => {
    const child = nodeSpawn(command, args, opts);
    const forward = new Map(['SIGINT', 'SIGTERM'].map((sig) => [sig, () => child.kill(sig)]));
    const cleanup = () => forward.forEach((fn, sig) => process.off(sig, fn));
    forward.forEach((fn, sig) => process.on(sig, fn));
    child.on('error', (err) => {
      cleanup();
      io.stderr.write(`amauta portal: cannot start ${command}: ${err.code ?? ''} ${err.message}\n`);
      resolve(1);
    });
    child.on('exit', (code, signal) => {
      cleanup();
      resolve(code ?? SIGNAL_CODES[signal] ?? 1);
    });
  });
}

export async function runPortal(args, io, { spawn = defaultSpawn, launch = runLaunch, install = runInstallLauncher } = {}) {
  if (args[0] === 'launch') return launch(args.slice(1), io);
  if (args[0] === 'install-launcher') return install(args.slice(1), io);
  let built;
  try {
    built = buildPortalSpawn(args);
  } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
  return spawn(built.command, built.args, { env: built.env, stdio: 'inherit' }, io);
}

export function registerPortalCommands(commands) {
  commands.set('portal', { summary: 'Start the read-only control portal on 127.0.0.1 (--port --idle-exit --claude-home --engram-db --state-dir --repo); `portal launch` opens it as an app window, `portal install-launcher [--remove]` adds the desktop entry', run: (args, io) => runPortal(args, io) });
}
