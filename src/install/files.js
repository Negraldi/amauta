/**
 * File helpers shared by both runtime installers (ADR 0002).
 *
 * Pure reads and comparisons: hashing, JSON parsing with a clear error, "does this file need writing", the safe
 * resolution of a managed_files key before a delete, and timeout repair on hook entries. No writes happen here.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, stat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const toJson = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
export const statOrNull = (p) => stat(p).then((s) => s, () => null);
export const readOrNull = (p) => readFile(p).then((b) => b, () => null);
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `{ data, existed }` for a JSON object file; a missing file is `{}`; unparsable or non-object content throws. */
export async function readJsonObject(file, label) {
  const buf = await readOrNull(file);
  if (buf === null) return { data: {}, existed: false };
  let data;
  try {
    data = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    throw new Error(`cannot parse ${label} (${file}): ${err.message}. Nothing was changed.`);
  }
  if (!isObject(data)) throw new Error(`${label} (${file}) is not a JSON object. Nothing was changed.`);
  return { data, existed: true };
}

/** True when `file` is missing, has another mode than `mode` (when given) or other bytes than `data`. */
export const needsWrite = async (file, data, mode) => {
  const st = await statOrNull(file);
  if (!st) return true;
  if (mode !== undefined && (st.mode & 0o777) !== mode) return true;
  const current = await readOrNull(file);
  return !current || !current.equals(Buffer.isBuffer(data) ? data : Buffer.from(data));
};

/**
 * Path of a managed_files key that is safe to delete, or null. state.json is plain data, so a key is untrusted:
 * no absolute paths, no `..`, the resolved target must stay inside `base`, and no component below `base` may be a
 * symlink (a symlinked parent would redirect the delete elsewhere).
 */
export async function safeManagedPath(base, rel) {
  const unsafe = typeof rel !== 'string' || rel === '' || rel.includes('\\') || rel.includes('\0');
  if (unsafe || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  const root = path.resolve(base);
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(root + path.sep)) return null;
  let cur = root;
  for (const part of parts) {
    cur = path.join(cur, part);
    const st = await lstat(cur).catch(() => null);
    if (st === null) return target; // nothing there (yet): the caller sees a missing file
    if (st.isSymbolicLink()) return null;
  }
  return target;
}

/** Set `timeout` on installed hooks that lack one, matched by event and exact command from `owned`. */
export function ensureTimeouts(settings, owned) {
  let out = settings;
  for (const [event, entries] of Object.entries(owned)) {
    const want = new Map(entries.flatMap((e) => e.hooks).filter((h) => h.timeout).map((h) => [h.command, h.timeout]));
    const current = out.hooks?.[event];
    if (!Array.isArray(current)) continue;
    const fill = (h) => (h && want.has(h.command) && h.timeout === undefined ? { ...h, timeout: want.get(h.command) } : h);
    const next = current.map((e) => (!Array.isArray(e?.hooks) ? e : { ...e, hooks: e.hooks.map(fill) }));
    if (!isDeepStrictEqual(next, current)) out = { ...out, hooks: { ...out.hooks, [event]: next } };
  }
  return out;
}
