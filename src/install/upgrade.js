import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { git } from '../util/git.js';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const OPTIONS = {
  to: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  yes: { type: 'boolean', default: false },
  'claude-home': { type: 'string' },
  'claude-json': { type: 'string' },
  'state-dir': { type: 'string' },
};

const semver = (tag) => TAG.exec(tag).slice(1).map(Number);
const cmp = (a, b) => { const x = semver(a); const y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const tagOf = (version) => `v${version}`;
const gitOrNull = (cwd, args) => git(cwd, args).then((s) => s.trim(), () => null);

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

/**
 * `amauta upgrade`. Model: upgrades fast-forward the CURRENT branch (which must track origin) to a release tag with
 * `git merge --ff-only <tag>`; going to an older tag with `--to` detaches HEAD there. Either way `amauta install` is then
 * run from the new checkout (sticky flags are kept) followed by `amauta status`.
 * deps: { root, runAmauta(args) -> exit code, confirm(question) -> boolean | null (null = cannot ask) }.
 */
export async function runUpgrade(args, io, deps = {}) {
  const root = deps.root ?? DEFAULT_ROOT;
  const runAmauta = deps.runAmauta ?? defaultRunAmauta(root);
  const confirm = deps.confirm ?? defaultConfirm;
  const out = (s) => io.stdout.write(`${s}\n`);
  const fail = (s) => { io.stderr.write(`amauta: ${s}\n`); return 1; };

  let values;
  try { ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true })); } catch (e) { return fail(e.message); }
  if (values.to !== undefined && !TAG.test(values.to)) return fail(`--to must be a release tag like v0.2.0 (got ${JSON.stringify(String(values.to).slice(0, 40))})`);

  if ((await gitOrNull(root, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return fail(`${root} is not a git checkout, so it cannot be upgraded with git; reinstall from a clone instead`);
  const dirty = await gitOrNull(root, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty === null || dirty !== '') return fail(`the install repo ${root} has uncommitted changes; commit or stash them first`);
  const branch = await gitOrNull(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!branch) return fail(`the install repo ${root} is not on a branch (detached HEAD, for example after a rollback); return to your branch first: git -C ${root} checkout main`);
  const upstream = await gitOrNull(root, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
  if (!upstream || !upstream.startsWith('origin/')) return fail(`branch ${branch} does not track a branch on origin; run: git -C ${root} branch --set-upstream-to origin/main ${branch}`);

  let pkg;
  try { pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version; } catch { return fail('could not read package.json of the install repo'); }
  const described = (await gitOrNull(root, ['describe', '--tags', '--always'])) ?? 'unknown';
  const headSha = await gitOrNull(root, ['rev-parse', 'HEAD']);

  const remote = await gitOrNull(root, ['ls-remote', '--tags', '--refs', 'origin']);
  if (remote === null) return fail('could not reach origin (git ls-remote --tags origin failed)');
  const tags = remote.split('\n').map((l) => l.split('\t')[1]?.replace(/^refs\/tags\//, '')).filter((t) => t && TAG.test(t));
  let target = values.to;
  if (target) { if (!tags.includes(target)) return fail(`tag ${target} does not exist on origin`); }
  else {
    if (tags.length === 0) return fail('origin has no release tags (vX.Y.Z)');
    target = tags.sort(cmp).at(-1);
  }

  out(`amauta upgrade`);
  out(`  current: ${pkg} (git describe: ${described})`);
  out(`  target: ${target}${values.to ? ' (--to)' : ' (latest release tag on origin)'}`);

  const local = await gitOrNull(root, ['rev-parse', '--verify', '-q', `refs/tags/${target}^{commit}`]);
  if (local && local === headSha) { out(`Already on ${target}; nothing to do.`); return 0; }
  const rank = cmp(target, tagOf(pkg));
  if (!values.to && rank <= 0) { out(`Already up to date (${pkg} is not older than ${target}); nothing to do.`); return 0; }

  const detach = values.to !== undefined && rank < 0;
  const switchCmd = detach ? `git checkout --detach ${target}` : `git merge --ff-only ${target}`;
  const flags = [['--claude-home', values['claude-home']], ['--claude-json', values['claude-json']], ['--state-dir', values['state-dir']]].flatMap(([k, v]) => (v === undefined ? [] : [k, v]));
  const rollbackTag = tagOf(pkg);
  const rollback = TAG.test(rollbackTag) && tags.includes(rollbackTag) ? `amauta upgrade --to ${rollbackTag}` : `git -C ${root} checkout --detach ${headSha} && amauta install`;
  out('Plan:');
  out(`  1. git fetch --tags origin`);
  out(`  2. ${switchCmd}   (in ${root}, branch ${branch})`);
  out(`  3. amauta install   (sticky flags are kept)`);
  out(`  4. amauta status`);
  if (values['dry-run']) { out('Dry run: nothing was changed.'); return 0; }

  if (!values.yes) {
    const ok = await confirm(`Move ${root} from ${pkg} to ${target}?`);
    if (ok === null) return fail('cannot ask for confirmation without a terminal; pass --yes');
    if (!ok) { out('Cancelled; nothing was changed.'); return 1; }
  }

  try { await git(root, ['fetch', '--tags', 'origin']); } catch (e) { return fail(`git fetch failed: ${String(e.message).split('\n')[0]}`); }
  if (!(await gitOrNull(root, ['rev-parse', '--verify', '-q', `refs/tags/${target}^{commit}`]))) return fail(`tag ${target} was not fetched`);
  try {
    await git(root, detach ? ['checkout', '--detach', `refs/tags/${target}`] : ['merge', '--ff-only', `refs/tags/${target}`]);
  } catch (e) {
    return fail(detach ? `git checkout failed: ${String(e.message).split('\n')[0]}` : `cannot fast-forward ${branch} to ${target} (the branch has commits that are not in the tag, or diverged); nothing was changed`);
  }

  const printTail = () => {
    out(`  rollback: ${rollback}`);
    if (detach) out(`  return to ${branch}: git -C ${root} checkout ${branch}   (this version has no 'upgrade' command if it predates v0.2.0)`);
  };
  if ((await runAmauta(['install', ...flags])) !== 0) {
    io.stderr.write(`amauta: install failed after moving to ${target}; the checkout is at ${target}\n`);
    printTail();
    return 1;
  }
  const statusCode = await runAmauta(['status', ...flags]);
  out(`Upgraded ${pkg} -> ${target}. Start a new Claude Code session to load the new hooks, skills and MCP servers.`);
  if (statusCode !== 0) out('  amauta status reported problems (see above).');
  printTail();
  return statusCode === 0 ? 0 : 1;
}
