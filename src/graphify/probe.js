import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findOnPath } from '../codegraph/index.js';

const EXTRAS_INSTALL = 'pipx install "graphifyy[sql,anthropic,pdf,office]"';
const R_INJECT = 'pipx inject graphifyy tree-sitter-language-pack';
export const GRAPHIFY_HINT = `graphify not found on PATH. Install it with: ${EXTRAS_INSTALL} then ${R_INJECT} (optional code graph; the hook and \`graphify semantic\` need it; the extras add SQL, PDF, Word and Excel, the inject adds R)`;
const SQL_HINT = 'reinstall with: pipx install --force "graphifyy[sql,anthropic,pdf,office]"';
const FORMAT_MODULES = [['r', 'R', 'tree_sitter_language_pack'], ['pdf', 'PDF', 'pypdf'], ['docx', 'DOCX', 'docx'], ['xlsx', 'XLSX', 'openpyxl']];
const PROBE_CODE = 'import importlib.util as u, sys\nfor m in sys.argv[1:]:\n    try:\n        ok = u.find_spec(m) is not None\n    except Exception:\n        ok = False\n    print(m, "ok" if ok else "missing")';

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

/** The interpreter named by the launcher's `#!` line when it is a python path, else null (no network, nothing written). */
async function launcherPython(exe) {
  try {
    const first = (await readFile(exe, 'utf8')).split('\n', 1)[0].trim();
    if (!first.startsWith('#!')) return null;
    const interp = first.slice(2).trim().split(/\s+/)[0];
    return /^\/.*python[\d.]*$/.test(interp) ? interp : null;
  } catch {
    return null;
  }
}

/** Per-format availability (R, PDF, DOCX, XLSX): an import probe with graphify's own interpreter; every value is null when it cannot be probed. */
async function formatSupport(exe) {
  const unknown = Object.fromEntries(FORMAT_MODULES.map(([k]) => [k, null]));
  const py = await launcherPython(exe);
  if (!py) return unknown;
  const r = await run(py, ['-I', '-c', PROBE_CODE, ...FORMAT_MODULES.map((f) => f[2])], { timeout: 20000 });
  if (!r.ok) return unknown;
  const seen = Object.fromEntries(r.stdout.split('\n').map((l) => l.trim().split(' ')).filter((p) => p.length === 2));
  return Object.fromEntries(FORMAT_MODULES.map(([k, , mod]) => [k, seen[mod] === 'ok' ? true : seen[mod] === 'missing' ? false : null]));
}

function formatsText(formats) {
  const parts = FORMAT_MODULES.map(([k, label]) => `${label}: ${formats[k] === null ? 'unknown' : formats[k] ? 'available' : 'NOT available'}`);
  const fixes = [];
  if (formats.r === false) fixes.push(R_INJECT);
  if (['pdf', 'docx', 'xlsx'].some((k) => formats[k] === false)) fixes.push(`pipx install --force "graphifyy[sql,anthropic,pdf,office]"`);
  return parts.join(', ') + (fixes.length ? ` (fix with: ${fixes.join(' ; ')})` : '');
}

/** graphify (external, optional): where it is, its version and, only with deep, whether the [sql] extractor works and which of R/PDF/DOCX/XLSX are supported. */
export async function graphifyStatus({ searchPath, deep = false } = {}) {
  const exe = await findOnPath('graphify', searchPath);
  if (!exe) return { onPath: false, path: null, version: null, sql: null, formats: null, detail: GRAPHIFY_HINT };
  const v = await run(exe, ['--version'], { timeout: 10000 });
  const version = v.ok ? v.stdout.trim().split('\n')[0] || 'unknown version' : 'unknown version';
  const sql = deep ? await sqlExtractorWorks(exe) : null;
  const sqlText = sql === null ? 'not probed (use --deep)' : sql ? 'available' : `NOT available (${SQL_HINT})`;
  const formats = deep ? await formatSupport(exe) : null;
  const fmtText = formats ? `; ${formatsText(formats)}` : '';
  return { onPath: true, path: exe, version, sql, formats, detail: `${exe}; ${version}; SQL extractor: ${sqlText}${fmtText}` };
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
