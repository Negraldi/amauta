import { rm } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { injectSection, removeSection, listSections } from '../core/markers.js';
import { mergeHooks, removeHooksWhere } from '../core/jsonmerge.js';
import { readMcpServer, removeMcpServer, setMcpServer } from '../core/toml.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import { createBackup, pruneEmptyDirs } from '../core/backup.js';
import { resolveClaudeSource, resolveCodexTargets } from './paths.js';
import { assetPath, listFiles, loadManifest, readAssetBuffer, readAssetText } from './assets.js';
import { ensureTimeouts, needsWrite, readJsonObject, readOrNull, renderSections, renderSkillFile, safeManagedPath, sha256, statOrNull, toJson, isObject } from './installer.js';
import { renderSddText } from './sdd.js';
import { desiredHooks, desiredMcpServers, isAmautaHook } from './servers.js';
import { findOnPath } from '../codegraph/index.js';
import { packageVersion } from '../version.js';

export const CODEX_STATE_SCHEMA = 'amauta.codex-state/v1';

/**
 * Codex is a second target of the Claude installer: the same manifest, the same content, other paths.
 *   CLAUDE.md blocks        -> <codex home>/AGENTS.md blocks (same marker injector)
 *   settings.json hooks     -> <codex home>/hooks.json (same hook schema; every command carries AMAUTA_RUNTIME=codex)
 *   ~/.claude/skills        -> ~/.agents/skills (the same skill set; SDD skills only with --with-sdd)
 *   .claude.json mcpServers -> <codex home>/config.toml [mcp_servers.<same name>] (same command, args and env)
 * Claude-only assets have no Codex meaning and are never installed: output styles (a Claude Code setting) and the
 * Claude agent definitions (Codex has no equivalent file format). Also not carried over: SDD slash commands and agents,
 * the SDD preflight hook (all Claude dispatch machinery), codegraph's own prompt hook, and the impeccable and archify
 * skills (their rendering is tied to the Claude home).
 * State lives next to Claude's, in <state dir>/codex-state.json; backups use the shared backup mechanism.
 */
const RUNTIME_ENV = 'AMAUTA_RUNTIME=codex';
/** The Claude hook set for Codex: same commands, tagged with the runtime. The SDD preflight guards Claude's Agent tool, so it is not carried over. */
export function desiredCodexHooks({ stateDir, telemetry }) {
  const hooks = desiredHooks({ stateDir, telemetry, sdd: false });
  return Object.fromEntries(Object.entries(hooks).map(([event, entries]) => [event, entries.map((e) => ({ ...e, hooks: e.hooks.map((h) => ({ ...h, command: `${RUNTIME_ENV} ${h.command}` })) }))]));
}

const isMemoryServer = (v) => Array.isArray(v?.args) && v.args.includes('amauta.memory');

/** The Claude MCP entries for Codex's TOML (no `type`: Codex infers stdio from `command`). Memory is always `engram`. */
export function desiredCodexServers({ stateDir, rea, context7, codegraph }) {
  const { memory, ...rest } = desiredMcpServers({ stateDir, rea, context7 });
  if (!codegraph) delete rest.codegraph;
  const strip = ({ type: _type, ...value }) => value;
  const out = Object.fromEntries(Object.entries({ engram: memory, ...rest }).map(([name, value]) => [name, strip(value)]));
  out.engram = { ...out.engram, env: { ...out.engram.env, AMAUTA_RUNTIME: 'codex' } };
  return out;
}

/**
 * Claude `mcpServers` -> what Codex's TOML can carry: stdio servers with command, args and env. `type` is dropped (Codex
 * infers stdio from `command`). Anything else (http/sse, extra keys, odd shapes) is listed in `unsupported` with a reason
 * that never contains a value. Our memory server is published as `engram` with the codex runtime tag, whatever key
 * Claude registered it under (`amauta-memory` when the user already had another `engram` there).
 */
export function mirrorServers(claudeServers) {
  const servers = {};
  const unsupported = [];
  const input = isObject(claudeServers) ? claudeServers : {};
  for (const [name, raw] of Object.entries(input)) {
    if (!isObject(raw)) {
      unsupported.push({ name, reason: 'not an object' });
      continue;
    }
    const { type, command, args, env, ...rest } = raw;
    if ((type !== undefined && type !== 'stdio') || typeof command !== 'string') {
      unsupported.push({ name, reason: `not a stdio server${type ? ` (${type})` : ''}` });
    } else if (Object.keys(rest).length > 0) {
      unsupported.push({ name, reason: `keys Codex config cannot take here: ${Object.keys(rest).join(', ')}` });
    } else if (args !== undefined && !(Array.isArray(args) && args.every((a) => typeof a === 'string'))) {
      unsupported.push({ name, reason: 'args are not a list of strings' });
    } else if (env !== undefined && !(isObject(env) && Object.values(env).every((v) => typeof v === 'string'))) {
      unsupported.push({ name, reason: 'env values are not strings' });
    } else {
      servers[name] = { command, ...(args !== undefined ? { args } : {}), ...(env !== undefined ? { env } : {}) };
    }
  }
  const foreignEngram = 'engram' in input && !isMemoryServer(servers.engram);
  for (const [name, value] of Object.entries(servers)) {
    if (!isMemoryServer(value)) continue;
    const key = name === 'engram' || foreignEngram ? name : 'engram';
    delete servers[name];
    servers[key] = { ...value, env: { ...value.env, AMAUTA_RUNTIME: 'codex' } };
  }
  return { servers, unsupported };
}

const posix = (rel) => rel.split(path.sep).join('/');

/** Skill files (path relative to the skills dir -> Buffer): the Claude set, SDD skills only when asked. */
async function renderCodexSkills(manifest, { sdd }) {
  const files = new Map();
  for (const skill of manifest.skills) {
    const dir = `${manifest.skillsDir}/${skill}`;
    for (const rel of await listFiles(assetPath(dir))) files.set(`${skill}/${posix(rel)}`, renderSkillFile(rel, await readAssetBuffer(`${dir}/${posix(rel)}`)));
  }
  for (const rel of await listFiles(assetPath(manifest.sharedSkillsDir))) files.set(`_shared/${posix(rel)}`, await readAssetBuffer(`${manifest.sharedSkillsDir}/${posix(rel)}`));
  if (sdd) {
    const addTree = async (srcDir, dest) => {
      for (const rel of await listFiles(assetPath(srcDir))) files.set(`${dest}/${posix(rel)}`, Buffer.from(renderSddText(await readAssetText(`${srcDir}/${posix(rel)}`)), 'utf8'));
    };
    for (const skill of manifest.sdd.skills) await addTree(`${manifest.sdd.skillsDir}/${skill}`, skill);
    await addTree(manifest.sdd.sharedDir, '_shared');
  }
  return files;
}

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
  // Opt-in modules are sticky like Claude's; a first Codex install follows what Claude already has.
  const sticky = (flag, key) => (flag === false ? false : flag === true || (prev ?? claudeState)?.[key] === true);
  const telemetry = opts.telemetry !== false;
  const sdd = sticky(opts.withSdd, 'sdd');
  const rea = sticky(opts.withRea, 'rea');
  const context7 = sticky(opts.withContext7, 'context7');
  const codegraph = (await findOnPath('codegraph', opts.searchPath)) !== null;
  const skipped = [];
  const created = prev?.created_files ?? [];
  const note = (file, existed) => {
    if (!existed && !created.includes(file) && prev === null) created.push(file);
  };

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

  note(mdFile, mdBuf !== null);

  // Skills: managed files under the skills dir; an edited one is the user's and stays (unless --force).
  const rendered = await renderCodexSkills(manifest, { sdd });
  const managedFiles = {};
  for (const [rel, data] of rendered) {
    const file = path.join(t.codexSkillsDir, ...rel.split('/'));
    const existing = await readOrNull(file);
    if (existing === null) writes.push({ rel: `skills/${rel}`, path: file, data });
    else if (existing.equals(data)) {
      // already in place: adopt
    } else if (opts.force || prev?.managed_files?.[rel] === sha256(existing)) writes.push({ rel: `skills/${rel}`, path: file, data });
    else {
      skipped.push(`skills/${rel}`);
      continue;
    }
    managedFiles[rel] = sha256(data);
  }
  const removes = [];
  for (const [rel, hash] of Object.entries(prev?.managed_files ?? {})) {
    if (rendered.has(rel)) continue;
    const file = await safeManagedPath(t.codexSkillsDir, rel);
    if (file === null) {
      skipped.push(`skills/${rel}`);
      continue;
    }
    const buf = await readOrNull(file);
    if (buf === null) continue;
    if (sha256(buf) === hash) removes.push({ rel: `skills/${rel}`, path: file });
    else skipped.push(`skills/${rel}`);
  }

  // hooks.json
  const hooksFile = path.join(t.codexHome, 'hooks.json');
  const hooksIn = await readJsonObject(hooksFile, 'hooks.json');
  const wantedHooks = desiredCodexHooks({ stateDir: t.stateDir, telemetry });
  const wantedCommands = new Set(Object.values(wantedHooks).flatMap((es) => es.flatMap((e) => e.hooks.map((h) => h.command))));
  let hooks = removeHooksWhere(hooksIn.data, (c) => isAmautaHook(c) && !wantedCommands.has(c));
  hooks = ensureTimeouts(mergeHooks(hooks, wantedHooks), wantedHooks);
  if (!hooksIn.existed || !isDeepStrictEqual(hooks, hooksIn.data)) writes.push({ rel: 'hooks.json', path: hooksFile, data: Buffer.from(toJson(hooks), 'utf8') });
  note(hooksFile, hooksIn.existed);

  // config.toml: only our [mcp_servers.*] tables; every other byte stays.
  const tomlFile = path.join(t.codexHome, 'config.toml');
  const tomlBuf = await readOrNull(tomlFile);
  const tomlBefore = tomlBuf ? tomlBuf.toString('utf8') : '';
  let toml = tomlBefore;
  const mirrorMcp = opts.mirrorMcp !== false; // default on; --no-mirror-mcp is per run, not sticky
  let mirror = { servers: {}, unsupported: [] };
  if (mirrorMcp) {
    const source = resolveClaudeSource(opts);
    const claudeJson = await readJsonObject(source.claudeJson, '.claude.json').catch(() => ({ data: {} }));
    mirror = mirrorServers(claudeJson.data.mcpServers);
  }
  const wanted = { ...desiredCodexServers({ stateDir: t.stateDir, rea, context7, codegraph }), ...mirror.servers };
  const ours = (name) => {
    const cur = readMcpServer(toml, name).value;
    return cur !== null && prev?.mcp_added?.[name] !== undefined && isDeepStrictEqual(cur, prev.mcp_added[name]);
  };
  const mcpAdded = {};
  const differs = [];
  for (const [name, value] of Object.entries(wanted)) {
    const cur = readMcpServer(toml, name);
    if (!cur.found || ours(name) || isDeepStrictEqual(cur.value, value)) {
      toml = setMcpServer(toml, name, value);
      mcpAdded[name] = value;
    } else {
      skipped.push(`config.toml:mcp_servers.${name}`);
      if (name in mirror.servers) differs.push(name);
    }
  }
  for (const name of Object.keys(prev?.mcp_added ?? {})) if (!(name in wanted) && ours(name)) toml = removeMcpServer(toml, name);
  if (!tomlBuf || toml !== tomlBefore) writes.push({ rel: 'config.toml', path: tomlFile, data: Buffer.from(toml, 'utf8') });
  note(tomlFile, tomlBuf !== null);
  const makeState = (lastBackup) => ({
    schema: CODEX_STATE_SCHEMA,
    version: packageVersion(),
    installed_at: prev?.installed_at ?? new Date().toISOString(),
    codex_home: t.codexHome,
    codex_skills_dir: t.codexSkillsDir,
    persona,
    last_backup: lastBackup ?? prev?.last_backup ?? null,
    agents_md_sections: sections.map((s) => s.id),
    managed_files: managedFiles,
    telemetry,
    sdd,
    rea,
    context7,
    mcp_added: mcpAdded,
    mirror_mcp: mirrorMcp,
    mcp_unsupported: mirror.unsupported.map((u) => u.name),
    created_files: created,
  });

  const real = [];
  for (const w of writes) if (await needsWrite(w.path, w.data, w.mode)) real.push(w);
  const mirrored = Object.keys(mirror.servers).filter((n) => n in mcpAdded);
  return { t, prev, writes: real, removes, skipped, makeState, mirror: { enabled: mirrorMcp, mirrored, unsupported: mirror.unsupported, differs } };
}

export async function installCodex(opts = {}) {
  const { t, prev, writes, removes, skipped, makeState, mirror } = await plan(opts);
  const files = writes.map((w) => w.rel);
  const removed = removes.map((r) => r.rel);
  const touches = writes.length > 0 || removes.length > 0;
  if (opts.dryRun) return { dryRun: true, changed: touches, files, removed, skipped, backup: null, mirror };

  const statePath = stateFileOf(t.stateDir);
  let backup = null;
  if (touches) {
    ({ dir: backup } = await createBackup(t.stateDir, [...writes.map((w) => w.path), ...removes.map((r) => r.path), statePath]));
    for (const w of writes) await writeFileAtomic(w.path, w.data, w.mode === undefined ? {} : { mode: w.mode });
    for (const r of removes) {
      await rm(r.path, { force: true });
      await pruneEmptyDirs(path.dirname(r.path), t.codexSkillsDir);
    }
  }
  const stateText = toJson(makeState(backup));
  const stateChanged = await needsWrite(statePath, stateText);
  if (stateChanged) await writeFileAtomic(statePath, stateText);
  return { dryRun: false, changed: touches || stateChanged || !prev, files, removed, skipped, backup, mirror };
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

  const hooksFile = path.join(t.codexHome, 'hooks.json');
  const hooksIn = await readJsonObject(hooksFile, 'hooks.json');
  if (hooksIn.existed) {
    const next = removeHooksWhere(hooksIn.data, isAmautaHook);
    if (!isDeepStrictEqual(next, hooksIn.data)) {
      if (created.has(hooksFile) && Object.keys(next).length === 0) deletes.push(hooksFile);
      else writes.push({ path: hooksFile, data: Buffer.from(toJson(next), 'utf8') });
    }
  }

  const tomlFile = path.join(t.codexHome, 'config.toml');
  const tomlBuf = await readOrNull(tomlFile);
  if (tomlBuf && state?.mcp_added) {
    const before = tomlBuf.toString('utf8');
    let toml = before;
    for (const [name, value] of Object.entries(state.mcp_added)) {
      const cur = readMcpServer(toml, name);
      if (cur.found && isDeepStrictEqual(cur.value, value)) toml = removeMcpServer(toml, name);
      else if (cur.found) kept.push(`mcp:${name}`);
    }
    if (toml !== before) {
      if (created.has(tomlFile) && toml.trim() === '') deletes.push(tomlFile);
      else writes.push({ path: tomlFile, data: Buffer.from(toml, 'utf8') });
    }
  }

  for (const [rel, hash] of Object.entries(state?.managed_files ?? {})) {
    const file = await safeManagedPath(t.codexSkillsDir, rel);
    if (file === null) {
      kept.push(`skills/${rel}`);
      continue;
    }
    const buf = await readOrNull(file);
    if (buf === null) continue;
    if (sha256(buf) === hash) deletes.push(file);
    else kept.push(`skills/${rel}`);
  }

  const statePath = stateFileOf(t.stateDir);
  const hadState = (await statOrNull(statePath)) !== null;
  if (writes.length === 0 && deletes.length === 0 && !hadState) return { changed: false, backup: null, removed: [], kept };

  let backup = null;
  if (writes.length > 0 || deletes.length > 0) {
    ({ dir: backup } = await createBackup(t.stateDir, [...writes.map((w) => w.path), ...deletes, statePath]));
  }
  for (const w of writes) await writeFileAtomic(w.path, w.data);
  for (const file of deletes) {
    await rm(file, { force: true });
    await pruneEmptyDirs(path.dirname(file), file.startsWith(t.codexSkillsDir + path.sep) ? t.codexSkillsDir : t.codexHome);
  }
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

  const hooks = (await readJsonObject(path.join(t.codexHome, 'hooks.json'), 'hooks.json')).data;
  const commands = (event) => (Array.isArray(hooks.hooks?.[event]) ? hooks.hooks[event] : []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
  for (const [event, entries] of Object.entries(desiredCodexHooks({ stateDir: t.stateDir, telemetry: state.telemetry === true }))) {
    for (const cmd of entries.flatMap((e) => e.hooks.map((h) => h.command))) {
      const ok = commands(event).includes(cmd);
      add(`hook ${event}`, ok, ok ? cmd : 'missing');
    }
  }
  const toml = (await readOrNull(path.join(t.codexHome, 'config.toml')))?.toString('utf8') ?? '';
  for (const name of Object.keys(state.mcp_added ?? {})) {
    const ok = readMcpServer(toml, name).found;
    add(`mcp ${name}`, ok, ok ? '' : 'missing');
  }
  for (const [rel, hash] of Object.entries(state.managed_files ?? {})) {
    const buf = await readOrNull(path.join(t.codexSkillsDir, ...rel.split('/')));
    if (buf === null) add(`skill ${rel}`, false, 'missing');
    else if (sha256(buf) !== hash) add(`skill ${rel}`, false, 'modified');
    else add(`skill ${rel}`, true);
  }
  const notes = [];
  if ((state.mcp_unsupported ?? []).length > 0) notes.push({ name: 'mcp not mirrored', ok: true, detail: `${state.mcp_unsupported.join(', ')} (Claude servers Codex config cannot take here: not stdio, or keys beyond command/args/env)` });
  notes.push({ name: 'hooks trust', ok: true, detail: 'Codex asks you to trust new or changed hooks in its own UI; amauta never writes [hooks.state]' });
  return { installed: true, ok: items.every((i) => i.ok), items, notes, state };
}

const RUNTIMES = ['claude', 'codex', 'both'];

/** Validate a --runtime value (undefined stays undefined: pick by what is on the machine). */
export function parseRuntime(value) {
  if (value !== undefined && !RUNTIMES.includes(value)) throw new Error(`--runtime must be claude, codex or both (got ${value})`);
  return value;
}

/** Runtimes a command acts on. Default: both when a Codex home directory exists, else Claude alone. */
export async function selectRuntimes(opts = {}) {
  if (opts.runtime === 'claude') return { runtimes: ['claude'], explicit: true };
  if (opts.runtime === 'codex') return { runtimes: ['codex'], explicit: true };
  if (opts.runtime === 'both') return { runtimes: ['claude', 'codex'], explicit: true };
  const present = (await statOrNull(resolveCodexTargets(opts).codexHome))?.isDirectory() === true;
  return { runtimes: present ? ['claude', 'codex'] : ['claude'], explicit: false };
}
