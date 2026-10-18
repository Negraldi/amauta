import { stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveTargets } from '../install/paths.js';
import { hookBlock, hookStatus, installHook } from './hook.js';

/**
 * SessionStart hook: a git repository that already has `graphify-out/graph.json` but none of amauta's event hooks gets them
 * installed and one background refresh, so a graphify project reaches the portal without a manual step. Repos without a
 * graph, non-git directories and repos that ran `graphify hook uninstall` (opt-out) are never touched. Fails open (the
 * caller swallows errors) and never waits for the refresh.
 */
export async function graphifyConnect(payload, env = process.env, { spawner = spawn } = {}) {
  if (typeof payload?.cwd !== 'string' || payload.cwd === '') return null;
  const cwd = path.resolve(payload.cwd);
  const { root, optedOut, installed } = await hookStatus(cwd);
  if (!root || optedOut || installed) return null;
  if (!(await stat(path.join(root, 'graphify-out', 'graph.json')).then((s) => s.isFile(), () => false))) return null;
  const { stateDir } = resolveTargets({}, env);
  await installHook({ cwd: root, stateDir });
  // The hook block backgrounds itself (single-flight lock, graphify update, check-update, graph sync): running it once here
  // is exactly the refresh a commit would do. The sh that starts it exits at once.
  const child = spawner('sh', ['-c', hookBlock({ stateDir, event: 'post-commit' })], { cwd: root, env, detached: true, stdio: 'ignore' });
  child.on?.('error', () => {});
  child.unref?.();
  return null;
}
