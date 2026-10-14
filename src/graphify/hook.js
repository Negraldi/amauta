import { chmod, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot as gitRepoRoot, gitOrNull } from '../util/git.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import { resolveTargets } from '../install/paths.js';
import { shellQuote } from '../install/servers.js';
import { repoRoot as packageRoot } from '../install/assets.js';

// graphify (https://github.com/Graphify-Labs/graphify, Apache-2.0, PyPI `graphifyy`) is an external tool: detected at run time, never vendored.
export const BEGIN = '# >>> gentle-lite graphify >>>';
export const END = '# <<< gentle-lite graphify <<<';
const SHEBANG = '#!/bin/sh\n';
const SHELL_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+)?(?:\S*\/)?(?:ba|z|da|k)?sh(?:\s|$)/;

/** The hook block: everything runs in a background subshell with no output, so a commit never waits or fails because of it. */
export function hookBlock({ stateDir }) {
  const pythonPath = path.join(packageRoot, 'python');
  return [
    BEGIN,
    '# Managed by gentle-lite: refresh the graphify graph, then mirror it into memory.db. Background, silent, never fails a commit.',
    '(',
    '  export GRAPHIFY_QUERY_LOG_DISABLE=1',
    '  cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0',
    '  command -v graphify >/dev/null 2>&1 && graphify update . >/dev/null 2>&1 || true',
    `  [ -f graphify-out/graph.json ] && env PYTHONPATH=${shellQuote(pythonPath)} GENTLE_LITE_STATE_DIR=${shellQuote(stateDir)} python3 -P -m gentle_lite.graph sync --repo . >/dev/null 2>&1 || true`,
    ') >/dev/null 2>&1 &',
    END,
    '',
  ].join('\n');
}

async function hookFile(cwd) {
  const root = await gitRepoRoot(cwd);
  if (!root) throw new Error(`not a git repository: ${cwd}`);
  const rel = (await gitOrNull(root, ['rev-parse', '--git-path', 'hooks/post-commit']))?.trim();
  if (!rel) throw new Error('cannot locate the post-commit hook path');
  return path.resolve(root, rel);
}

const readOrNull = (p) => readFile(p, 'utf8').then((t) => t, (err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));

function blockBounds(text) {
  const start = text.indexOf(BEGIN);
  if (start < 0) return null;
  const endMarker = text.indexOf(END, start);
  if (endMarker < 0) throw new Error(`found "${BEGIN}" without its closing marker; fix the hook by hand`);
  let end = endMarker + END.length;
  if (text[end] === '\n') end += 1;
  let from = start;
  if (from >= 2 && text[from - 1] === '\n' && text[from - 2] === '\n') from -= 1; // the blank line we put before the block
  return { start, from, end };
}

export async function installHook({ cwd = process.cwd(), stateDir } = {}) {
  const dir = path.resolve(cwd);
  const file = await hookFile(dir);
  const state = resolveTargets({ stateDir }).stateDir;
  const block = hookBlock({ stateDir: state });
  const existing = await readOrNull(file);
  const warnings = [];
  let next;
  if (existing === null) {
    next = `${SHEBANG}\n${block}`;
  } else {
    const first = existing.split('\n', 1)[0];
    if (first.startsWith('#!') && !SHELL_SHEBANG.test(first)) throw new Error(`${file} is not a shell script (${first}); add the graphify step to it by hand`);
    const bounds = blockBounds(existing);
    if (bounds) {
      next = existing.slice(0, bounds.start) + block + existing.slice(bounds.end); // refresh our block in place
    } else {
      next = `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}\n${block}`;
      if (/^\s*(exit|exec)\b/m.test(existing)) warnings.push('the existing hook has a top-level exit/exec before our block, so the block may never run');
    }
  }
  const changed = next !== existing;
  if (changed) await writeFileAtomic(file, next, existing === null ? { mode: 0o755 } : {});
  if (((await stat(file)).mode & 0o111) === 0) warnings.push('the hook file is not executable, so git ignores it (chmod +x)');
  return { file, changed, warnings };
}

export async function uninstallHook({ cwd = process.cwd() } = {}) {
  const file = await hookFile(path.resolve(cwd));
  const existing = await readOrNull(file);
  const bounds = existing === null ? null : blockBounds(existing);
  if (!bounds) return { file, changed: false };
  const rest = existing.slice(0, bounds.from) + existing.slice(bounds.end);
  if (rest.trim() === '' || rest.trim() === SHEBANG.trim()) await rm(file, { force: true }); // a hook that only ever held our block
  else await writeFileAtomic(file, rest);
  return { file, changed: true };
}

const OPTIONS = { cwd: { type: 'string' }, 'state-dir': { type: 'string' } };

async function run(args, io) {
  const [group, action, ...rest] = args;
  if (group !== 'hook' || !['install', 'uninstall'].includes(action)) {
    io.stderr.write('gentle-lite: usage: gentle-lite graphify hook <install|uninstall> [--cwd DIR] [--state-dir DIR]\n');
    return 1;
  }
  try {
    const { values } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false, strict: true });
    const opts = { cwd: path.resolve(values.cwd ?? process.cwd()), stateDir: values['state-dir'] };
    if (action === 'install') {
      const r = await installHook(opts);
      io.stdout.write(r.changed ? `gentle-lite: graphify post-commit hook installed in ${r.file}\n` : `gentle-lite: graphify post-commit hook already up to date (${r.file})\n`);
      for (const w of r.warnings) io.stdout.write(`  warning: ${w}\n`);
    } else {
      const r = await uninstallHook(opts);
      io.stdout.write(r.changed ? `gentle-lite: graphify post-commit hook removed from ${r.file}\n` : 'gentle-lite: no graphify hook block found\n');
    }
    return 0;
  } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
}

export function registerGraphifyCommands(commands) {
  commands.set('graphify', { summary: 'Manage the graphify post-commit hook that mirrors the code graph into memory.db (hook install|uninstall --cwd --state-dir)', run });
}
