/**
 * Project checkers that execute repository code (plan D6, ADR 0006), run at Stop in trusted projects only. Each one
 * applies when its marker file is at the project root and a changed file has one of its extensions; the binary comes
 * from `node_modules/.bin` or PATH, never installed. Output lines become findings; only changed files are reported.
 */
import { access } from 'node:fs/promises';
import path from 'node:path';
import { findOnPath } from '../core/platform.js';
import { run } from './engine.js';

const BUDGET_MS = 40000; // all project checkers together: the Stop hook has 60 s for everything it runs
const exists = (p) => access(p).then(() => true, () => false);

export const PROJECT_CHECKERS = [
  { name: 'tsc', markers: ['tsconfig.json'], exts: ['.ts', '.tsx', '.mts', '.cts'],
    args: () => ['--noEmit', '--pretty', 'false'],
    re: /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+: .*)$/, pick: (m) => [m[1], m[2], m[3], m[4], m[5]] },
  { name: 'eslint',
    markers: ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'],
    exts: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'], args: (files) => ['--format', 'unix', ...files],
    re: /^(.+?):(\d+):(\d+): (.*)$/, pick: (m) => [m[1], m[2], m[3], 'error', m[4]] },
  { name: 'mypy', markers: ['mypy.ini', '.mypy.ini'], exts: ['.py'],
    args: (files) => ['--no-color-output', '--show-column-numbers', '--no-error-summary', ...files],
    re: /^(.+?):(\d+):(\d+): (error): (.*)$/, pick: (m) => [m[1], m[2], m[3], m[4], m[5]] },
  { name: 'cargo', markers: ['Cargo.toml'], exts: ['.rs'], args: () => ['check', '--message-format', 'short', '--quiet'],
    re: /^(.+?):(\d+):(\d+): (error)(?:\[(\w+)\])?: (.*)$/, pick: (m) => [m[1], m[2], m[3], m[4], m[5] ? `${m[5]}: ${m[6]}` : m[6]] },
];

export function parseLine(checker, line) {
  const m = checker.re.exec(line.trim());
  if (!m) return null;
  const [file, l, c, severity, message] = checker.pick(m);
  return { file, line: Number(l), col: Number(c), severity, message };
}

/** The project checkers that apply to `changed` (absolute paths) and are installed: [{ checker, exe }]. */
export async function applicable(root, changed, searchPath) {
  const out = [];
  for (const c of PROJECT_CHECKERS) {
    if (!changed.some((f) => c.exts.includes(path.extname(f).toLowerCase()))) continue;
    if (!(await Promise.all(c.markers.map((m) => exists(path.join(root, m))))).some(Boolean)) continue;
    const exe = await findOnPath(c.name, [path.join(root, 'node_modules', '.bin'), searchPath].join(path.delimiter));
    if (exe) out.push({ checker: c, exe });
  }
  return out;
}

/** Run the applicable checkers; findings in changed files only, file names relative to the root. */
export async function projectFindings(root, changed, found) {
  const wanted = new Set(changed.map((f) => path.resolve(f)));
  const out = [];
  const deadline = Date.now() + BUDGET_MS;
  for (const { checker, exe } of found) {
    const left = deadline - Date.now();
    if (left < 1000) break;
    const files = changed.filter((f) => checker.exts.includes(path.extname(f).toLowerCase())).map((f) => path.relative(root, f));
    const r = await run(exe, checker.args(files), { cwd: root, timeoutMs: left });
    if (!r) continue;
    for (const line of `${r.stdout}\n${r.stderr}`.split('\n')) {
      const f = parseLine(checker, line);
      const abs = f ? path.resolve(root, f.file) : null;
      if (abs && wanted.has(abs)) out.push({ ...f, file: path.relative(root, abs), checker: checker.name });
    }
  }
  return out;
}
