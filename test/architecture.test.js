// Architecture test (ADR 0001): every source file belongs to exactly one module of MODULES.json, and imports between
// modules follow the layer rules, except the recorded exceptions, which may only shrink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(path.join(root, 'MODULES.json'), 'utf8'));
const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git']);

/** Repository-relative POSIX paths of every file under the registry roots. */
function sourceFiles() {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(child);
      else if (!e.name.endsWith('.pyc')) out.push(child);
    }
  };
  for (const r of registry.roots) walk(r.replace(/\/$/, ''));
  return out;
}

/** The module whose longest path prefix matches `rel`, or null; throws when two modules claim the same prefix. */
function moduleOf(rel) {
  let best = null;
  let bestLen = -1;
  for (const m of registry.modules) {
    for (const p of m.paths) {
      if (!(rel === p || rel.startsWith(p))) continue;
      if (p.length === bestLen && best.id !== m.id) throw new Error(`${rel}: claimed by ${best.id} and ${m.id}`);
      if (p.length > bestLen) [best, bestLen] = [m, p.length];
    }
  }
  return best;
}

const JS_IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const PY_IMPORT = /^\s*from\s+(\.+[\w.]*|amauta[\w.]*)\s+import\s/gm;

/** Resolved repository-relative targets of the relative imports in one source file. */
function importsOf(rel) {
  const text = readFileSync(path.join(root, rel), 'utf8');
  const dir = path.posix.dirname(rel);
  const out = [];
  if (/\.(m?js)$/.test(rel)) {
    for (const [, spec] of text.matchAll(JS_IMPORT)) out.push(path.posix.normalize(path.posix.join(dir, spec)));
  } else if (rel.endsWith('.py')) {
    for (const [, spec] of text.matchAll(PY_IMPORT)) {
      if (spec.startsWith('.')) {
        const dots = spec.length - spec.replace(/^\.+/, '').length;
        let base = dir;
        for (let i = 1; i < dots; i++) base = path.posix.dirname(base);
        const rest = spec.slice(dots);
        out.push(rest ? `${base}/${rest.split('.').join('/')}` : `${base}/__init__.py`);
      } else {
        out.push(`python/${spec.split('.').join('/')}`);
      }
    }
  }
  return out;
}

/** Module of an import target: the target as a file, as a package `__init__.py`, or as a `.py` module. */
function targetModule(target) {
  for (const candidate of [target, `${target}.py`, `${target}/__init__.py`, `${target}/`]) {
    const m = moduleOf(candidate);
    if (m) return m;
  }
  return null;
}

const vendored = registry.modules.filter((m) => m.vendored).flatMap((m) => m.paths);
const isVendored = (rel) => vendored.some((p) => rel.startsWith(p)) || rel.endsWith('mermaid.min.js');

test('every source file belongs to exactly one registered module', () => {
  const orphans = sourceFiles().filter((rel) => moduleOf(rel) === null);
  assert.deepEqual(orphans, [], 'files without a module in MODULES.json');
});

test('every registered module path exists and every layer is defined', () => {
  const files = sourceFiles();
  for (const m of registry.modules) {
    assert.ok(registry.layers[m.layer], `${m.id}: unknown layer ${m.layer}`);
    for (const p of m.paths) assert.ok(files.some((f) => f === p || f.startsWith(p)), `${m.id}: ${p} matches no file`);
  }
});

test('imports between modules follow the layer rules or a recorded exception, and no exception is stale', () => {
  const byId = new Map(registry.modules.map((m) => [m.id, m]));
  const allowedException = new Set(registry.exceptions.map((e) => `${e.from}->${e.to}`));
  const violations = new Set();
  const usedExceptions = new Set();
  for (const rel of sourceFiles()) {
    if (isVendored(rel)) continue;
    const from = moduleOf(rel);
    for (const target of importsOf(rel)) {
      const to = targetModule(target);
      if (!to || to.id === from.id) continue;
      if (registry.layers[from.layer].imports.includes(to.layer)) continue;
      const key = `${from.id}->${to.id}`;
      if (allowedException.has(key)) usedExceptions.add(key);
      else violations.add(`${rel} (${from.layer} ${from.id}) imports ${target} (${to.layer} ${to.id})`);
    }
  }
  assert.deepEqual([...violations], [], 'layer violations');
  assert.deepEqual([...allowedException].filter((k) => !usedExceptions.has(k)), [], 'stale exceptions: remove them from MODULES.json');
  for (const e of registry.exceptions) assert.ok(byId.has(e.from) && byId.has(e.to) && e.why, `exception ${e.from}->${e.to} needs known modules and a reason`);
});

test('docs/modules.md documents every registered module', () => {
  const doc = readFileSync(path.join(root, 'docs', 'modules.md'), 'utf8');
  const missing = registry.modules.filter((m) => !doc.includes(`\`${m.id}\``)).map((m) => m.id);
  assert.deepEqual(missing, []);
});
