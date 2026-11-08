/**
 * The checks engine (plan D5, ADR 0006): one finding format and the baseline rule.
 *
 * A checker is { name, exts, run(file, ctx) -> [{ line, col, message, severity? }] }. `checkFile` runs the checkers
 * that apply, each under a time limit; a checker that fails or overruns is skipped (fail open). A finding is
 * { file, line, col, severity, message, checker } and prints as `file:line:col: severity: message [checker]`.
 * `baselineFindings` checks the file's last committed version (`git show HEAD:<file>`) in a temp directory, so an
 * edit is judged only by the errors it added. Side effects: temp files, removed afterwards; child processes of the
 * checkers. No network.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const formatFinding = (f) => `${f.file}:${f.line}:${f.col}: ${f.severity}: ${f.message} [${f.checker}]`;

export const checkersFor = (file, checkers) => checkers.filter((c) => c.exts.includes(path.extname(file).toLowerCase()));

/** Findings of `current` not covered by `baseline`, matched by checker and message (lines move when code is edited). */
export function newFindings(current, baseline) {
  const left = new Map();
  for (const f of baseline) left.set(`${f.checker}\0${f.message}`, (left.get(`${f.checker}\0${f.message}`) ?? 0) + 1);
  return current.filter((f) => {
    const k = `${f.checker}\0${f.message}`;
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    return n === 0;
  });
}

const within = (promise, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
});

export async function checkFile(file, checkers, ctx = {}, shownAs = file) {
  const out = [];
  for (const c of checkers) {
    const found = await within(Promise.resolve().then(() => c.run(file, ctx)), ctx.timeoutMs ?? 10000);
    for (const f of found ?? []) {
      const { line = 1, col = 1, severity = 'error' } = f;
      out.push({ file: shownAs, line, col, severity, message: String(f.message), checker: c.name });
    }
  }
  return out;
}

/** Run a command; resolves { code, stdout, stderr }, or null when it cannot start. Never rejects. */
export function run(command, args, { timeoutMs = 10000, cwd } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, timeoutMs);
    child.stdout.on('data', (b) => { if (stdout.length < 65536) stdout += b; });
    child.stderr.on('data', (b) => { if (stderr.length < 65536) stderr += b; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** The findings of the committed version of `file`; [] when the file is new or not in a git repository. */
export async function baselineFindings(file, checkers, ctx = {}) {
  const dir = path.dirname(file);
  const top = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 });
  if (!top || top.code !== 0) return [];
  const rel = path.relative(top.stdout.trim(), file).split(path.sep).join('/');
  const head = await run('git', ['-C', top.stdout.trim(), 'show', `HEAD:${rel}`], { timeoutMs: 5000 });
  if (!head || head.code !== 0) return [];
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'amauta-checks-'));
  try {
    const copy = path.join(tmp, path.basename(file));
    await writeFile(copy, head.stdout);
    return await checkFile(copy, checkers, ctx, file);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
