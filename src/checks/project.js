/**
 * Checkers that run at Stop over the changed files (plan D6, D7, ADR 0006): project checkers that execute repository
 * code (trusted projects only) and security scanners that only read it. Each applies when its marker file is at the
 * project root (if it has markers) and a changed file has one of its extensions; the binary comes from
 * `node_modules/.bin` or PATH, never installed. Output becomes findings; only changed files are reported.
 */
import { access } from 'node:fs/promises';
import path from 'node:path';
import { findOnPath } from '../core/platform.js';
import { appliesTo, run } from './engine.js';

const BUDGET_MS = 40000; // all project checkers together: the Stop hook has 60 s for everything it runs
const exists = (p) => access(p).then(() => true, () => false);

// `trust: true` executes project code (configuration, plugins, build scripts): only in projects the user trusted.
// `trust: false` reads code only. No markers means the checker applies wherever its file types changed.
export const PROJECT_CHECKERS = [
  { name: 'tsc', trust: true, markers: ['tsconfig.json'], exts: ['.ts', '.tsx', '.mts', '.cts'],
    args: () => ['--noEmit', '--pretty', 'false'],
    re: /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+: .*)$/, pick: (m) => [m[1], m[2], m[3], m[4], m[5]] },
  { name: 'eslint', trust: true,
    markers: ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'],
    exts: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'], args: (files) => ['--format', 'unix', ...files],
    re: /^(.+?):(\d+):(\d+): (.*)$/, pick: (m) => [m[1], m[2], m[3], 'error', m[4]] },
  { name: 'mypy', trust: true, markers: ['mypy.ini', '.mypy.ini'], exts: ['.py'],
    args: (files) => ['--no-color-output', '--show-column-numbers', '--no-error-summary', ...files],
    re: /^(.+?):(\d+):(\d+): (error): (.*)$/, pick: (m) => [m[1], m[2], m[3], m[4], m[5]] },
  { name: 'cargo', trust: true, markers: ['Cargo.toml'], exts: ['.rs'], args: () => ['check', '--message-format', 'short', '--quiet'],
    re: /^(.+?):(\d+):(\d+): (error)(?:\[(\w+)\])?: (.*)$/, pick: (m) => [m[1], m[2], m[3], m[4], m[5] ? `${m[5]}: ${m[6]}` : m[6]] },
  // Security scanners (plan D7): read code only. gitleaks redacts what it finds; semgrep uses the project's own rules
  // with metrics off, so nothing goes to the network.
  { name: 'gitleaks', trust: false, markers: [], exts: ['*'], perFile: true,
    args: (file) => ['dir', file, '--no-banner', '--redact', '--report-format', 'json', '--report-path', '-', '--exit-code', '0'],
    json: (r) => [r.File, r.StartLine, r.StartColumn, 'error', `${r.RuleID}: ${r.Description}`] },
  { name: 'bandit', trust: false, markers: [], exts: ['.py'],
    args: (files) => ['-q', '-f', 'custom', '--msg-template', '{abspath}:{line}:{col}: {test_id} {msg}', ...files],
    re: /^(.+?):(\d+):(\d+): (B\d+ .*)$/, pick: (m) => [m[1], m[2], Number(m[3]) + 1, 'error', m[4]] },
  { name: 'semgrep', trust: false, markers: ['.semgrep.yml', '.semgrep.yaml', '.semgrep'], exts: ['*'],
    args: (files, marker) => ['scan', '--config', marker, '--metrics=off', '--quiet', '--emacs', ...files],
    re: /^(.+?):(\d+):(\d+):(\w+)\(([^)]*)\):(.*)$/,
    pick: (m) => [m[1], m[2], m[3], m[4] === 'error' ? 'error' : 'warning', `${m[5]}: ${m[6]}`] },
];

const finding = ([file, l, c, severity, message]) => ({ file, line: Number(l), col: Number(c), severity, message });

export function parseLine(checker, line) {
  const m = checker.re.exec(line.trim());
  return m ? finding(checker.pick(m)) : null;
}

/** All findings of one run: a JSON report (gitleaks) or one finding per matching line. */
export function parseOutput(checker, text) {
  if (!checker.json) return text.split('\n').map((l) => parseLine(checker, l)).filter(Boolean);
  try {
    const rows = JSON.parse(text.trim() || '[]');
    return Array.isArray(rows) ? rows.map((r) => finding(checker.json(r))) : [];
  } catch {
    return [];
  }
}

/** The checkers that apply to `changed` (absolute paths) and are installed: [{ checker, exe, marker }]. */
export async function applicable(root, changed, searchPath) {
  const out = [];
  for (const c of PROJECT_CHECKERS) {
    if (!changed.some((f) => appliesTo(c, f))) continue;
    const present = await Promise.all(c.markers.map(async (m) => ((await exists(path.join(root, m))) ? path.join(root, m) : null)));
    const marker = c.markers.length ? present.find(Boolean) : root;
    if (!marker) continue;
    const exe = await findOnPath(c.name, [path.join(root, 'node_modules', '.bin'), searchPath].join(path.delimiter));
    if (exe) out.push({ checker: c, exe, marker });
  }
  return out;
}

/** Run the applicable checkers; findings in changed files only, file names relative to the root. */
export async function projectFindings(root, changed, found) {
  const wanted = new Set(changed.map((f) => path.resolve(f)));
  const out = [];
  const deadline = Date.now() + BUDGET_MS;
  for (const { checker, exe, marker } of found) {
    const files = changed.filter((f) => appliesTo(checker, f)).map((f) => path.relative(root, f));
    for (const args of checker.perFile ? files.map((f) => checker.args(f)) : [checker.args(files, marker)]) {
      const left = deadline - Date.now();
      if (left < 1000) break;
      const r = await run(exe, args, { cwd: root, timeoutMs: left });
      if (!r) continue;
      for (const f of parseOutput(checker, checker.json ? r.stdout : `${r.stdout}\n${r.stderr}`)) {
        const abs = path.resolve(root, f.file);
        if (wanted.has(abs)) out.push({ ...f, file: path.relative(root, abs), checker: checker.name });
      }
    }
  }
  return out;
}
