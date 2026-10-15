import { chmod, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot as gitRepoRoot, gitOrNull } from '../util/git.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import { resolveTargets } from '../install/paths.js';
import { shellQuote } from '../install/servers.js';
import { repoRoot as packageRoot } from '../install/assets.js';
import { semanticCommand } from './semantic.js';

// graphify (https://github.com/Graphify-Labs/graphify, Apache-2.0, PyPI `graphifyy`) is an external tool: detected at run time, never vendored.
export const BEGIN = '# >>> gentle-lite graphify >>>';
export const END = '# <<< gentle-lite graphify <<<';
const SHEBANG = '#!/bin/sh\n';
const SHELL_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+)?(?:\S*\/)?(?:ba|z|da|k)?sh(?:\s|$)/;

const LOG_MAX_BYTES = 262144;

/**
 * The hook block: everything runs in a background subshell, so a commit never waits or fails because of it.
 * A lock directory in the git dir keeps runs single-flight: a trigger that finds the lock held leaves a `.pending`
 * marker and exits, and the running job reruns once when it sees the marker (coalescing a rebase of N commits into
 * at most one extra run; a loser re-checks the lock after leaving its marker, so the marker is never orphaned).
 * The lock itself (stale rule, start token, atomic takeover) is python/gentle_lite/graph/lock.py, shared with Node and Python.
 * Failures go to <state-dir>/graphify-hook.log.
 */
export function hookBlock({ stateDir }) {
  const pythonPath = path.join(packageRoot, 'python');
  const log = path.join(stateDir, 'graphify-hook.log');
  return [
    BEGIN,
    '# Managed by gentle-lite: refresh the graphify graph, then mirror it into memory.db. Background, single-flight, never fails a commit.',
    '(',
    '  export GRAPHIFY_QUERY_LOG_DISABLE=1',
    '  cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0',
    `  LOG=${shellQuote(log)}`,
    '  LOCK="$(git rev-parse --git-path gentle-lite-graphify.lock 2>/dev/null)"; [ -n "$LOCK" ] || exit 0',
    `  note() { mkdir -p "$(dirname "$LOG")" 2>/dev/null; [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt ${LOG_MAX_BYTES} ] && : > "$LOG"; printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG" 2>/dev/null; }`,
    "  # The lock protocol (mkdir acquire, pid + start token, 15 min AND owner-gone staleness, atomic takeover) lives in ONE place,",
    "  # python/gentle_lite/graph/lock.py, shared with Node and the Python writers. Exit 0 = acquired, 75 = held, anything else",
    "  # (no python3, broken install) = fail open: nothing ran, nothing to clean up.",
    `  acquire() { env PYTHONPATH=${shellQuote(pythonPath)} python3 -P -m gentle_lite.graph.lock acquire --lock "$LOCK" --pid "$me" >/dev/null 2>&1; }`,
    '  release() { rm -rf "$LOCK" 2>/dev/null; }',
    '  while :; do',
    '    # Owner = this background subshell. `read` is a builtin, so /proc/self is the subshell itself (no helper process,',
    '    # no command substitution whose fork behaviour differs between shells). Without /proc, a direct `sh -c` child reports its parent.',
    '    me=; [ -r /proc/self/stat ] && read -r me _ < /proc/self/stat 2>/dev/null',
    `    [ -n "$me" ] || { sh -c 'echo $PPID' > "$LOCK.owner" 2>/dev/null; read -r me < "$LOCK.owner" 2>/dev/null; rm -f "$LOCK.owner"; }`,
    '    acquire; rc=$?',
    '    if [ "$rc" -ne 0 ]; then',
    '      [ "$rc" -eq 75 ] || { note "lock helper failed (exit $rc), skipped"; exit 0; }',
    '      : > "$LOCK.pending" 2>/dev/null',
    '      # The holder may have released between our failed acquire and the marker: try once more so the marker is never orphaned.',
    '      acquire || exit 0',
    '    fi',
    '    trap release EXIT',
    '    rm -f "$LOCK.pending"',
    '    pend=',
    '    if command -v graphify >/dev/null 2>&1; then',
    '      if out="$(graphify update . 2>&1)"; then',
    '        # Local only: check-update just reads graphify-out/needs_update. It ALWAYS exits 0 (cron-safe) and signals only by text:',
    '        # a line "[graphify check-update] Pending non-code changes in <path>." when the flag exists, nothing otherwise',
    '        # (graphify 0.9.90, observed). So the verdict is that exact line, anchored: a bare "pending" would also match',
    '        # negative wording or a path. If graphify rewords it the flag stays 0 (see test/graphify-hook.test.js).',
    '        # A check that fails to run leaves the stored flag as it was.',
    `        chk="$(graphify check-update . 2>&1)" && { printf '%s\\n' "$chk" | grep -q '^\\[graphify check-update\\] Pending non-code changes' && pend=1 || pend=0; }`,
    '      else note "graphify update failed: $out"; fi',
    '    fi',
    '    if [ -f graphify-out/graph.json ]; then',
    `      out="$(env PYTHONPATH=${shellQuote(pythonPath)} GENTLE_LITE_STATE_DIR=${shellQuote(stateDir)} python3 -P -m gentle_lite.graph sync --repo .\${pend:+ --semantic-pending $pend} 2>&1)" || note "graph sync failed: $out"`,
    '    fi',
    '    release; trap - EXIT',
    '    [ -e "$LOCK.pending" ] || break',
    '  done',
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
  if (group === 'semantic') return semanticCommand(args.slice(1), io);
  if (group !== 'hook' || !['install', 'uninstall'].includes(action)) {
    io.stderr.write('gentle-lite: usage: gentle-lite graphify hook <install|uninstall> [--cwd DIR] [--state-dir DIR] | gentle-lite graphify semantic [--cwd DIR] [--model M] [--state-dir DIR]\n');
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
  commands.set('graphify', { summary: 'Manage the graphify post-commit hook that mirrors the code graph into memory.db (hook install|uninstall --cwd --state-dir; semantic --cwd --model: optional LLM pass, needs ANTHROPIC_API_KEY)', run });
}
