/**
 * Checkers that never execute repository code (plan D5, ADR 0006): syntax only. JSON in this process; JavaScript with
 * `node --check`; Python with `ast.parse` and TOML with `tomllib` in the recorded interpreter (`ctx.python`); shell
 * scripts with `bash -n` (or `sh -n`); secret-like values in any file through `amauta.detectors`. Each returns
 * [{ line, col, message }]; a checker that cannot start returns [].
 */
import { readFile } from 'node:fs/promises';
import { PYTHON_PATH } from '../install/servers.js';
import { run } from './engine.js';

const PY_SYNTAX = [
  'import ast, json, sys',
  'p = sys.argv[1]',
  'try:',
  '    ast.parse(open(p, "rb").read(), p)',
  'except SyntaxError as e:',
  '    print(json.dumps({"line": e.lineno or 1, "col": e.offset or 1, "message": e.msg}))',
].join('\n');
const PY_TOML = [
  'import json, re, sys, tomllib',
  'try:',
  '    tomllib.loads(open(sys.argv[1], encoding="utf-8").read())',
  'except tomllib.TOMLDecodeError as e:',
  '    m = re.search(r"\\(at line (\\d+), column (\\d+)\\)", str(e))',
  '    msg = re.sub(r"\\s*\\(at line \\d+, column \\d+\\)", "", str(e))',
  '    print(json.dumps({"line": int(m.group(1)) if m else 1, "col": int(m.group(2)) if m else 1, "message": msg}))',
].join('\n');

const lineCol = (text, pos) => {
  const before = text.slice(0, pos).split('\n');
  return { line: before.length, col: before.at(-1).length + 1 };
};

async function pythonJson(code, file, ctx) {
  const r = await run(ctx.python ?? 'python3', ['-P', '-c', code, file], { timeoutMs: ctx.timeoutMs });
  if (!r || r.code !== 0 || !r.stdout.trim()) return [];
  try { return [JSON.parse(r.stdout.trim().split('\n').at(-1))]; } catch { return []; }
}

export const json = {
  name: 'json', exts: ['.json'],
  run: async (file) => {
    const text = await readFile(file, 'utf8');
    try { JSON.parse(text); return []; } catch (err) {
      const msg = String(err.message);
      const lc = /line (\d+) column (\d+)/.exec(msg);
      const pos = /position (\d+)/.exec(msg);
      const at = lc ? { line: Number(lc[1]), col: Number(lc[2]) } : pos ? lineCol(text, Number(pos[1])) : { line: 1, col: 1 };
      return [{ ...at, message: msg.replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '') }];
    }
  },
};

export const node = {
  name: 'node', exts: ['.js', '.mjs', '.cjs'],
  run: async (file, ctx) => {
    const r = await run(process.execPath, ['--check', file], { timeoutMs: ctx.timeoutMs });
    if (!r || r.code === 0) return [];
    const lines = r.stderr.split('\n');
    const line = Number((/:(\d+)\s*$/.exec(lines[0] ?? '') ?? [])[1]) || 1;
    const caret = lines.findIndex((l) => /^\s*\^+\s*$/.test(l));
    const message = lines.find((l) => /^\w*Error: /.test(l)) ?? 'syntax error';
    return [{ line, col: caret > 0 ? lines[caret].indexOf('^') + 1 : 1, message: message.replace(/^\w*Error: /, '') }];
  },
};

export const python = { name: 'python', exts: ['.py'], run: (file, ctx) => pythonJson(PY_SYNTAX, file, ctx) };
export const toml = { name: 'toml', exts: ['.toml'], run: (file, ctx) => pythonJson(PY_TOML, file, ctx) };

export const sh = {
  name: 'sh', exts: ['.sh', '.bash'],
  run: async (file, ctx) => {
    const limit = { timeoutMs: ctx.timeoutMs };
    const r = (await run('bash', ['-n', file], limit)) ?? (await run('sh', ['-n', file], limit));
    if (!r || r.code === 0) return [];
    return r.stderr.split('\n').filter(Boolean).slice(0, 5).map((l) => {
      const m = /line (\d+): (.*)$/.exec(l);
      return { line: m ? Number(m[1]) : 1, col: 1, message: m ? m[2] : l };
    });
  },
};

/** Secret-like values in any text file, through the kernel detector catalog (plan D7); the value is never printed. */
export const secrets = {
  name: 'secrets', exts: ['*'],
  run: async (file, ctx) => {
    const env = { ...process.env, PYTHONPATH: PYTHON_PATH };
    const r = await run(ctx.python ?? 'python3', ['-P', '-m', 'amauta.detectors', 'secrets', file], { timeoutMs: ctx.timeoutMs, env });
    if (!r || r.code !== 0) return [];
    try { return JSON.parse(r.stdout); } catch { return []; }
  },
};

export const SAFE_CHECKERS = [json, node, python, toml, sh, secrets];
