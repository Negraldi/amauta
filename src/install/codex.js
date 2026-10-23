import { rm } from 'node:fs/promises';
import path from 'node:path';
import { injectSection, removeSection, listSections } from '../core/markers.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import { createBackup } from '../core/backup.js';
import { resolveCodexTargets } from './paths.js';
import { loadManifest } from './assets.js';
import { needsWrite, readOrNull, renderSections, statOrNull, toJson, isObject } from './installer.js';
import { packageVersion } from '../version.js';

export const CODEX_STATE_SCHEMA = 'amauta.codex-state/v1';

/**
 * Codex is a second target of the Claude installer: the same manifest, the same content, other paths.
 *   CLAUDE.md blocks        -> <codex home>/AGENTS.md blocks (same marker injector)
 * Claude-only assets have no Codex meaning and are never installed: output styles (a Claude Code setting) and the
 * Claude agent definitions (Codex has no equivalent file format).
 * State lives next to Claude's, in <state dir>/codex-state.json; backups use the shared backup mechanism.
 */
const stateFileOf = (stateDir) => path.join(stateDir, 'codex-state.json');

async function readCodexState(stateDir) {
  const buf = await readOrNull(stateFileOf(stateDir));
  if (!buf) return null;
  try {
    const state = JSON.parse(buf.toString('utf8'));
    return isObject(state) && state.schema === CODEX_STATE_SCHEMA ? state : null;
  } catch {
    return null;
  }
}

async function readClaudeState(stateDir) {
  const buf = await readOrNull(path.join(stateDir, 'state.json'));
  if (!buf) return null;
  try {
    const state = JSON.parse(buf.toString('utf8'));
    return isObject(state) ? state : null;
  } catch {
    return null;
  }
}

async function plan(opts) {
  const t = resolveCodexTargets(opts);
  const manifest = await loadManifest();
  const prev = await readCodexState(t.stateDir);
  const claudeState = await readClaudeState(t.stateDir);
  const persona = opts.persona ?? prev?.persona ?? claudeState?.persona ?? 'gentleman';
  if (!manifest.personas[persona]) throw new Error(`unknown persona: ${persona} (expected gentleman or neutral)`);
  const writes = [];

  // AGENTS.md: the same marked blocks CLAUDE.md gets.
  const mdFile = path.join(t.codexHome, 'AGENTS.md');
  const mdBuf = await readOrNull(mdFile);
  const sections = await renderSections(manifest, persona);
  const mdBefore = mdBuf ? mdBuf.toString('utf8') : '';
  let md = mdBefore;
  for (const s of sections) md = injectSection(md, s.id, s.body);
  const wantedIds = new Set(sections.map((s) => s.id));
  for (const id of prev?.agents_md_sections ?? []) if (!wantedIds.has(id)) md = removeSection(md, id);
  if (!mdBuf || md !== mdBefore) writes.push({ rel: 'AGENTS.md', path: mdFile, data: Buffer.from(md, 'utf8') });

  const created = prev?.created_files ?? [...(mdBuf ? [] : [mdFile])];
  const makeState = (lastBackup) => ({
    schema: CODEX_STATE_SCHEMA,
    version: packageVersion(),
    installed_at: prev?.installed_at ?? new Date().toISOString(),
    codex_home: t.codexHome,
    codex_skills_dir: t.codexSkillsDir,
    persona,
    last_backup: lastBackup ?? prev?.last_backup ?? null,
    agents_md_sections: sections.map((s) => s.id),
    created_files: created,
  });

  const real = [];
  for (const w of writes) if (await needsWrite(w.path, w.data, w.mode)) real.push(w);
  return { t, prev, writes: real, removes: [], skipped: [], makeState };
}

export async function installCodex(opts = {}) {
  const { t, prev, writes, removes, skipped, makeState } = await plan(opts);
  const files = writes.map((w) => w.rel);
  const removed = removes.map((r) => r.rel);
  const touches = writes.length > 0 || removes.length > 0;
  if (opts.dryRun) return { dryRun: true, changed: touches, files, removed, skipped, backup: null };

  const statePath = stateFileOf(t.stateDir);
  let backup = null;
  if (touches) {
    ({ dir: backup } = await createBackup(t.stateDir, [...writes.map((w) => w.path), ...removes.map((r) => r.path), statePath]));
    for (const w of writes) await writeFileAtomic(w.path, w.data, w.mode === undefined ? {} : { mode: w.mode });
    for (const r of removes) await rm(r.path, { force: true });
  }
  const stateText = toJson(makeState(backup));
  const stateChanged = await needsWrite(statePath, stateText);
  if (stateChanged) await writeFileAtomic(statePath, stateText);
  return { dryRun: false, changed: touches || stateChanged || !prev, files, removed, skipped, backup };
}

export async function uninstallCodex(opts = {}) {
  const t = resolveCodexTargets(opts);
  const state = await readCodexState(t.stateDir);
  const created = new Set(state?.created_files ?? []);
  const writes = [];
  const deletes = [];
  const kept = [];

  const mdFile = path.join(t.codexHome, 'AGENTS.md');
  const mdBuf = await readOrNull(mdFile);
  if (mdBuf) {
    const before = mdBuf.toString('utf8');
    let md = before;
    for (const { id } of listSections(before)) md = removeSection(md, id);
    if (md !== before) {
      if (created.has(mdFile) && md.trim() === '') deletes.push(mdFile);
      else writes.push({ path: mdFile, data: Buffer.from(md, 'utf8') });
    }
  }

  const statePath = stateFileOf(t.stateDir);
  const hadState = (await statOrNull(statePath)) !== null;
  if (writes.length === 0 && deletes.length === 0 && !hadState) return { changed: false, backup: null, removed: [], kept };

  let backup = null;
  if (writes.length > 0 || deletes.length > 0) {
    ({ dir: backup } = await createBackup(t.stateDir, [...writes.map((w) => w.path), ...deletes, statePath]));
  }
  for (const w of writes) await writeFileAtomic(w.path, w.data);
  for (const file of deletes) await rm(file, { force: true });
  if (hadState) await rm(statePath, { force: true });
  return { changed: true, backup, removed: [...writes.map((w) => w.path), ...deletes], kept };
}

export async function statusCodex(opts = {}) {
  const t = resolveCodexTargets(opts);
  const state = await readCodexState(t.stateDir);
  if (!state) return { installed: false, ok: false, items: [] };
  const items = [];
  const add = (name, ok, detail = '') => items.push({ name, ok, detail });
  const md = (await readOrNull(path.join(t.codexHome, 'AGENTS.md')))?.toString('utf8') ?? '';
  const present = new Set(listSections(md).map((s) => s.id));
  for (const id of state.agents_md_sections ?? []) add(`AGENTS.md section ${id}`, present.has(id), present.has(id) ? '' : 'missing');
  return { installed: true, ok: items.every((i) => i.ok), items, notes: [], state };
}
