import { readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../core/fsatomic.js';
import { gitOrNull } from '../util/git.js';
import { resolveTargets } from '../install/paths.js';

export const CLONE_FILE = 'gentle-lite-rdd-mode';

async function readState(stateDir) {
  const text = await readFile(path.join(stateDir, 'state.json'), 'utf8').catch((err) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  if (text === null) return {};
  const data = JSON.parse(text);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('state.json is not a JSON object');
  return data;
}

async function cloneFile(cwd) {
  const dir = await gitOrNull(cwd, ['rev-parse', '--absolute-git-dir']);
  return dir ? path.join(dir.trim(), CLONE_FILE) : null;
}

/** Read-only. Effective mode is on only when global is on and no clone-local "off" exists. */
export async function modeStatus({ cwd, stateDir } = {}) {
  const dir = stateDir ?? resolveTargets({}).stateDir;
  const state = await readState(dir);
  const global = state.rdd_mode === 'on' || state.rdd_mode === 'off' ? state.rdd_mode : null;
  const file = cwd ? await cloneFile(cwd) : null;
  const clone = file && (await readFile(file, 'utf8').catch(() => '')).trim() === 'off' ? 'off' : null;
  const effective = global === 'on' && clone !== 'off' ? 'on' : 'off';
  const source = clone === 'off' ? 'clone' : global === null ? 'default' : 'global';
  return { effective, source, global: global ?? 'unset', clone: clone ?? 'unset' };
}

export async function setMode(value, { scope = 'global', cwd, stateDir } = {}) {
  if (value !== 'on' && value !== 'off') throw new Error(`invalid mode: ${value}`);
  if (scope === 'clone') {
    const file = cwd ? await cloneFile(cwd) : null;
    if (!file) throw new Error('clone scope needs a git repository (use --cwd)');
    if (value === 'off') await writeFileAtomic(file, 'off\n');
    else await rm(file, { force: true });
  } else if (scope === 'global') {
    const dir = stateDir ?? resolveTargets({}).stateDir;
    const state = await readState(dir);
    await mkdir(dir, { recursive: true });
    state.rdd_mode = value;
    state.rdd_mode_recorded_at = new Date().toISOString();
    await writeFileAtomic(path.join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  } else {
    throw new Error(`invalid scope: ${scope} (expected global or clone)`);
  }
  return modeStatus({ cwd, stateDir });
}
