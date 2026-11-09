// What `amauta upgrade` shows before it moves an install (odd/tasks/upgrade-next.md): the UPGRADING.md notes of every
// version in the jump, a preview of the target's own installer run in dry-run from a temporary worktree, and the
// sticky choices of the last install. Nothing here changes the install: the worktree is always removed.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../util/git.js';

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)/;
const SECTION = /^## From (\S+) to (\S+?)(?:\s.*)?$/; // words after the versions are allowed
const LIST_MAX = 8; // paths listed per kind; the count is always exact

/** Compare two versions ("0.4.0" or "v0.4.0"); a malformed one sorts first. */
export function cmpVersion(a, b) {
  const x = VERSION.exec(String(a))?.slice(1).map(Number) ?? [-1, 0, 0];
  const y = VERSION.exec(String(b))?.slice(1).map(Number) ?? [-1, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The `## From A to B` sections with from < B <= to, oldest first, as Markdown. */
export function notesBetween(markdown, from, to) {
  const sections = [];
  let current = null;
  let fenced = false;
  for (const line of String(markdown ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    const m = fenced ? null : SECTION.exec(line);
    if (m || (!fenced && /^## /.test(line))) {
      current = m ? { to: m[2], lines: [line] } : null;
      if (current) sections.push(current);
    } else if (current) current.lines.push(line);
  }
  return sections
    .filter((s) => cmpVersion(s.to, from) > 0 && cmpVersion(s.to, to) <= 0)
    .sort((a, b) => cmpVersion(a.to, b.to))
    .map((s) => singleStepDropped(s.lines).join('\n').trim())
    .join('\n\n');
}

/** Drop what only fits a one-version step: a fence of `amauta upgrade --to` lines and the Rollback item (with its
 * indented continuation). The real rollback of the whole jump is printed at the end. */
function singleStepDropped(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      const end = lines.findIndex((l, j) => j > i && /^```/.test(l));
      const body = end > i ? lines.slice(i + 1, end) : [];
      if (end > i && body.length && body.every((l) => /^amauta upgrade --to \S+\s*$/.test(l.trim()))) { i = end; continue; }
    }
    if (/^- Rollback:/.test(lines[i])) {
      while (i + 1 < lines.length && /^ {2}\S/.test(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.filter((l, j, a) => !(l.trim() === '' && (a[j - 1] ?? '').trim() === ''));
}

/** A file of the repository at a ref, or null. */
export const readAt = (root, ref, file) => git(root, ['show', `${ref}:${file}`]).catch(() => null);

/** Whether a checkout's installer can be told the install it previews for (AMAUTA_INSTALL_ROOT, src/install/assets.js). */
export async function knowsInstallRoot(dir) {
  return (await readFile(path.join(dir, 'src', 'install', 'assets.js'), 'utf8').catch(() => '')).includes('AMAUTA_INSTALL_ROOT');
}

/**
 * Default preview: the target checkout's own CLI, `install --dry-run --json`, with the upgrade's flags. installRoot is
 * the real install, so the paths it plans are the ones the upgrade will write (an older installer ignores it).
 */
export function defaultPreviewInstall(dir, flags, { env = process.env, installRoot } = {}) {
  return new Promise((resolve) => {
    const childEnv = installRoot ? { ...env, AMAUTA_INSTALL_ROOT: installRoot } : env;
    const child = spawn(process.execPath, [path.join(dir, 'bin', 'amauta.js'), 'install', '--dry-run', '--json', ...flags],
      { cwd: dir, env: childEnv, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve({ code: 1, report: null }));
    child.on('close', (code) => {
      let report = null;
      try { report = JSON.parse(out); } catch { /* an older installer without --json */ }
      resolve({ code: code ?? 1, report });
    });
  });
}

/** Run fn(dir) on a temporary detached worktree of ref; the worktree is removed whatever happens. */
export async function withWorktree(root, ref, fn) {
  await git(root, ['worktree', 'prune']).catch(() => {}); // one left by an interrupted run
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amauta-upgrade-'));
  try {
    await git(root, ['worktree', 'add', '--detach', '--quiet', dir, ref]);
    return await fn(dir);
  } finally {
    await git(root, ['worktree', 'remove', '--force', dir]).catch(() => {});
    await rm(dir, { recursive: true, force: true });
    await git(root, ['worktree', 'prune']).catch(() => {});
  }
}

const MODULES = ['sdd', 'rea', 'context7', 'impeccable', 'archify']; // sticky in the installer itself
const SWITCHES = ['telemetry', 'privacy', 'checks']; // not sticky: an install without --no-X turns X back on
const PERSONA = /^[a-z][a-z-]{0,30}$/;

/**
 * The choices of the last install (state.json): optional modules on (the installer keeps them), and the flags that
 * must be passed again to keep the rest (`--no-telemetry`, `--no-privacy`, `--no-checks`, `--persona`).
 */
export async function keptChoices(stateDir) {
  let state;
  try { state = JSON.parse(await readFile(path.join(stateDir, 'state.json'), 'utf8')); } catch { return null; }
  if (!state || typeof state !== 'object') return null;
  const again = SWITCHES.filter((k) => state[k] === false).map((k) => `--no-${k}`);
  if (typeof state.persona === 'string' && PERSONA.test(state.persona) && state.persona !== 'gentleman') {
    again.push('--persona', state.persona);
  }
  return { on: MODULES.filter((k) => state[k] === true), again };
}

function listed(verb, items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const shown = items.slice(0, LIST_MAX).map((x) => `      ${typeof x === 'string' ? x : JSON.stringify(x)}`);
  const more = items.length > LIST_MAX ? [`      ... and ${items.length - LIST_MAX} more`] : [];
  return [`    ${verb}`, ...shown, ...more];
}

const KINDS = ['files', 'removed', 'legacy', 'skipped'];

/** Claude's and Codex's parts of an install report as one ({ codex: {...} } is what --runtime both adds). */
function merged(report) {
  if (!report || typeof report !== 'object') return null;
  const codex = report.codex && typeof report.codex === 'object' ? report.codex : {};
  const out = { state_changes: { ...(codex.state_changes ?? {}), ...(report.state_changes ?? {}) } };
  for (const k of KINDS) out[k] = [...(Array.isArray(report[k]) ? report[k] : []), ...(Array.isArray(codex[k]) ? codex[k] : [])];
  return out;
}

/**
 * The dry-run report lines. preview: { code, report, approximate } from the target's installer (approximate: it
 * could not be told the real install, so its paths are the temporary copy's); kept: keptChoices().
 */
export function reportLines(preview, kept) {
  const out = ['What the new installer would do:'];
  const r = merged(preview?.report);
  if (r && preview.approximate) out.push('  approximate: this version\'s installer previews a temporary copy, so paths may differ');
  if (!r || preview.code !== 0) {
    out.push(`  could not preview (the target's installer exited ${preview?.code ?? 1}); the plan above still applies`);
  }
  else {
    const n = (k) => (Array.isArray(r[k]) ? r[k].length : 0);
    out.push(...listed(`would write ${n('files')} file${n('files') === 1 ? '' : 's'}:`, r.files));
    out.push(...listed(`would remove ${n('removed')}:`, r.removed));
    out.push(...listed(`would replace ${n('legacy')} legacy entr${n('legacy') === 1 ? 'y' : 'ies'}:`, r.legacy));
    out.push(...listed(`would keep ${n('skipped')} file${n('skipped') === 1 ? '' : 's'} you edited:`, r.skipped));
    const changes = Object.keys(r.state_changes ?? {});
    if (changes.length) out.push(`    would change install choices: ${changes.join(', ')}`);
    if (out.length === (preview.approximate ? 2 : 1)) out.push('    nothing: the install is already what this version writes');
  }
  if (kept) {
    const again = kept.again.length ? `; passed again: ${kept.again.join(' ')}` : '';
    out.push(`  kept from your last install: ${kept.on.join(', ') || 'no optional module'}${again}`);
  }
  return out;
}
