import { open, rename, readFile, stat, mkdir, chmod, realpath, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const statOrNull = (p) => stat(p).then((s) => s, () => null);

/**
 * Atomically write `data` to `file` (temp file in the same directory + rename).
 * - creates parent directories
 * - mode: explicit `opts.mode`, else the existing file's mode, else 0o644
 * - writes through a symlink instead of replacing it
 * - returns false (and writes nothing) when content and mode already match
 */
export async function writeFileAtomic(file, data, opts = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const target = await realpath(file).catch(() => path.resolve(file));
  const existing = await statOrNull(target);
  const mode = opts.mode ?? (existing ? existing.mode & 0o777 : 0o644);

  if (existing) {
    const current = await readFile(target).catch(() => null);
    if (current && current.equals(buf)) {
      if ((existing.mode & 0o777) === mode) return false;
      await chmod(target, mode);
      return true;
    }
  }

  await mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const fh = await open(tmp, 'wx', mode);
  try {
    await fh.writeFile(buf);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await chmod(tmp, mode); // umask-proof
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return true;
}
