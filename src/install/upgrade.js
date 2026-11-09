// `amauta upgrade`: move the install's git checkout to a release tag (or, with --branch, to the tip of a branch on
// origin), then run the new checkout's own `amauta install` and `amauta status`. It prints the UPGRADING.md notes of
// the whole jump; --dry-run also previews the target's installer (upgrade-plan.js). odd/tasks/upgrade-next.md.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { git } from '../util/git.js';
import { resolveTargets } from './paths.js';
import {
  cmpVersion, defaultPreviewInstall, keptChoices, knowsInstallRoot, notesBetween, readAt, reportLines, withWorktree,
} from './upgrade-plan.js';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const OPTIONS = {
  to: { type: 'string' },
  branch: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  yes: { type: 'boolean', default: false },
  'claude-home': { type: 'string' },
  'claude-json': { type: 'string' },
  'state-dir': { type: 'string' },
};
const PATH_FLAGS = [['--claude-home', 'claude-home'], ['--claude-json', 'claude-json'], ['--state-dir', 'state-dir']];

const gitOrNull = (cwd, args) => git(cwd, args).then((s) => s.trim(), () => null);
const firstLine = (e) => String(e.message).split('\n')[0];

/** Default installer runner: the NEW checkout's own CLI (the running process still holds the old code). No shell. */
function defaultRunAmauta(root) {
  return (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'bin', 'amauta.js'), ...args], { cwd: root, stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function defaultConfirm(question) {
  if (!process.stdin.isTTY) return null; // cannot ask
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}

/** Flags and the install checkout's state; a string is the reason to refuse. */
async function inspect(args, root) {
  let values;
  try { ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true })); } catch (e) { return e.message; }
  const shown = (v, n) => JSON.stringify(String(v).slice(0, n));
  if (values.to !== undefined && !TAG.test(values.to)) return `--to must be a release tag like v0.2.0 (got ${shown(values.to, 40)})`;
  if (values.to !== undefined && values.branch !== undefined) return '--to and --branch exclude each other';
  // check-ref-format --branch expands @{-1} and accepts refs/heads/x: the name must come back unchanged.
  if (values.branch !== undefined && (values.branch.startsWith('-') || values.branch.startsWith('refs/')
      || (await gitOrNull(root, ['check-ref-format', '--branch', values.branch])) !== values.branch)) {
    return `--branch: not a valid branch name: ${shown(values.branch, 60)}`;
  }
  if ((await gitOrNull(root, ['rev-parse', '--is-inside-work-tree'])) !== 'true') {
    return `${root} is not a git checkout, so it cannot be upgraded with git; reinstall from a clone instead`;
  }
  const dirty = await gitOrNull(root, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty === null || dirty !== '') return `the install repo ${root} has uncommitted changes; commit or stash them first`;
  const branch = await gitOrNull(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!branch) {
    return `the install repo ${root} is not on a branch (detached HEAD, for example after a rollback); `
      + `return to your branch first: git -C ${root} checkout main`;
  }
  const upstream = await gitOrNull(root, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
  if (!upstream || !upstream.startsWith('origin/')) {
    return `branch ${branch} does not track a branch on origin; run: git -C ${root} branch --set-upstream-to origin/main ${branch}`;
  }
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  } catch { return 'could not read package.json of the install repo'; }
  const remote = await gitOrNull(root, ['ls-remote', '--tags', '--refs', 'origin']);
  if (remote === null) return 'could not reach origin (git ls-remote --tags origin failed)';
  const tags = remote.split('\n').map((l) => l.split('\t')[1]?.replace(/^refs\/tags\//, ''))
    .filter((t) => t && TAG.test(t));
  const flags = PATH_FLAGS.flatMap(([flag, key]) => (values[key] === undefined ? [] : [flag, values[key]]));
  const dirs = resolveTargets({ claudeHome: values['claude-home'], claudeJson: values['claude-json'], stateDir: values['state-dir'] });
  const kept = await keptChoices(dirs.stateDir);
  return { values, branch, pkg, tags, flags, kept, again: kept?.again ?? [], headSha: await gitOrNull(root, ['rev-parse', 'HEAD']),
    described: (await gitOrNull(root, ['describe', '--tags', '--always'])) ?? 'unknown' };
}

/** The target: { kind: 'tag'|'branch', name, ref, label, detach, done } or a string (the reason to refuse). */
async function chooseTarget(root, s) {
  const { values, tags, pkg, headSha } = s;
  if (values.branch !== undefined) {
    const name = values.branch;
    const heads = await gitOrNull(root, ['ls-remote', '--heads', 'origin', `refs/heads/${name}`]);
    if (!heads) return `branch ${name} does not exist on origin`;
    return { kind: 'branch', name, ref: `refs/remotes/origin/${name}`, label: `branch ${name} (origin/${name})`, detach: false };
  }
  let name = values.to;
  if (name) { if (!tags.includes(name)) return `tag ${name} does not exist on origin`; }
  else {
    if (tags.length === 0) return 'origin has no release tags (vX.Y.Z)';
    name = [...tags].sort(cmpVersion).at(-1);
  }
  const local = await gitOrNull(root, ['rev-parse', '--verify', '-q', `refs/tags/${name}^{commit}`]);
  const rank = cmpVersion(name, pkg);
  let done = null;
  if (local && local === headSha) done = `Already on ${name}; nothing to do.`;
  else if (!values.to && rank <= 0) done = `Already up to date (${pkg} is not older than ${name}); nothing to do.`;
  const label = `${name}${values.to ? ' (--to)' : ' (latest release tag on origin)'}`;
  return { kind: 'tag', name, ref: `refs/tags/${name}`, label, detach: values.to !== undefined && rank < 0, done };
}

async function fetchTarget(root, target) {
  const refspec = target.kind === 'branch' ? [`+refs/heads/${target.name}:refs/remotes/origin/${target.name}`] : [];
  await git(root, ['fetch', '--tags', 'origin', ...refspec]);
  const fetched = await gitOrNull(root, ['rev-parse', '--verify', '-q', `${target.ref}^{commit}`]);
  if (!fetched) throw new Error(`${target.name} was not fetched`);
}

function switchCommand(target, s) {
  if (target.kind === 'tag') return target.detach ? `git checkout --detach ${target.name}` : `git merge --ff-only ${target.name}`;
  const n = target.name;
  return s.localBranch ? `git checkout ${n} && git merge --ff-only origin/${n}` : `git checkout -b ${n} --track origin/${n}`;
}

/** Move the checkout; a string is the reason it did not move. */
async function moveTo(root, target, s) {
  try {
    if (target.kind === 'tag') {
      await git(root, target.detach ? ['checkout', '--detach', target.ref] : ['merge', '--ff-only', target.ref]);
      return null;
    }
    if (!s.localBranch) { await git(root, ['checkout', '-q', '-b', target.name, '--track', `origin/${target.name}`]); return null; }
    if ((await gitOrNull(root, ['merge-base', '--is-ancestor', `refs/heads/${target.name}`, target.ref])) === null) {
      return `local branch ${target.name} has commits that are not on origin/${target.name}; nothing was changed`;
    }
    await git(root, ['checkout', '-q', target.name]);
    await git(root, ['merge', '--ff-only', target.ref]);
    await git(root, ['branch', '-q', `--set-upstream-to=origin/${target.name}`, target.name]); // later upgrades follow it
    return null;
  } catch (e) {
    if (target.kind === 'tag' && !target.detach) {
      return `cannot fast-forward ${s.branch} to ${target.name} `
        + '(the branch has commits that are not in the tag, or diverged); nothing was changed';
    }
    return `git failed: ${firstLine(e)}`;
  }
}

function rollbackOf(root, target, s) {
  if (target.kind === 'branch') return `git -C ${root} checkout ${s.branch} && amauta install`;
  const tag = `v${s.pkg}`;
  if (TAG.test(tag) && s.tags.includes(tag)) return `amauta upgrade --to ${tag}`;
  return `git -C ${root} checkout --detach ${s.headSha} && amauta install`;
}

async function printPlan(root, target, s, out) {
  s.localBranch = target.kind === 'branch'
    && (await gitOrNull(root, ['rev-parse', '--verify', '-q', `refs/heads/${target.name}`])) !== null;
  let version = 'unknown';
  try { version = JSON.parse((await readAt(root, target.ref, 'package.json')) ?? '{}').version ?? version; } catch { /* reported */ }
  out(`  target: ${target.label}, version ${version}`);
  out('Plan:');
  out('  1. git fetch --tags origin   (done)');
  out(`  2. ${switchCommand(target, s)}   (in ${root}, branch ${s.branch})`);
  out('  3. amauta install   (sticky flags are kept)');
  out('  4. amauta status');
  if (cmpVersion(version, s.pkg) < 0) {
    out(`Going back from ${s.pkg} to ${version}: the upgrade notes do not apply; see the Rollback lines of UPGRADING.md.`);
    return '';
  }
  const notes = notesBetween(await readAt(root, target.ref, 'UPGRADING.md'), s.pkg, version);
  if (notes) out(`Notes for ${s.pkg} -> ${version}:\n\n${notes}\n`);
  return notes;
}

async function preview(root, target, s, deps, out) {
  const run = deps.previewInstall ?? defaultPreviewInstall;
  const result = await withWorktree(root, target.ref, async (dir) => ({
    ...(await run(dir, [...s.flags, ...s.again], { installRoot: root })), approximate: !(await knowsInstallRoot(dir)),
  })).catch(() => ({ code: 1, report: null }));
  for (const line of reportLines(result, s.kept)) out(line);
}

async function finish(root, target, s, deps, out, err, notes) {
  const runAmauta = deps.runAmauta ?? defaultRunAmauta(root);
  const tail = () => {
    out(`  rollback: ${rollbackOf(root, target, s)}`);
    if (!target.detach) return;
    out(`  return to ${s.branch}: git -C ${root} checkout ${s.branch}   (this version has no 'upgrade' command if it predates v0.2.0)`);
  };
  if ((await runAmauta(['install', ...s.flags, ...s.again])) !== 0) {
    err(`install failed after moving to ${target.name}; the checkout is at ${target.name}`);
    tail();
    return 1;
  }
  const statusCode = await runAmauta(['status', ...s.flags]);
  out(`Upgraded ${s.pkg} -> ${target.name}. `
    + 'Start a new Claude Code session to load the new hooks, skills and MCP servers.');
  if (statusCode !== 0) out('  amauta status reported problems (see above).');
  if (notes) out(`Remember the notes above:\n\n${notes}\n`);
  tail();
  return statusCode === 0 ? 0 : 1;
}

/**
 * `amauta upgrade [--to vX.Y.Z | --branch NAME] [--dry-run] [--yes] [path flags]`. A tag newer than the install is
 * reached by `git merge --ff-only` on the current branch, an older one with --to detaches HEAD there, a branch is
 * checked out tracking origin (created or fast-forwarded). deps: { root, runAmauta(args), confirm(question) ->
 * boolean | null (null = cannot ask), previewInstall(dir, flags) -> { code, report } }.
 */
export async function runUpgrade(args, io, deps = {}) {
  const root = deps.root ?? DEFAULT_ROOT;
  const out = (line) => io.stdout.write(`${line}\n`);
  const err = (line) => io.stderr.write(`amauta: ${line}\n`);
  const fail = (line) => { err(line); return 1; };
  const s = await inspect(args, root);
  if (typeof s === 'string') return fail(s);
  const target = await chooseTarget(root, s);
  if (typeof target === 'string') return fail(target);
  out('amauta upgrade');
  out(`  current: ${s.pkg} (git describe: ${s.described})`);
  if (target.done) { out(`  target: ${target.label}`); out(target.done); return 0; }
  try { await fetchTarget(root, target); } catch (e) { return fail(`git fetch failed: ${firstLine(e)}`); }
  const atTip = target.kind === 'branch' && s.branch === target.name
    && (await gitOrNull(root, ['rev-parse', target.ref])) === s.headSha;
  if (atTip) {
    out(`  target: ${target.label}`);
    out(`Already on ${target.label} at its tip; nothing to do.`);
    return 0;
  }
  const notes = await printPlan(root, target, s, out);
  if (s.values['dry-run']) {
    await preview(root, target, s, deps, out);
    out('Dry run: fetched from origin; nothing else was changed.');
    return 0;
  }
  if (!s.values.yes) {
    const ok = await (deps.confirm ?? defaultConfirm)(`Move ${root} from ${s.pkg} to ${target.name}?`);
    if (ok === null) return fail('cannot ask for confirmation without a terminal; pass --yes');
    if (!ok) { out('Cancelled; nothing was changed.'); return 1; }
  }
  const why = await moveTo(root, target, s);
  if (why) return fail(why);
  return finish(root, target, s, deps, out, err, notes);
}
