import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../core/fsatomic.js';
import { resolveTargets } from '../install/paths.js';
import { gitOrNull } from '../util/git.js';
import { assess } from './assess.js';
import { modeStatus } from './mode.js';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

/** Returns null when `cwd` is not inside a git repository. A repository without commits has head: null. */
async function snapshot(cwd) {
  if ((await gitOrNull(cwd, ['rev-parse', '--git-dir'])) === null) return null;
  const head = (await gitOrNull(cwd, ['rev-parse', '--verify', '-q', 'HEAD']))?.trim() ?? null;
  const diff = (await gitOrNull(cwd, ['diff', '--no-color', '--no-renames', head ?? '--cached', '--'])) ?? '';
  return { head, diff_hash: sha1(diff) };
}

const baselineFile = (stateDir, sessionId) =>
  path.join(stateDir, 'review-stop', `${String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);

const readBaseline = (file) => readFile(file, 'utf8').then((t) => JSON.parse(t), () => null);

async function writeBaseline(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(data)}\n`);
}

/**
 * SessionStart stores the baseline; Stop blocks once per candidate when RDD is on and a
 * review is due. Returns the hook decision object or null (no-op).
 */
export async function reviewStop(payload, env = process.env) {
  const { session_id: sessionId, cwd, hook_event_name: event } = payload;
  if (!sessionId || !cwd) return null;
  const { stateDir } = resolveTargets({}, env);
  const file = baselineFile(stateDir, sessionId);

  if (event === 'SessionStart') {
    const snap = await snapshot(cwd);
    if (!snap) return null; // not a git repository: nothing to review
    // resume/compact continue the same session: keep its baseline so earlier changes stay reviewable.
    const rebaseline = payload.source === 'startup' || payload.source === 'clear';
    if (!rebaseline && (await readBaseline(file))) return null;
    await writeBaseline(file, { ...snap, notified: [] });
    return null;
  }
  if (event !== 'Stop' || payload.stop_hook_active) return null;

  const base = await readBaseline(file);
  if (!base) return null;
  const now = await snapshot(cwd);
  if (!now) return null;
  if (now.head === base.head && now.diff_hash === base.diff_hash) return null;
  if ((await modeStatus({ cwd, stateDir })).effective !== 'on') return null;

  const result = await assess({ cwd, baseRef: base.head ?? undefined });
  if (!result.review_due) return null;
  const key = `${now.head}:${now.diff_hash}`;
  if (base.notified?.includes(key)) return null;
  await writeBaseline(file, { ...base, notified: [...(base.notified ?? []), key] });
  return {
    decision: 'block',
    reason: `Receipt-driven development is on and this session's changes need review (${result.risk} risk: ${result.review_due_reason}, ${result.changed_lines} changed lines). Run \`gentle-lite review assess --cwd ${cwd}\` and review the candidate before finishing.`,
  };
}
