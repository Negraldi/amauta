import { mkdir, readdir, readFile, stat, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './fsatomic.js';

export const BACKUP_SCHEMA = 'amauta.backup/v1';

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
// Only a missing path counts as "did not exist"; any other failure (EACCES, ENOTDIR, ELOOP...)
// must surface so a backup never claims a file was absent when it merely could not be read.
const statOrNull = (p) =>
  stat(p).then(
    (s) => s,
    (err) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    },
  );

async function uniqueDir(root, name) {
  for (let n = 0; ; n += 1) {
    const dir = path.join(root, n === 0 ? name : `${name}-${String(n).padStart(3, '0')}`);
    try {
      await mkdir(dir);
      return dir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

/**
 * Snapshot `paths` into <stateDir>/backups/<timestamp>/ with a manifest.
 * Paths that do not exist are recorded with existed:false so a restore deletes them.
 */
export async function createBackup(stateDir, paths, opts = {}) {
  const now = opts.now ?? new Date();
  const root = path.join(stateDir, 'backups');
  await mkdir(root, { recursive: true });
  const dir = await uniqueDir(root, stamp(now));
  await mkdir(path.join(dir, 'files'));

  const entries = [];
  const seen = new Set();
  for (const p of paths) {
    const original = path.resolve(p);
    if (seen.has(original)) continue;
    seen.add(original);
    const st = await statOrNull(original);
    if (st?.isDirectory()) throw new Error(`cannot back up a directory: ${original}`);
    if (!st) {
      entries.push({ original_path: original, snapshot_path: null, existed: false, mode: null });
      continue;
    }
    const rel = path.join('files', `${entries.length}-${path.basename(original)}`);
    await copyFile(original, path.join(dir, rel));
    entries.push({ original_path: original, snapshot_path: rel, existed: true, mode: st.mode & 0o777 });
  }

  const manifest = { schema: BACKUP_SCHEMA, created_at: now.toISOString(), entries };
  await writeFileAtomic(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest };
}

export async function readManifest(dir) {
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.schema !== BACKUP_SCHEMA) throw new Error(`unsupported backup schema: ${manifest.schema}`);
  return manifest;
}

/**
 * Restore files that existed; delete files that did not exist before the backup.
 * Every entry is validated first so a damaged backup mutates nothing; a failure
 * midway throws an error listing what was restored and what is still pending.
 */
export async function restoreBackup(dir) {
  const manifest = await readManifest(dir);
  for (const e of manifest.entries) {
    if (!e.existed) continue;
    const snapshot = e.snapshot_path ? path.join(dir, e.snapshot_path) : null;
    const st = snapshot ? await stat(snapshot).catch(() => null) : null;
    if (!st?.isFile()) throw new Error(`backup snapshot missing or unreadable for ${e.original_path}; nothing was restored`);
  }
  const restored = [];
  for (let i = 0; i < manifest.entries.length; i += 1) {
    const e = manifest.entries[i];
    try {
      if (e.existed) {
        await writeFileAtomic(e.original_path, await readFile(path.join(dir, e.snapshot_path)), { mode: e.mode });
      } else {
        await rm(e.original_path, { force: true });
      }
    } catch (cause) {
      const pending = manifest.entries.slice(i).map((x) => x.original_path);
      const err = new Error(
        `restore failed at ${e.original_path}: ${cause.message}\nrestored: ${restored.join(', ') || '(none)'}\npending: ${pending.join(', ')}`,
        { cause },
      );
      err.restored = restored;
      err.pending = pending;
      throw err;
    }
    restored.push(e.original_path);
  }
  return manifest;
}

/** Newest first. */
export async function listBackups(stateDir) {
  const root = path.join(stateDir, 'backups');
  const names = await readdir(root).catch(() => []);
  const out = [];
  for (const name of names.sort().reverse()) {
    const dir = path.join(root, name);
    try {
      out.push({ dir, manifest: await readManifest(dir) });
    } catch {
      // not a amauta backup; ignore
    }
  }
  return out;
}
