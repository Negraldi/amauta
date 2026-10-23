import { lstat, mkdir, readdir, readFile, readlink, rm, rmdir, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assetPath, listFiles, readAssetBuffer, readAssetText, repoRoot } from './assets.js';
import { renderSddText } from './sdd.js';
import { renderImpeccableFiles } from './impeccable.js';
import { renderArchifyFiles } from './archify.js';
import { shellQuote } from './servers.js';
import { writeFileAtomic } from '../core/fsatomic.js';

/**
 * The amauta skill store: managed skills are rendered once into `<state dir>/skills/<name>`, and every runtime reaches
 * them through a symlink (`<claude home>/skills/<name>`, `<codex skills dir>/<name>`). Neither runtime owns the files.
 * Personal skills (real directories the user made in either runtime's skills dir) stay where they are and the other
 * runtime gets a symlink to them; nothing is ever copied or moved.
 */
export const storeDirOf = (stateDir) => path.join(stateDir, 'skills');
/** Managed-file keys of skills look like `skills/<name>/<file>`; the store holds them at `<state dir>/<key>`. */
export const isSkillKey = (rel) => rel.startsWith('skills/');
export const storePathOf = (stateDir, rel) => path.join(stateDir, ...rel.split('/'));
export const skillNameOf = (rel) => rel.split('/')[1];

const posix = (rel) => rel.split(path.sep).join('/');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Markdown skill files may name helper code of this checkout; resolve those placeholders to shell-safe absolute values. */
export function renderSkillFile(rel, buf, pythonDir = path.join(repoRoot, 'python')) {
  if (!rel.endsWith('.md')) return buf;
  let text = buf.toString('utf8');
  if (!text.includes('{{AMAUTA_')) return buf;
  // The whole `NAME=value` assignment is quoted, so a checkout path with spaces or quotes still forms one `env` argument.
  text = text.replaceAll('{{AMAUTA_PYTHONPATH_ENV}}', shellQuote(`PYTHONPATH=${pythonDir}`));
  return Buffer.from(text, 'utf8');
}

/** Every managed skill file for the chosen modules: `skills/<name>/<file>` -> Buffer. */
export async function renderSkillSet(manifest, { sdd, impeccable, archify, stateDir }) {
  const files = new Map();
  for (const skill of manifest.skills) {
    const dir = `${manifest.skillsDir}/${skill}`;
    for (const rel of await listFiles(assetPath(dir))) files.set(`skills/${skill}/${posix(rel)}`, renderSkillFile(rel, await readAssetBuffer(`${dir}/${posix(rel)}`)));
  }
  for (const rel of await listFiles(assetPath(manifest.sharedSkillsDir))) files.set(`skills/_shared/${posix(rel)}`, await readAssetBuffer(`${manifest.sharedSkillsDir}/${posix(rel)}`));
  if (sdd) {
    const addTree = async (srcDir, dest) => {
      for (const rel of await listFiles(assetPath(srcDir))) files.set(`${dest}/${posix(rel)}`, Buffer.from(renderSddText(await readAssetText(`${srcDir}/${posix(rel)}`)), 'utf8'));
    };
    for (const skill of manifest.sdd.skills) await addTree(`${manifest.sdd.skillsDir}/${skill}`, `skills/${skill}`);
    await addTree(manifest.sdd.sharedDir, 'skills/_shared');
  }
  if (impeccable) for (const [rel, data] of await renderImpeccableFiles(manifest, { stateDir })) files.set(rel, data);
  if (archify) for (const [rel, data] of await renderArchifyFiles(manifest)) files.set(rel, data);
  return files;
}

export const namesOf = (rendered) => [...new Set([...rendered.keys()].filter(isSkillKey).map(skillNameOf))].sort();

export const lstatOrNull = (p) => lstat(p).then((s) => s, () => null);
const readlinkOrNull = (p) => readlink(p).then((s) => s, () => null);

async function filesUnder(dir) {
  try {
    return await listFiles(dir);
  } catch {
    return null;
  }
}

/**
 * Links a runtime's skills dir should hold for the managed `names`, plus those to drop.
 *   link:    nothing there yet, or a real directory whose every file is byte-equal to what amauta installed
 *            (rendered now, or the hash an earlier install recorded): a legacy copy, replaced by the link.
 *   foreign: something else is there (an edited copy, the user's own directory, another link): left alone, reported.
 *   unlink:  a link we made earlier for a name that is no longer managed.
 */
export async function planManagedLinks({ skillsDir, storeDir, names, prevLinks = {}, rendered, prevHashes = {}, force = false }) {
  const link = [];
  const foreign = [];
  for (const name of names) {
    const dest = path.join(skillsDir, name);
    const target = path.join(storeDir, name);
    const st = await lstatOrNull(dest);
    if (st === null) link.push({ name, dest, target, replace: false });
    else if (st.isSymbolicLink()) {
      const cur = await readlinkOrNull(dest);
      if (cur === target) continue;
      if (prevLinks[name] !== undefined && cur === prevLinks[name]) link.push({ name, dest, target, replace: true }); // the store moved
      else foreign.push(name);
    } else if (st.isDirectory()) {
      const files = await filesUnder(dest);
      let legacy = files !== null && files.length > 0;
      for (const f of files ?? []) {
        const key = `skills/${name}/${posix(f)}`;
        const buf = await readFile(path.join(dest, f)).catch(() => null);
        if (buf === null || !(rendered.get(key)?.equals(buf) || prevHashes[key] === sha(buf))) legacy = false;
      }
      if (legacy) link.push({ name, dest, target, replace: true });
      else foreign.push(name);
    } else foreign.push(name);
  }
  if (force) while (foreign.length > 0) { const name = foreign.pop(); link.push({ name, dest: path.join(skillsDir, name), target: path.join(storeDir, name), replace: true }); }
  const unlink = [];
  for (const [name, target] of Object.entries(prevLinks)) {
    if (names.includes(name)) continue;
    const dest = path.join(skillsDir, name);
    if ((await readlinkOrNull(dest)) === target) unlink.push({ name, dest });
  }
  return { link, foreign, unlink };
}

export async function applyLinks({ link, unlink }, skillsDir) {
  if (link.length > 0) await mkdir(skillsDir, { recursive: true });
  for (const l of link) {
    if (l.replace) await rm(l.dest, { recursive: true, force: true });
    await symlink(l.target, l.dest);
  }
  for (const u of unlink) await rm(u.dest, { force: true });
}

/** Remove the links in `recorded` ({name: target}) that still point where we put them. Returns the names removed. */
export async function removeLinks(skillsDir, recorded = {}) {
  const gone = [];
  for (const [name, target] of Object.entries(recorded)) {
    const dest = path.join(skillsDir, name);
    if ((await readlinkOrNull(dest)) === target) {
      await rm(dest, { force: true });
      gone.push(name);
    }
  }
  try {
    await rmdir(skillsDir);
  } catch {
    // not empty or missing: fine
  }
  return gone;
}

// ---- personal skills --------------------------------------------------------------------------------------------------
const recordFile = (stateDir) => path.join(stateDir, 'personal-skills.json');

async function readRecord(stateDir) {
  try {
    const rec = JSON.parse(await readFile(recordFile(stateDir), 'utf8'));
    return rec && typeof rec === 'object' && rec.links && typeof rec.links === 'object' ? rec.links : {};
  } catch {
    return {};
  }
}

async function personalIn(dir, managed) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_') || managed.has(e.name)) continue; // real directories only
    if ((await lstatOrNull(path.join(dir, e.name, 'SKILL.md'))) !== null) out.push(e.name);
  }
  return out.sort();
}

/**
 * Make personal skills visible in both runtimes: a real skill directory in one skills dir gets a symlink in the other.
 * `create: false` for a side means "do not create links there" (its runtime is absent). Records the links it made in
 * `<state dir>/personal-skills.json` and drops the ones whose real directory is gone. Returns { linked, removed, conflicts }.
 */
export async function syncPersonalSkills({ stateDir, sides, managed = new Set(), dryRun = false }) {
  const record = await readRecord(stateDir);
  const linked = [];
  const removed = [];
  const conflicts = [];
  const next = { ...record };
  for (const [dest, target] of Object.entries(record)) {
    if ((await readlinkOrNull(dest)) !== target) delete next[dest]; // gone or no longer ours
    else if ((await lstatOrNull(target)) === null) {
      removed.push(path.basename(dest));
      if (!dryRun) await rm(dest, { force: true });
      delete next[dest];
    }
  }
  for (const from of sides) {
    for (const name of await personalIn(from.dir, managed)) {
      for (const to of sides) {
        if (to === from || to.create === false) continue;
        const dest = path.join(to.dir, name);
        const target = path.join(from.dir, name);
        const st = await lstatOrNull(dest);
        if (st === null) {
          linked.push(name);
          if (!dryRun) {
            await mkdir(to.dir, { recursive: true });
            await symlink(target, dest);
          }
          next[dest] = target;
        } else if (!(st.isSymbolicLink() && (await readlinkOrNull(dest)) === target)) conflicts.push(name); // something else already lives there
      }
    }
  }
  if (!dryRun && JSON.stringify(next) !== JSON.stringify(record)) await writeFileAtomic(recordFile(stateDir), `${JSON.stringify({ links: next }, null, 2)}\n`);
  return { linked, removed, conflicts: [...new Set(conflicts)].sort() };
}

/** Remove the personal links this tool made inside `skillsDir`. */
export async function removePersonalLinks({ stateDir, skillsDir }) {
  const record = await readRecord(stateDir);
  const next = {};
  for (const [dest, target] of Object.entries(record)) {
    if (path.dirname(dest) === skillsDir) {
      if ((await readlinkOrNull(dest)) === target) await rm(dest, { force: true });
    } else next[dest] = target;
  }
  if (JSON.stringify(next) !== JSON.stringify(record)) {
    if (Object.keys(next).length === 0) await rm(recordFile(stateDir), { force: true });
    else await writeFileAtomic(recordFile(stateDir), `${JSON.stringify({ links: next }, null, 2)}\n`);
  }
}

export async function readJsonFile(file) {
  try {
    const v = JSON.parse(await readFile(file, 'utf8'));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Remove links in `skillsDir` that point into the store and whose target no longer exists. */
export async function removeDanglingLinks(skillsDir, storeDir) {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isSymbolicLink()) continue;
    const dest = path.join(skillsDir, e.name);
    const target = await readlinkOrNull(dest);
    if (target !== null && target.startsWith(storeDir + path.sep) && (await lstatOrNull(target)) === null) await rm(dest, { force: true });
  }
  try {
    await rmdir(skillsDir);
  } catch {
    // not empty
  }
}

/** Remove empty directories below `root` (not `root` itself). */
export async function pruneEmptyTree(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    await pruneEmptyTree(dir);
    await rmdir(dir).catch(() => {});
  }
}
