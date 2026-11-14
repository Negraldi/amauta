import { cp, lstat, mkdir, readdir, readFile, readlink, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assetPath, installRoot, listFiles, readAssetBuffer, readAssetText } from './assets.js';
import { renderSddText } from './sdd.js';
import { renderImpeccableFiles } from './impeccable.js';
import { renderArchifyFiles } from './archify.js';
import { shellQuote } from './servers.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import { linkType } from '../core/platform.js';

/**
 * The amauta skill store: managed skills are rendered once into `<state dir>/skills/<name>`, and every runtime reaches
 * them through a symlink (`<claude home>/skills/<name>`, `<codex skills dir>/<name>`). Neither runtime owns the files.
 * Personal skills (real directories the user made in either runtime's skills dir) stay where they are and the other
 * runtime gets a symlink to them (a marked copy where links fail); nothing is ever moved.
 */
export const storeDirOf = (stateDir) => path.join(stateDir, 'skills');
/** Managed-file keys of skills look like `skills/<name>/<file>`; the store holds them at `<state dir>/<key>`. */
export const isSkillKey = (rel) => rel.startsWith('skills/');
export const storePathOf = (stateDir, rel) => path.join(stateDir, ...rel.split('/'));
export const skillNameOf = (rel) => rel.split('/')[1];

const posix = (rel) => rel.split(path.sep).join('/');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Markdown skill files may name helper code of this checkout; resolve those placeholders to shell-safe absolute values. */
export function renderSkillFile(rel, buf, pythonDir = path.join(installRoot, 'python')) {
  if (!rel.endsWith('.md')) return buf;
  let text = buf.toString('utf8');
  if (!text.includes('{{AMAUTA_')) return buf;
  // `amauta py <module>` (plan N8c): a plain node invocation, portable to Windows, that runs our Python modules with the
  // interpreter install resolved. The older `env PYTHONPATH=...` form stays rendered for a skill an earlier release wrote.
  text = text.replaceAll('{{AMAUTA_PY}}', `node ${shellQuote(path.join(installRoot, 'bin', 'amauta.js'))} py`);
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

/** Marker inside a skill directory that amauta copied because a link could not be made (plan N8b). */
export const COPY_MARKER = '.amauta-copy';
/** The store path a marked copy came from, or null for any other directory. */
const copyOrigin = (dir) => readFile(path.join(dir, COPY_MARKER), 'utf8').then((s) => s.trim(), () => null);

/** True when every file of `dir` (the marker aside) is byte-equal to the rendered files of skill `name`, and none is missing. */
async function sameAsRendered(dir, name, rendered) {
  const files = ((await filesUnder(dir)) ?? []).map(posix).filter((f) => f !== COPY_MARKER);
  const wanted = [...rendered.keys()].filter((k) => k.startsWith(`skills/${name}/`));
  if (files.length !== wanted.length) return false;
  for (const f of files) {
    const buf = await readFile(path.join(dir, f)).catch(() => null);
    if (buf === null || !rendered.get(`skills/${name}/${f}`)?.equals(buf)) return false;
  }
  return true;
}

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
    } else if (st.isDirectory() && (await copyOrigin(dest)) === target) {
      if (!(await sameAsRendered(dest, name, rendered))) link.push({ name, dest, target, replace: true }); // our copy, stale
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
    if ((await isOurSkillDir(dest, target))) unlink.push({ name, dest });
  }
  return { link, foreign, unlink };
}

/** Our link to `target`, or our marked copy of it. */
export const isOurSkillDir = async (dest, target) => (await readlinkOrNull(dest)) === target || (await copyOrigin(dest)) === target;

/** Replace `dest` with a copy of `target` carrying the marker. */
async function copyWithMarker(target, dest) {
  await rm(dest, { recursive: true, force: true });
  await cp(target, dest, { recursive: true });
  await writeFile(path.join(dest, COPY_MARKER), `${target}\n`);
}

/** Link a skill directory; when the platform refuses (no junction on FAT, some network drives), copy it with a marker. Returns 'link' or 'copy'. */
async function linkOrCopy(target, dest, link) {
  try {
    await link(target, dest, linkType());
    return 'link';
  } catch {
    await copyWithMarker(target, dest);
    return 'copy';
  }
}

export async function applyLinks({ link, unlink }, skillsDir, { symlink: linkFn = symlink } = {}) {
  if (link.length > 0) await mkdir(skillsDir, { recursive: true });
  for (const l of link) {
    if (l.replace) await rm(l.dest, { recursive: true, force: true });
    await linkOrCopy(l.target, l.dest, linkFn);
  }
  for (const u of unlink) await rm(u.dest, { recursive: true, force: true });
}

/** Remove the links in `recorded` ({name: target}) that still point where we put them. Returns the names removed. */
export async function removeLinks(skillsDir, recorded = {}) {
  const gone = [];
  for (const [name, target] of Object.entries(recorded)) {
    const dest = path.join(skillsDir, name);
    if (await isOurSkillDir(dest, target)) {
      await rm(dest, { recursive: true, force: true });
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
const asMap = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** `{links, copies}`, each {dest: target}; an old record has only `links`, so it still reads as links. */
async function readRecord(stateDir) {
  try {
    const rec = JSON.parse(await readFile(recordFile(stateDir), 'utf8'));
    return { links: asMap(rec?.links), copies: asMap(rec?.copies) };
  } catch {
    return { links: {}, copies: {} };
  }
}

async function writeRecord(stateDir, rec) {
  if (Object.keys(rec.links).length === 0 && Object.keys(rec.copies).length === 0) await rm(recordFile(stateDir), { force: true });
  else {
    const out = Object.keys(rec.copies).length > 0 ? rec : { links: rec.links };
    await writeFileAtomic(recordFile(stateDir), `${JSON.stringify(out, null, 2)}\n`);
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
    const d = path.join(dir, e.name);
    if ((await copyOrigin(d)) !== null) continue; // a copy we made, not a skill of the user's
    if ((await lstatOrNull(path.join(d, 'SKILL.md'))) !== null) out.push(e.name);
  }
  return out.sort();
}

/** True when `a` and `b` hold the same files with the same bytes (the copy marker aside). */
async function sameTree(a, b) {
  const list = async (d) => ((await filesUnder(d)) ?? []).map(posix).filter((f) => f !== COPY_MARKER).sort();
  const [fa, fb] = [await list(a), await list(b)];
  if (fa.length !== fb.length || fa.some((f, i) => f !== fb[i])) return false;
  for (const f of fa) {
    const [x, y] = await Promise.all([readFile(path.join(a, f)).catch(() => null), readFile(path.join(b, f)).catch(() => null)]);
    if (x === null || y === null || !x.equals(y)) return false;
  }
  return true;
}

/** Drop recorded entries that are gone or no longer ours, remove those whose real directory is gone, refresh stale copies. */
async function reconcileRecord(record, { dryRun, removed, copied }) {
  const next = { links: { ...record.links }, copies: { ...record.copies } };
  for (const [dest, target] of Object.entries(record.links)) {
    if ((await readlinkOrNull(dest)) !== target) delete next.links[dest]; // gone or no longer ours
    else if ((await lstatOrNull(target)) === null) {
      removed.push(path.basename(dest));
      if (!dryRun) await rm(dest, { force: true });
      delete next.links[dest];
    }
  }
  for (const [dest, target] of Object.entries(record.copies)) {
    if ((await copyOrigin(dest)) !== target) delete next.copies[dest]; // gone, or the marker is not ours any more
    else if ((await lstatOrNull(target)) === null) {
      removed.push(path.basename(dest));
      if (!dryRun) await rm(dest, { recursive: true, force: true });
      delete next.copies[dest];
    } else if (!(await sameTree(target, dest))) {
      copied.push(path.basename(dest));
      if (!dryRun) await copyWithMarker(target, dest);
    }
  }
  return next;
}

/**
 * Make personal skills visible in both runtimes: a real skill directory in one skills dir gets a symlink in the other,
 * or, when the platform refuses the link, a copy marked with `COPY_MARKER` that later syncs keep fresh.
 * `create: false` for a side means "do not create links there" (its runtime is absent). Records what it made in
 * `<state dir>/personal-skills.json` and drops what is gone. A dry run cannot know whether a link would be refused
 * and reports new entries as `linked`. Returns { linked, copied, removed, conflicts }.
 */
export async function syncPersonalSkills({ stateDir, sides, managed = new Set(), dryRun = false, symlink: linkFn = symlink }) {
  const record = await readRecord(stateDir);
  const [linked, copied, removed, conflicts] = [[], [], [], []];
  const next = await reconcileRecord(record, { dryRun, removed, copied });
  for (const from of sides) {
    for (const name of await personalIn(from.dir, managed)) {
      for (const to of sides) {
        if (to === from || to.create === false) continue;
        const dest = path.join(to.dir, name);
        const target = path.join(from.dir, name);
        const st = await lstatOrNull(dest);
        if (st === null) {
          let kind = 'link';
          if (!dryRun) {
            await mkdir(to.dir, { recursive: true });
            kind = await linkOrCopy(target, dest, linkFn);
          }
          if (kind === 'copy') {
            copied.push(name);
            next.copies[dest] = target;
          } else {
            linked.push(name);
            next.links[dest] = target;
          }
        } else if (st.isSymbolicLink() ? (await readlinkOrNull(dest)) !== target : next.copies[dest] !== target || (await copyOrigin(dest)) !== target) {
          conflicts.push(name); // something else already lives there
        }
      }
    }
  }
  if (!dryRun && JSON.stringify(next) !== JSON.stringify(record)) await writeRecord(stateDir, next);
  return { linked, copied: [...new Set(copied)], removed, conflicts: [...new Set(conflicts)].sort() };
}

/** Remove the personal links and copies this tool made inside `skillsDir` (a copy only while its marker still names the target). */
export async function removePersonalLinks({ stateDir, skillsDir }) {
  const record = await readRecord(stateDir);
  const next = { links: {}, copies: {} };
  const ours = { links: async (d, t) => (await readlinkOrNull(d)) === t, copies: async (d, t) => (await copyOrigin(d)) === t };
  for (const kind of ['links', 'copies']) {
    for (const [dest, target] of Object.entries(record[kind])) {
      if (path.dirname(dest) !== skillsDir) next[kind][dest] = target;
      else if (await ours[kind](dest, target)) await rm(dest, { recursive: true, force: true });
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(record)) await writeRecord(stateDir, next);
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
