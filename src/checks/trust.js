/**
 * Per-project trust for checkers that execute repository code (plan D6, ADR 0006): tsc, eslint, mypy and cargo load
 * the project's own configuration, plugins and build scripts, so they run only in a project the user trusted with
 * `amauta check trust`. A project is its git root (real path). Stored in `<state dir>/checks/trust.json` with the
 * sha256 of the project's `.amauta/pipelines.json` (null without one): the portal runs pipelines only while that file
 * is the one the user trusted (ADR 0011). Side effects: that file only.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../core/fsatomic.js';
import { run } from './engine.js';

const file = (stateDir) => path.join(stateDir, 'checks', 'trust.json');

/** The git root of `cwd` as a real path, or null outside a repository. */
export async function projectRoot(cwd) {
  const r = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 });
  if (!r || r.code !== 0 || !r.stdout.trim()) return null;
  return realpath(r.stdout.trim()).catch(() => null);
}

export async function trustedProjects(stateDir) {
  try {
    const data = JSON.parse(await readFile(file(stateDir), 'utf8'));
    return Array.isArray(data.projects) ? data.projects.filter((p) => typeof p?.path === 'string') : [];
  } catch {
    return [];
  }
}

export async function isTrusted(stateDir, cwd) {
  const root = await projectRoot(cwd);
  return Boolean(root) && (await trustedProjects(stateDir)).some((p) => p.path === root);
}

/** Trust or stop trusting the project that contains `cwd`; returns its root, or null outside a repository. */
export async function setTrust(stateDir, cwd, on) {
  const root = await projectRoot(cwd);
  if (!root) return null;
  const rest = (await trustedProjects(stateDir)).filter((p) => p.path !== root);
  const pipelines = await readFile(path.join(root, '.amauta', 'pipelines.json')).catch(() => null);
  const pipelinesSha = pipelines ? createHash('sha256').update(pipelines).digest('hex') : null;
  const projects = on ? [...rest, { path: root, trusted_at: new Date().toISOString(), pipelines_sha256: pipelinesSha }] : rest;
  await mkdir(path.dirname(file(stateDir)), { recursive: true });
  await writeFileAtomic(file(stateDir), `${JSON.stringify({ projects }, null, 2)}\n`);
  return root;
}
