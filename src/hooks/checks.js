/**
 * The edit check (plan D5, ADR 0006): after Claude edits a file, the safe checkers for its type run, and the errors the
 * edit added (against the committed version) come back as one block with compiler-style lines, so the agent fixes them
 * in the same turn. Input: the PostToolUse payload. Output: a decision or null. Fails open: a checker that cannot run
 * is skipped. Entry layer: composes the kernel engine with the code-security pillar's Mermaid checker.
 */
import path from 'node:path';
import { baselineFindings, checkFile, checkersFor, formatFinding, newFindings } from '../checks/engine.js';
import { SAFE_CHECKERS } from '../checks/safe.js';
import { mermaidChecker } from '../mermaid/check.js';

export const EDIT_TOOLS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const CHECKERS = [...SAFE_CHECKERS, mermaidChecker];
const MAX_LINES = 20;

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
  const lines = fresh.slice(0, MAX_LINES).map((f) => formatFinding({ ...f, file: shown }));
  const more = fresh.length > MAX_LINES ? [`... and ${fresh.length - MAX_LINES} more`] : [];
  const one = fresh.length === 1;
  const count = `${fresh.length} new error${one ? '' : 's'}`;
  const head = `amauta checks: this edit left ${count} in ${shown}; fix ${one ? 'it' : 'them'} before going on:`;
  const reason = [head, ...lines, ...more].join('\n');
  return { decision: 'block', reason };
}
