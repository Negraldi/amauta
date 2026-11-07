/**
 * Simplicity measurements for the ratchet (ADR 0004).
 *
 * Input: the repository root. Output: per-file metrics for authored source files: line count, lines longer than
 * LIMITS.line, the longest function (heuristic: brace matching for JS, indentation for Python) and whether the file
 * opens with a header comment. Vendored files are skipped. Side effects: none (reads files). Run directly with
 * `node scripts/dev/simplicity.mjs --write` to rewrite test/simplicity-baseline.json from the current tree.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = { file: 400, function: 60, line: 140, readme: 200 };
const CODE = /\.(m?js|py|css|html)$/;
const ROOTS = ['bin', 'src', 'python/amauta', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git', 'fonts']);
const VENDORED = [/mermaid\.min\.js$/];

export function authoredFiles(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (CODE.test(e.name) && !VENDORED.some((v) => v.test(child))) out.push(child);
    }
  };
  for (const r of ROOTS) walk(r);
  return out.sort();
}

const JS_FN = new RegExp([
  /^\s*(export\s+)?(default\s+)?(async\s+)?function\b/.source, // declarations
  /=>\s*\{\s*$/.source, // arrow functions with a block body
  /^\s*(static\s+)?(async\s+)?(get\s+|set\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{\s*$/.source, // methods
].join('|'));
const JS_NOT_FN = /^\s*(if|for|while|switch|catch|with|return)\b/;

function longestJsFunction(lines) {
  let max = 0;
  lines.forEach((line, i) => {
    if (!JS_FN.test(line) || JS_NOT_FN.test(line)) return;
    let depth = 0;
    let opened = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') [depth, opened] = [depth + 1, true];
        else if (ch === '}') depth--;
      }
      if (opened && depth <= 0) {
        max = Math.max(max, j - i + 1);
        return;
      }
    }
  });
  return max;
}

function longestPyFunction(lines) {
  let max = 0;
  const indent = (l) => l.length - l.trimStart().length;
  lines.forEach((line, i) => {
    const m = /^(\s*)(async\s+)?def\s/.exec(line);
    if (!m) return;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (indent(lines[j]) <= m[1].length) break;
      end = j;
    }
    max = Math.max(max, end - i + 1);
  });
  return max;
}

function hasHeader(rel, text) {
  const body = text.replace(/^#![^\n]*\n/, '').trimStart();
  if (rel.endsWith('.py')) return body.startsWith('"""') || body.startsWith("'''") || body.startsWith('#');
  if (rel.endsWith('.html')) return body.startsWith('<!--') || /^<!doctype html>\s*<!--/i.test(body);
  return body.startsWith('//') || body.startsWith('/*');
}

export function measure(root, rel) {
  const text = readFileSync(path.join(root, rel), 'utf8');
  const lines = text.replace(/\n$/, '').split('\n');
  const fn = rel.endsWith('.py') ? longestPyFunction(lines) : /\.m?js$/.test(rel) ? longestJsFunction(lines) : 0;
  return { lines: lines.length, long: lines.filter((l) => l.length > LIMITS.line).length, fn, header: hasHeader(rel, text) };
}

/** Only the metrics that break a limit; an empty object means the file is within every limit. */
export function overLimits(m) {
  const out = {};
  if (m.lines > LIMITS.file) out.lines = m.lines;
  if (m.long > 0) out.long = m.long;
  if (m.fn > LIMITS.function) out.fn = m.fn;
  if (!m.header) out.noHeader = true;
  return out;
}

export function readmeLines(root) {
  return readFileSync(path.join(root, 'README.md'), 'utf8').replace(/\n$/, '').split('\n').length;
}

export function currentBaseline(root) {
  const files = {};
  for (const rel of authoredFiles(root)) {
    const over = overLimits(measure(root, rel));
    if (Object.keys(over).length) files[rel] = over;
  }
  return { schema: 'amauta.simplicity-baseline/v1', limits: LIMITS, readme: readmeLines(root), files };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  writeFileSync(path.join(root, 'test', 'simplicity-baseline.json'), `${JSON.stringify(currentBaseline(root), null, 1)}\n`);
}
