import { mkdir, readdir, readFile, stat, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './fsatomic.js';

export const BACKUP_SCHEMA = 'gentle-lite.backup/v1';

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const statOrNull = (p) => stat(p).then((s) => s, () => null);

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

/** Restore files that existed; delete files that did not exist before the backup. */
export async function restoreBackup(dir) {
  const manifest = await readManifest(dir);
  for (const e of manifest.entries) {
    if (e.existed) {
      await writeFileAtomic(e.original_path, await readFile(path.join(dir, e.snapshot_path)), { mode: e.mode });
    } else {
      await rm(e.original_path, { force: true });
    }
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
      // not a gentle-lite backup; ignore
    }
  }
  return out;
}
