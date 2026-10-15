import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findOnPath } from '../codegraph/index.js';

export const GRAPHIFY_HINT = 'graphify not found on PATH. Install it with: pipx install "graphifyy[sql,anthropic]" (optional code graph; the hook and `graphify semantic` need it)';
const SQL_HINT = 'reinstall with: pipx install --force "graphifyy[sql,anthropic]"';

const run = (exe, args, opts = {}) => new Promise((resolve) => {
  execFile(exe, args, { timeout: 60000, maxBuffer: 1 << 20, encoding: 'utf8', ...opts }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr }));
});

/** Run a one-table .sql fixture through `graphify update` in a throwaway temp dir (local, no LLM); true when a table node came out. */
async function sqlExtractorWorks(exe) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gl-sqlprobe-'));
  try {
    await writeFile(path.join(dir, 't.sql'), 'CREATE TABLE probe_table (id INTEGER PRIMARY KEY);\n');
    await run(exe, ['update', dir], { cwd: dir, env: { ...process.env, GRAPHIFY_QUERY_LOG_DISABLE: '1' } });
    const graph = JSON.parse(await readFile(path.join(dir, 'graphify-out', 'graph.json'), 'utf8'));
    return (graph.nodes ?? []).some((n) => String(n.source_file ?? '').toLowerCase().endsWith('.sql') && n.label !== 't.sql');
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** graphify (external, optional): where it is, its version and, only with deep, whether the [sql] extractor works. */
export async function graphifyStatus({ searchPath, deep = false } = {}) {
  const exe = await findOnPath('graphify', searchPath);
  if (!exe) return { onPath: false, path: null, version: null, sql: null, detail: GRAPHIFY_HINT };
  const v = await run(exe, ['--version'], { timeout: 10000 });
  const version = v.ok ? v.stdout.trim().split('\n')[0] || 'unknown version' : 'unknown version';
  const sql = deep ? await sqlExtractorWorks(exe) : null;
  const sqlText = sql === null ? 'not probed (use --deep)' : sql ? 'available' : `NOT available (${SQL_HINT})`;
  return { onPath: true, path: exe, version, sql, detail: `${exe}; ${version}; SQL extractor: ${sqlText}` };
}

/** The last non-empty line of the hook's log (<state>/graphify-hook.log), or null: failures the hook could not show anywhere else. */
export async function lastHookError(stateDir) {
  try {
    const lines = (await readFile(path.join(stateDir, 'graphify-hook.log'), 'utf8')).split('\n').filter((l) => l.trim() !== '');
    return lines.length ? lines[lines.length - 1].slice(0, 300) : null;
  } catch {
    return null;
  }
}
