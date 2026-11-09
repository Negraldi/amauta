/**
 * The Python interpreter amauta's hooks and memory server use (plan N8, ADR 0003).
 *
 * Resolution: `--python` > AMAUTA_PYTHON > the one a previous install recorded > `python3`. A chosen interpreter is
 * checked once with `-c` to be at least 3.11; the default is not probed (as before 0.5). Side effects: one short
 * child process when an interpreter was chosen. Failure mode: throws before anything is written.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readStateObject } from './files.js';
import { resolveTargets } from './paths.js';
import { DEFAULT_PYTHON, PYTHON_PATH } from './servers.js';

export function resolvePython(opts, ...recorded) {
  const chosen = opts.python ?? process.env.AMAUTA_PYTHON;
  if (chosen === undefined || chosen === '') return recorded.find((p) => typeof p === 'string' && p !== '') ?? DEFAULT_PYTHON;
  const probe = ['-c', 'import sys; print(sys.version_info >= (3, 11))'];
  const r = spawnSync(chosen, probe, { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (r.error || r.status !== 0 || r.stdout.trim() !== 'True') {
    throw new Error(`${chosen} is not a Python 3.11 or newer interpreter (amauta needs one). Nothing was changed.`);
  }
  return chosen;
}

/** The interpreter at run time: AMAUTA_PYTHON, else the one install recorded in state, else `python3`. */
export async function installedPython(env = process.env) {
  if (env.AMAUTA_PYTHON) return env.AMAUTA_PYTHON;
  const state = await readStateObject(path.join(resolveTargets({}, env).stateDir, 'state.json'));
  return typeof state?.python === 'string' && state.python ? state.python : DEFAULT_PYTHON;
}

/** The same answer without awaiting (for pure command builders); an unreadable state file means the default. */
export function installedPythonSync(env = process.env) {
  if (env.AMAUTA_PYTHON) return env.AMAUTA_PYTHON;
  try {
    const state = JSON.parse(readFileSync(path.join(resolveTargets({}, env).stateDir, 'state.json'), 'utf8'));
    return typeof state?.python === 'string' && state.python ? state.python : DEFAULT_PYTHON;
  } catch {
    return DEFAULT_PYTHON;
  }
}

/** `python -P -m <module> <args>` with amauta's PYTHONPATH, stdio passed through; resolves the exit status. */
export async function runPythonModule(module, args, io = {}) {
  const python = await installedPython();
  const env = { ...process.env, PYTHONPATH: PYTHON_PATH };
  return new Promise((resolve) => {
    const child = spawn(python, ['-P', '-m', module, ...args], { env, stdio: 'inherit', windowsHide: true });
    child.on('error', (err) => {
      (io.stderr ?? process.stderr).write(`amauta: cannot start ${python}: ${err.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
