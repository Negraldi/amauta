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

// Conservative whitelist for user-supplied refs: branch/tag names, shas and ~ / ^ suffixes.
// Rejects option-shaped values (leading "-"), range syntax (".."), whitespace and control characters.
const SAFE_REF = /^[A-Za-z0-9_@/+^~][A-Za-z0-9_@/+^~.-]*$/;

export function validateRef(ref) {
  if (typeof ref !== 'string' || ref === '' || ref.length > 256 || !SAFE_REF.test(ref) || ref.includes('..')) {
    throw new Error(`invalid base ref: ${typeof ref === 'string' ? JSON.stringify(ref.slice(0, 80)) : typeof ref}`);
  }
  return ref;
}

/**
 * Validate `ref` and resolve it to a full commit sha. validateRef already rejects anything starting with "-" and the
 * `^{commit}` suffix keeps the argument from being option-shaped, so `--end-of-options` (git >= 2.24 only) is not needed.
 */
export async function resolveCommit(cwd, ref) {
  validateRef(ref);
  const out = await git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return out.trim();
}
