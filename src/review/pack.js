/**
 * `amauta review pack` (plan D11, ADR 0008): assemble, mechanically, what a lens reads, so a reviewer with a fresh
 * context sees the same evidence every time. Writes `odd/reviews/<feature>/<kind>-<n>/pack.md` (a new round gets a new
 * folder): the acceptance criteria from the task file, the approved results, the deliverables, the changed paths (and
 * those outside the deliverables folder), and the number-fidelity check. Read-only apart from that one file.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, changedPaths } from '../util/git.js';
import { checkNumbers, listFiles } from './numbers.js';

export const LENSES = { analytical: 'taripaq', communication: 'haravec' };
const FEATURE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function criteria(task) {
  const m = /^##\s+Acceptance criteria\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(task);
  return m ? m[1].trim() : '(no "Acceptance criteria" section in the task file)';
}

async function nextRound(dir, kind) {
  let entries = [];
  try { entries = await readdir(dir); } catch { /* first round */ }
  const rounds = entries.map((e) => new RegExp(`^${kind}-(\\d+)$`).exec(e)).filter(Boolean).map((m) => Number(m[1]));
  return Math.max(0, ...rounds) + 1;
}

const list = (items, empty) => (items.length ? items.map((x) => `- ${x}`).join('\n') : `- ${empty}`);

export async function buildPack({ cwd, feature, kind }) {
  if (!FEATURE.test(feature ?? '') || feature.includes('..')) throw new Error(`invalid feature name: ${feature}`);
  if (!LENSES[kind]) throw new Error('kind must be analytical or communication');
  const root = await repoRoot(cwd);
  if (!root) throw new Error(`${cwd} is not inside a git repository`);
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const task = await readFile(path.join(root, 'odd', 'tasks', `${feature}.md`), 'utf8').catch(() => '');
  const contracts = (await listFiles(path.join(root, 'odd', 'contracts', feature))).map(rel);
  const deliverables = (await listFiles(path.join(root, 'odd', 'deliverables', feature))).map(rel);
  const changed = await changedPaths(root);
  // The orchestrator owns the contracts and the task file; anything else changed beside the deliverables is listed.
  const own = [`odd/deliverables/${feature}/`, `odd/reviews/${feature}/`, `odd/contracts/${feature}/`, `odd/tasks/${feature}.md`];
  const inside = (p) => own.some((prefix) => p === prefix || p.startsWith(prefix));
  const outside = kind === 'communication' ? changed.filter((p) => !inside(p)) : [];
  const numbers = await checkNumbers(root, feature);
  const dir = path.join(root, 'odd', 'reviews', feature);
  const round = await nextRound(dir, kind);
  const file = path.join(dir, `${kind}-${round}`, 'pack.md');
  const text = [
    `# Review pack: ${feature}, ${kind} lens, round ${round}`,
    '',
    `For \`${LENSES[kind]}\`. Assembled by \`amauta review pack\`; the reviewer reads this file and the files it lists.`,
    '',
    '## Acceptance criteria', '', criteria(task), '',
    '## Approved results', '', list(contracts, `none under odd/contracts/${feature}/`), '',
    '## Deliverables', '', list(deliverables, `none under odd/deliverables/${feature}/`), '',
    '## Changed paths', '', list(changed, 'none'), '',
    ...(kind === 'communication' ? ['## Changed outside the deliverables folder', '', list(outside, 'none'), ''] : []),
    '## Number fidelity', '',
    `${numbers.checked} numbers checked, ${numbers.unmatched.length} not in the approved results.`,
    list(numbers.unmatched.map((u) => `${u.file}:${u.line}: ${u.text}`), 'all matched'),
    ...(numbers.skipped.length ? ['', 'Not checked (binary):', list(numbers.skipped, '')] : []),
    '',
  ].join('\n');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return { file, outside, unmatched: numbers.unmatched };
}
