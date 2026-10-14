import { execFile } from 'node:child_process';

/** Run git without a shell. Resolves stdout; rejects with the git error on failure. */
export function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export const gitOrNull = (cwd, args) => git(cwd, args).then((s) => s, () => null);

/** Absolute path of the working tree root, or null when `cwd` is not inside a repository. */
export async function repoRoot(cwd) {
  const out = await gitOrNull(cwd, ['rev-parse', '--show-toplevel']);
  return out ? out.trim() : null;
}

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
