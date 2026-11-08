/**
 * The edit check (plan D5, ADR 0006): after Claude edits a file, the safe checkers for its type run, and the errors the
 * edit added (against the committed version) come back as one block with compiler-style lines, so the agent fixes them
 * in the same turn. Input: the PostToolUse payload. Output: a decision or null. Fails open: a checker that cannot run
 * is skipped. Entry layer: composes the kernel engine with the code-security pillar's Mermaid checker.
 *
 * The Stop check (plan D6) runs the same safe checkers over every changed file of the repository (edits made through
 * the shell or by Codex included) and, in a project the user trusted, the project checkers (tsc, eslint, mypy, cargo).
 * Only changed files are reported; the shared Stop policy caps the blocks per turn.
 */
import path from 'node:path';
import { baselineFindings, checkFile, checkersFor, formatFinding, newFindings, run } from '../checks/engine.js';
import { applicable, projectFindings } from '../checks/project.js';
import { SAFE_CHECKERS } from '../checks/safe.js';
import { isTrusted, projectRoot } from '../checks/trust.js';
import { mermaidChecker } from '../mermaid/check.js';

export const EDIT_TOOLS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const CHECKERS = [...SAFE_CHECKERS, mermaidChecker];
const MAX_LINES = 20;

const report = (title, findings, tail = []) => {
  const lines = findings.slice(0, MAX_LINES).map(formatFinding);
  const more = findings.length > MAX_LINES ? [`... and ${findings.length - MAX_LINES} more`] : [];
  return [title, ...lines, ...more, ...tail].join('\n');
};

export async function editCheck(payload, ctx) {
  const key = EDIT_TOOLS[payload.tool_name];
  const target = key ? payload.tool_input?.[key] : null;
  if (typeof target !== 'string' || !target) return null;
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const file = path.resolve(cwd, target);
  const checkers = checkersFor(file, CHECKERS);
  if (!checkers.length) return null;
  const opts = { python: ctx.python, timeoutMs: 10000 };
  const shown = path.relative(cwd, file).startsWith('..') ? file : path.relative(cwd, file);
  const fresh = newFindings(await checkFile(file, checkers, opts, shown), await baselineFindings(file, checkers, opts));
  if (!fresh.length) return null;
  const one = fresh.length === 1;
  const count = `${fresh.length} new error${one ? '' : 's'}`;
  const title = `amauta checks: this edit left ${count} in ${shown}; fix ${one ? 'it' : 'them'} before going on:`;
  return { decision: 'block', reason: report(title, fresh) };
}

/** Changed files of the repository (modified, added, untracked; not deleted), as absolute paths. */
async function changedFiles(root) {
  const r = await run('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { timeoutMs: 10000 });
  if (!r || r.code !== 0) return [];
  const parts = r.stdout.split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    if (entry[0] === 'R' || entry[0] === 'C') i++; // the next part is the old name
    if (entry[0] !== 'D' && entry[1] !== 'D') out.push(path.join(root, entry.slice(3)));
  }
  return out;
}

export async function stopCheck(payload, ctx) {
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const root = await projectRoot(cwd);
  if (!root) return null;
  const changed = await changedFiles(root);
  if (!changed.length) return null;
  const opts = { python: ctx.python, timeoutMs: 10000 };
  const findings = [];
  for (const file of changed.slice(0, 200)) {
    const checkers = checkersFor(file, CHECKERS);
    if (!checkers.length) continue;
    const shown = path.relative(root, file);
    findings.push(...newFindings(await checkFile(file, checkers, opts, shown), await baselineFindings(file, checkers, opts)));
  }
  const project = await applicable(root, changed, ctx.searchPath ?? process.env.PATH ?? '');
  const trusted = project.length > 0 && (await isTrusted(ctx.stateDir, root));
  if (trusted) findings.push(...(await projectFindings(root, changed, project)));
  if (!findings.length) return null;
  const hint = project.length && !trusted
    ? [`Project checkers (${project.map((p) => p.checker.name).join(', ')}) did not run: they execute project code. `
      + 'Run `amauta check trust` in this project to allow them.']
    : [];
  const n = `${findings.length} error${findings.length === 1 ? '' : 's'}`;
  return { decision: 'block', reason: report(`amauta checks: the changed files have ${n}; fix them before stopping:`, findings, hint) };
}
