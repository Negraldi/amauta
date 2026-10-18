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
export const BEGIN = '# >>> amauta graphify >>>';
export const END = '# <<< amauta graphify <<<';
const SHEBANG = '#!/bin/sh\n';
const SHELL_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+)?(?:\S*\/)?(?:ba|z|da|k)?sh(?:\s|$)/;

const LOG_MAX_BYTES = 262144;

// git runs post-commit only for local commits: history that arrives by merge/pull (post-merge), is rewritten by
// rebase/amend (post-rewrite) or comes with a branch switch (post-checkout) needs its own trigger. One block for all.
export const EVENTS = ['post-commit', 'post-merge', 'post-rewrite', 'post-checkout'];
const CHECKOUT_GUARD = '  [ "$3" = 1 ] || exit 0  # post-checkout: branch switches only, never file checkouts';

/**
 * The hook block: everything runs in a background subshell, so a commit never waits or fails because of it.
 * A lock directory in the git dir keeps runs single-flight: a trigger that finds the lock held leaves a `.pending`
 * marker and exits, and the running job reruns once when it sees the marker (coalescing a rebase of N commits into
 * at most one extra run; a loser re-checks the lock after leaving its marker, so the marker is never orphaned).
 * The lock itself (stale rule, start token, atomic takeover) is python/amauta/graph/lock.py, shared with Node and Python.
 * Failures go to <state-dir>/graphify-hook.log.
 */
export function hookBlock({ stateDir, event = 'post-commit' }) {
  const pythonPath = path.join(packageRoot, 'python');
  const log = path.join(stateDir, 'graphify-hook.log');
  return [
    BEGIN,
    '# Managed by amauta: refresh the graphify graph, then mirror it into memory.db. Background, single-flight, never fails a commit.',
    '(',
    ...(event === 'post-checkout' ? [CHECKOUT_GUARD] : []),
    '  export GRAPHIFY_QUERY_LOG_DISABLE=1',
    '  cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0',
    `  LOG=${shellQuote(log)}`,
    '  LOCK="$(git rev-parse --git-path amauta-graphify.lock 2>/dev/null)"; [ -n "$LOCK" ] || exit 0',
    `  note() { mkdir -p "$(dirname "$LOG")" 2>/dev/null; [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt ${LOG_MAX_BYTES} ] && : > "$LOG"; printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG" 2>/dev/null; }`,
    "  # The lock protocol (mkdir acquire, pid + start token, 15 min AND owner-gone staleness, atomic takeover) lives in ONE place,",
    "  # python/amauta/graph/lock.py, shared with Node and the Python writers. Exit 0 = acquired, 75 = held, anything else",
    "  # (no python3 >= 3.11, broken install) = fail open: nothing ran, nothing to clean up, and the reason goes to the log.",
    "  # The helper gets a minimal environment (PATH, HOME, LANG, PYTHONPATH): never API keys.",
    `  acquire() { aerr="$(env -i PATH="$PATH" HOME="\${HOME-}" LANG="\${LANG-}" PYTHONPATH=${shellQuote(pythonPath)} python3 -P -m amauta.graph.lock acquire --lock "$LOCK" --pid "$me" 2>&1 >/dev/null)"; }`,
    '  release() { rm -rf "$LOCK" 2>/dev/null; }',
    '  while :; do',
    '    # Owner = this background subshell. `read` is a builtin, so /proc/self is the subshell itself (no helper process,',
    '    # no command substitution whose fork behaviour differs between shells). Without /proc, a direct `sh -c` child reports its parent.',
    '    me=; [ -r /proc/self/stat ] && read -r me _ < /proc/self/stat 2>/dev/null',
    `    [ -n "$me" ] || { sh -c 'echo $PPID' > "$LOCK.owner" 2>/dev/null; read -r me < "$LOCK.owner" 2>/dev/null; rm -f "$LOCK.owner"; }`,
    '    acquire; rc=$?',
    '    if [ "$rc" -ne 0 ]; then',
    '      [ "$rc" -eq 75 ] || { note "lock helper failed (exit $rc), skipped: $(printf %s "$aerr" | head -c 300 | tr \'\\n\' \' \') (python3 >= 3.11 required for the graphify lock)"; exit 0; }',
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
    `      out="$(env PYTHONPATH=${shellQuote(pythonPath)} AMAUTA_STATE_DIR=${shellQuote(stateDir)} python3 -P -m amauta.graph sync --repo .\${pend:+ --semantic-pending $pend} 2>&1)" || note "graph sync failed: $out"`,
    '    fi',
    '    release; trap - EXIT',
    '    [ -e "$LOCK.pending" ] || break',
    '  done',
    ') >/dev/null 2>&1 &',
    END,
    '',
  ].join('\n');
}

async function hookFiles(cwd) {
  const root = await gitRepoRoot(cwd);
  if (!root) throw new Error(`not a git repository: ${cwd}`);
  const rel = (await gitOrNull(root, ['rev-parse', '--git-path', 'hooks']))?.trim();
  if (!rel) throw new Error('cannot locate the git hooks directory');
  return EVENTS.map((event) => ({ event, file: path.join(path.resolve(root, rel), event) }));
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

function nextHookText(file, existing, block, warnings) {
  if (existing === null) return `${SHEBANG}\n${block}`;
  const first = existing.split('\n', 1)[0];
  if (first.startsWith('#!') && !SHELL_SHEBANG.test(first)) throw new Error(`${file} is not a shell script (${first}); add the graphify step to it by hand`);
  const bounds = blockBounds(existing);
  if (bounds) return existing.slice(0, bounds.start) + block + existing.slice(bounds.end); // refresh our block in place
  if (/^\s*(exit|exec)\b/m.test(existing)) warnings.push(`${file}: the existing hook has a top-level exit/exec before our block, so the block may never run`);
  return `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}\n${block}`;
}

/** Every event hook is checked before any is written, so a refused hook leaves all of them untouched. */
export async function installHook({ cwd = process.cwd(), stateDir } = {}) {
  const hooks = await hookFiles(path.resolve(cwd));
  const state = resolveTargets({ stateDir }).stateDir;
  const warnings = [];
  const plans = [];
  for (const { event, file } of hooks) {
    const existing = await readOrNull(file);
    plans.push({ file, existing, next: nextHookText(file, existing, hookBlock({ stateDir: state, event }), warnings) });
  }
  let changed = false;
  for (const { file, existing, next } of plans) {
    if (next !== existing) {
      await writeFileAtomic(file, next, existing === null ? { mode: 0o755 } : {});
      changed = true;
    }
    if (((await stat(file)).mode & 0o111) === 0) warnings.push(`${file}: the hook file is not executable, so git ignores it (chmod +x)`);
  }
  const files = hooks.map((h) => h.file);
  return { file: files[0], files, changed, warnings };
}

export async function uninstallHook({ cwd = process.cwd() } = {}) {
  const hooks = await hookFiles(path.resolve(cwd));
  const removed = [];
  for (const { file } of hooks) {
    const existing = await readOrNull(file);
    const bounds = existing === null ? null : blockBounds(existing);
    if (!bounds) continue;
    const rest = existing.slice(0, bounds.from) + existing.slice(bounds.end);
    if (rest.trim() === '' || rest.trim() === SHEBANG.trim()) await rm(file, { force: true }); // a hook that only ever held our block
    else await writeFileAtomic(file, rest);
    removed.push(file);
  }
  const files = hooks.map((h) => h.file);
  return { file: files[0], files, removed, changed: removed.length > 0 };
}

const OPTIONS = { cwd: { type: 'string' }, 'state-dir': { type: 'string' } };

async function run(args, io) {
  const [group, action, ...rest] = args;
  if (group === 'semantic') return semanticCommand(args.slice(1), io);
  if (group !== 'hook' || !['install', 'uninstall'].includes(action)) {
    io.stderr.write('amauta: usage: amauta graphify hook <install|uninstall> [--cwd DIR] [--state-dir DIR] | amauta graphify semantic [--cwd DIR] [--model M] [--state-dir DIR]\n');
    return 1;
  }
  try {
    const { values } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false, strict: true });
    const opts = { cwd: path.resolve(values.cwd ?? process.cwd()), stateDir: values['state-dir'] };
    if (action === 'install') {
      const r = await installHook(opts);
      io.stdout.write(`amauta: graphify hooks ${r.changed ? 'installed' : 'already up to date'}:\n${r.files.map((f) => `  ${f}\n`).join('')}`);
      for (const w of r.warnings) io.stdout.write(`  warning: ${w}\n`);
    } else {
      const r = await uninstallHook(opts);
      io.stdout.write(r.changed ? `amauta: graphify hook block removed from:\n${r.removed.map((f) => `  ${f}\n`).join('')}` : 'amauta: no graphify hook block found\n');
    }
    return 0;
  } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
}

export function registerGraphifyCommands(commands) {
  commands.set('graphify', { summary: 'Manage the graphify git hooks (post-commit, post-merge, post-rewrite, post-checkout) that mirror the code graph into memory.db (hook install|uninstall --cwd --state-dir; semantic --cwd --model: optional LLM pass, needs ANTHROPIC_API_KEY)', run });
}
