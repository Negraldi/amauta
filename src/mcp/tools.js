import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { refreshRegistry } from '../registry/skill-registry.js';
import { assess } from '../review/assess.js';
import { modeStatus } from '../review/mode.js';

export class ToolInputError extends Error {}

const cwdSchema = { cwd: { type: 'string', description: 'Absolute path of the project or repository.' } };
const schema = (properties = {}) => ({ type: 'object', properties: { ...cwdSchema, ...properties }, required: ['cwd'] });

const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$/;

async function oddTasksStatus({ cwd }) {
  const dir = path.join(cwd, 'odd', 'tasks');
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.md')).sort();
  const files = [];
  for (const name of names) {
    const items = (await readFile(path.join(dir, name), 'utf8')).split('\n').flatMap((line) => {
      const m = CHECKBOX.exec(line);
      return m ? [{ done: m[1] !== ' ', text: m[2] }] : [];
    });
    files.push({
      file: `odd/tasks/${name}`,
      done: items.filter((i) => i.done).length,
      total: items.length,
      next: items.find((i) => !i.done)?.text ?? null,
    });
  }
  const first = files.find((f) => f.next !== null);
  return { files, next: first ? { file: first.file, item: first.next } : null };
}

export const tools = [
  {
    name: 'skill_registry_refresh',
    description: 'Regenerate <cwd>/.atl/skill-registry.md when the project or user skills changed (no-op on a cache hit).',
    inputSchema: schema(),
    run: ({ cwd }) => refreshRegistry({ cwd, gitignore: false }),
  },
  {
    name: 'review_assess',
    description: 'Classify the current change set as passive, medium or high review risk and report whether a review is due.',
    inputSchema: schema({
      base_ref: { type: 'string', description: 'Git ref to compare against (default HEAD).' },
      committed_only: { type: 'boolean', description: 'Compare base_ref..HEAD and ignore the working tree.' },
    }),
    run: ({ cwd, base_ref, committed_only }) => assess({ cwd, baseRef: base_ref, committedOnly: committed_only === true }),
  },
  {
    name: 'review_mode_status',
    description: 'Report whether receipt-driven development is on for this repository and which setting decided it. Read-only.',
    inputSchema: schema(),
    run: ({ cwd }) => modeStatus({ cwd }),
  },
  {
    name: 'odd_tasks_status',
    description: 'Summarize odd/tasks/*.md checkboxes: done/total per file and the next unchecked item.',
    inputSchema: schema(),
    run: oddTasksStatus,
  },
];

export const toolByName = new Map(tools.map((t) => [t.name, t]));

export function validateArgs(tool, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new ToolInputError('arguments must be an object');
  if (typeof args.cwd !== 'string' || args.cwd === '') throw new ToolInputError('cwd is required (absolute path string)');
  return args;
}
