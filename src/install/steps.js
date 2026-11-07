/**
 * Plan steps shared by the Claude and Codex installers (ADR 0002).
 *
 * Each step reads the current files and returns what to write, remove or link; nothing touches the disk except
 * `applyPlan`, which backs up first and then writes, removes and links. Both runtimes compose these steps with their
 * own parts (Claude: settings.json and .claude.json; Codex: hooks.json and config.toml).
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { injectSection, removeSection } from '../core/markers.js';
import { mergeHooks, removeHooksWhere } from '../core/jsonmerge.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import { createBackup, pruneEmptyDirs } from '../core/backup.js';
import { needsWrite, readOrNull, safeManagedPath, sha256 } from './files.js';
import { isAmautaHook, staleAmautaHooks } from './servers.js';
import { applyLinks, isSkillKey, namesOf, planManagedLinks, storeDirOf } from './skillstore.js';

/** Marked instruction blocks (CLAUDE.md or AGENTS.md): inject the current sections, drop ids no longer shipped. */
export async function planInstructionBlocks({ rel, file, sections, previousIds = [], retired = [] }) {
  const buf = await readOrNull(file);
  const before = buf ? buf.toString('utf8') : '';
  let md = before;
  for (const s of sections) md = injectSection(md, s.id, s.body);
  const wanted = new Set(sections.map((s) => s.id));
  for (const id of new Set([...previousIds, ...retired])) if (!wanted.has(id)) md = removeSection(md, id);
  const write = !buf || md !== before ? { rel, path: file, data: Buffer.from(md, 'utf8') } : null;
  return { write, existed: buf !== null, ids: sections.map((s) => s.id) };
}

/**
 * Managed files: write new or unedited ones, adopt identical ones, keep edited ones (skipped); remove files a
 * previous install wrote and this one no longer renders, only while byte-identical to what was written.
 * `fileOf(rel)` is where a key lives; `rootOf(rel)` is the directory a removal must stay inside; `keep(rel)` protects
 * store files the other runtime still uses.
 */
export async function planManagedFiles({ rendered, prevHashes = {}, fileOf, rootOf, keep = () => false, force = false }) {
  const writes = [];
  const removes = [];
  const skipped = [];
  const managedFiles = {};
  for (const [rel, data] of rendered) {
    const file = fileOf(rel);
    const existing = await readOrNull(file);
    if (existing !== null && !existing.equals(data) && !force && prevHashes[rel] !== sha256(existing)) {
      skipped.push(rel);
      continue;
    }
    if (existing === null || !existing.equals(data)) writes.push({ rel, path: file, data });
    managedFiles[rel] = sha256(data);
  }
  for (const [rel, hash] of Object.entries(prevHashes)) {
    if (rendered.has(rel) || keep(rel)) continue;
    const file = await safeManagedPath(rootOf(rel), rel);
    if (file === null) {
      skipped.push(rel);
      continue;
    }
    const buf = await readOrNull(file);
    if (buf === null) continue;
    if (sha256(buf) === hash) removes.push({ rel, path: file });
    else skipped.push(rel);
  }
  return { writes, removes, skipped, managedFiles };
}

/**
 * Links from a runtime's skills dir into the amauta store. A foreign directory is reported in `skipped`; a module
 * turned off keeps its link while an edited file of it stays in the store.
 */
export async function planSkillLinks({ skillsDir, stateDir, rendered, prevLinks = {}, prevHashes = {}, skipped, force = false }) {
  const storeDir = storeDirOf(stateDir);
  const names = namesOf(rendered);
  const linkPlan = await planManagedLinks({ skillsDir, storeDir, names, prevLinks, rendered, prevHashes, force });
  for (const name of linkPlan.foreign) skipped.push(`skills/${name} (not linked: a different directory is there)`);
  const stillThere = (name) => skipped.some((x) => x.startsWith(`skills/${name}/`));
  const keptLinks = linkPlan.unlink.filter((u) => stillThere(u.name));
  linkPlan.unlink = linkPlan.unlink.filter((u) => !stillThere(u.name));
  const skillLinks = {
    ...Object.fromEntries(names.filter((n) => !linkPlan.foreign.includes(n)).map((n) => [n, path.join(storeDir, n)])),
    ...Object.fromEntries(keptLinks.map((u) => [u.name, prevLinks[u.name]])),
  };
  return { linkPlan, skillLinks, names };
}

/** Hook document with stale amauta commands replaced by the wanted ones; `legacy` lists what was replaced. */
export function planOwnedHooks(doc, wantedHooks) {
  const wantedCommands = new Set(Object.values(wantedHooks).flatMap((es) => es.flatMap((e) => e.hooks.map((h) => h.command))));
  const legacy = staleAmautaHooks(doc, wantedCommands);
  const merged = mergeHooks(removeHooksWhere(doc, (c) => isAmautaHook(c) && !wantedCommands.has(c)), wantedHooks);
  return { doc: merged, legacy };
}

/** Only the writes whose bytes or mode differ from the disk. */
export async function realWrites(writes) {
  const out = [];
  for (const w of writes) if (await needsWrite(w.path, w.data, w.mode)) out.push(w);
  return out;
}

/** True when a plan changes any file or link. */
export const touchesDisk = ({ writes, removes, linkPlan }) =>
  writes.length > 0 || removes.length > 0 || linkPlan.link.length > 0 || linkPlan.unlink.length > 0;

/**
 * Back up every path the plan touches (plus `statePath`), then write, remove (pruning empty parents up to the store
 * or `homeRoot`) and link. Returns the backup directory.
 */
export async function applyPlan({ stateDir, statePath, homeRoot, skillsDir, writes, removes, linkPlan }) {
  const { dir } = await createBackup(stateDir, [...writes.map((w) => w.path), ...removes.map((r) => r.path), statePath]);
  for (const w of writes) await writeFileAtomic(w.path, w.data, w.mode === undefined ? {} : { mode: w.mode });
  for (const r of removes) {
    await rm(r.path, { force: true });
    await pruneEmptyDirs(path.dirname(r.path), isSkillKey(r.rel) ? storeDirOf(stateDir) : homeRoot);
  }
  await applyLinks(linkPlan, skillsDir);
  return dir;
}
