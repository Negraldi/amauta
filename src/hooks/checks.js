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
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { baselineFindings, checkFile, checkersFor, formatFinding, newFindings, run } from '../checks/engine.js';
import { applicable, projectFindings } from '../checks/project.js';
import { SAFE_CHECKERS } from '../checks/safe.js';
import { isTrusted, projectRoot } from '../checks/trust.js';
import { changedPaths } from '../util/git.js';
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
  const opts = { python: ctx.python, timeoutMs: 10000 };
  const shown = path.relative(cwd, file).startsWith('..') ? file : path.relative(cwd, file);
  const fresh = checkers.length
    ? newFindings(await checkFile(file, checkers, opts, shown), await baselineFindings(file, checkers, opts)) : [];
  if (fresh.length) {
    const one = fresh.length === 1;
    const count = `${fresh.length} new error${one ? '' : 's'}`;
    const title = `amauta checks: this edit left ${count} in ${shown}; fix ${one ? 'it' : 'them'} before going on:`;
    return { decision: 'block', reason: report(title, fresh) };
  }
  return oddRule(file, ctx);
}

const CHECKED = /^\s*[-*] \[[xX]\] (.+)$/;
const checkedItems = (text) => new Set(text.split('\n').map((l) => CHECKED.exec(l)?.[1].trim()).filter(Boolean));

/**
 * The ODD rule (plan D8): an edit of `odd/tasks/*.md` that checks an item off, compared with the committed version, is
 * refused while the changed files of the repository have errors (the Stop check's findings).
 */
async function oddRule(file, ctx) {
  if (!/(^|[\\/])odd[\\/]tasks[\\/][^\\/]+\.md$/.test(file)) return null;
  const root = await projectRoot(path.dirname(file));
  if (!root) return null;
  const rel = path.relative(root, file).split(path.sep).join('/');
  const head = await run('git', ['-C', root, 'show', `HEAD:${rel}`], { timeoutMs: 5000 });
  const before = head && head.code === 0 ? checkedItems(head.stdout) : new Set();
  const now = checkedItems(await readFile(file, 'utf8').catch(() => ''));
  const added = [...now].filter((item) => !before.has(item));
  if (!added.length) return null;
  const { findings, hint } = await repoFindings(root, ctx);
  if (!findings.length) return null;
  const names = added.map((item) => item.split(/\s+/)[0]).join(', ');
  const n = `${findings.length} error${findings.length === 1 ? '' : 's'}`;
  const title = `amauta checks: ${names} checked off while the changed files have ${n}; fix them, or leave the task open:`;
  return { decision: 'block', reason: report(title, findings, hint) };
}

/** Changed files of the repository (modified, added, untracked; not deleted), as absolute paths. */
const changedFiles = async (root) => (await changedPaths(root)).map((p) => path.join(root, p));

/** The Stop check's findings over every changed file: { findings, hint }. */
async function repoFindings(root, ctx) {
  const changed = await changedFiles(root);
  if (!changed.length) return { findings: [], hint: [] };
  const opts = { python: ctx.python, timeoutMs: 10000 };
  const findings = [];
  for (const file of changed.slice(0, 200)) {
    const checkers = checkersFor(file, CHECKERS);
    if (!checkers.length) continue;
    const shown = path.relative(root, file);
    findings.push(...newFindings(await checkFile(file, checkers, opts, shown), await baselineFindings(file, checkers, opts)));
  }
  const found = await applicable(root, changed, ctx.searchPath ?? process.env.PATH ?? '');
  const trusted = found.some((p) => p.checker.trust) && (await isTrusted(ctx.stateDir, root));
  const held = found.filter((p) => p.checker.trust && !trusted);
  findings.push(...(await projectFindings(root, changed, found.filter((p) => !p.checker.trust || trusted))));
  const hint = held.length
    ? [`Project checkers (${held.map((p) => p.checker.name).join(', ')}) did not run: they execute project code. `
      + 'Run `amauta check trust` in this project to allow them.']
    : [];
  return { findings, hint };
}

export async function stopCheck(payload, ctx) {
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const root = await projectRoot(cwd);
  if (!root) return null;
  const { findings, hint } = await repoFindings(root, ctx);
  if (!findings.length) return null;
  const n = `${findings.length} error${findings.length === 1 ? '' : 's'}`;
  return { decision: 'block', reason: report(`amauta checks: the changed files have ${n}; fix them before stopping:`, findings, hint) };
}
