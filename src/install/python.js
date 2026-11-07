/**
 * The Python interpreter amauta's hooks and memory server use (plan N8, ADR 0003).
 *
 * Resolution: `--python` > AMAUTA_PYTHON > the one a previous install recorded > `python3`. A chosen interpreter is
 * checked once with `-c` to be at least 3.11; the default is not probed (as before 0.5). Side effects: one short
 * child process when an interpreter was chosen. Failure mode: throws before anything is written.
 */
import { spawnSync } from 'node:child_process';
import { DEFAULT_PYTHON } from './servers.js';

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
