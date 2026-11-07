import { readlink, rm, rmdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { injectSection, removeSection, listSections } from '../core/markers.js';
import { mergeHooks, removeHooksWhere } from '../core/jsonmerge.js';
import { mcpCore, readMcpServer, removeMcpServer, setMcpServer } from '../core/toml.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import { createBackup, pruneEmptyDirs } from '../core/backup.js';
import { resolveClaudeSource, resolveCodexTargets } from './paths.js';
import { loadManifest } from './assets.js';
import { baseFileOf, planMcpSync } from './mcpsync.js';
import { sourceFingerprint, syncRecordOf } from './fingerprint.js';
import { renderSections } from './installer.js';
import { ensureTimeouts, needsWrite, readJsonObject, readOrNull, safeManagedPath, sha256, statOrNull, toJson, isObject } from './files.js';
import { applyPlan, planInstructionBlocks, planManagedFiles, planOwnedHooks, planSkillLinks, realWrites, touchesDisk } from './steps.js';
import { applyLinks, isSkillKey, namesOf, planManagedLinks, readJsonFile, removeLinks, removePersonalLinks, renderSkillSet, storeDirOf, storePathOf, syncPersonalSkills } from './skillstore.js';
import { AMAUTA_SERVER_NAMES, LEGACY_SERVER_ALIASES, desiredHooks, desiredMcpServers, isAmautaHook, isStaleAmautaServer, staleAmautaHooks } from './servers.js';
import { findOnPath } from '../codegraph/index.js';
import { engineVersion, ensureEngine, removeEngine } from './impeccable.js';
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

/** The Claude MCP entries for Codex's TOML (no `type`: Codex infers stdio from `command`). Memory is always `engram`. */
export function desiredCodexServers({ stateDir, rea, context7, codegraph }) {
  const { memory, ...rest } = desiredMcpServers({ stateDir, rea, context7 });
  if (!codegraph) delete rest.codegraph;
  const strip = ({ type: _type, ...value }) => value;
  const out = Object.fromEntries(Object.entries({ engram: memory, ...rest }).map(([name, value]) => [name, strip(value)]));
  out.engram = { ...out.engram, env: { ...out.engram.env, AMAUTA_RUNTIME: 'codex' } };
  return out;
}

/** Opt-in third-party servers whose command/args/env come from whichever runtime already has them. */
const SHARED_SERVERS = ['rea', 'context7', 'codegraph'];

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

/** Options for a Codex install: sticky like Claude's; a first Codex install follows what Claude already has. */
async function resolveCodexOptions(opts, manifest, prev, claudeState) {
  const persona = opts.persona ?? prev?.persona ?? claudeState?.persona ?? 'gentleman';
  if (!manifest.personas[persona]) throw new Error(`unknown persona: ${persona} (expected gentleman or neutral)`);
  const sticky = (flag, key) => (flag === false ? false : flag === true || (prev ?? claudeState)?.[key] === true);
  // Skill modules follow either runtime: the store holds one rendering and both runtimes link the same names.
  const either = (flag, key) => (flag === false ? false : flag === true || prev?.[key] === true || claudeState?.[key] === true);
  return {
    persona,
    telemetry: opts.telemetry !== false,
    sdd: sticky(opts.withSdd, 'sdd'),
    rea: sticky(opts.withRea, 'rea'),
    context7: sticky(opts.withContext7, 'context7'),
    impeccable: either(opts.withImpeccable, 'impeccable'),
    archify: either(opts.withArchify, 'archify'),
    codegraph: (await findOnPath('codegraph', opts.searchPath)) !== null,
  };
}

/** Names of the MCP servers in .claude.json (for opt-in servers whose entry the other runtime already owns). */
function claudeServerNames(claudeBuf) {
  try {
    const parsed = JSON.parse(claudeBuf?.toString('utf8') ?? '{}');
    return isObject(parsed?.mcpServers) ? new Set(Object.keys(parsed.mcpServers)) : new Set();
  } catch {
    return new Set();
  }
}

/** Our [mcp_servers.*] tables in config.toml; returns the new text, what was added, and the one-way (managed) names. */
function planOwnServers({ toml: tomlIn, wanted, prev, claudeNames, legacy, skipped }) {
  let toml = tomlIn;
  const ours = (name) => {
    const cur = readMcpServer(toml, name).value;
    return cur !== null && prev?.mcp_added?.[name] !== undefined && isDeepStrictEqual(mcpCore(cur), mcpCore(prev.mcp_added[name]));
  };
  const mcpAdded = {};
  // Opt-in third-party servers (rea, context7, codegraph) follow the entry the other runtime already has (command, args,
  // env) through the normal two-way sync; the template applies only when neither runtime has one.
  const oneWay = new Set(Object.keys(wanted).filter((n) => !SHARED_SERVERS.includes(n)));
  for (const [name, value] of Object.entries(wanted)) {
    const cur = readMcpServer(toml, name);
    if (SHARED_SERVERS.includes(name)) {
      if (claudeNames.has(name) || (cur.found && !ours(name))) continue; // an entry exists: the sync owns it
      oneWay.add(name); // template-only so far: stays amauta's until a runtime gains its own entry
    }
    const old = cur.found && !ours(name) && isStaleAmautaServer(cur.value);
    if (!cur.found || ours(name) || isDeepStrictEqual(mcpCore(cur.value), mcpCore(value)) || old) {
      if (old) legacy.push(`mcp ${name}`);
      toml = setMcpServer(toml, name, value);
      mcpAdded[name] = value;
    } else skipped.push(`config.toml:mcp_servers.${name}`);
  }
  for (const name of Object.keys(prev?.mcp_added ?? {})) if (!(name in wanted) && ours(name)) toml = removeMcpServer(toml, name);
  for (const name of LEGACY_SERVER_ALIASES) {
    if (name in wanted || !isStaleAmautaServer(readMcpServer(toml, name).value)) continue;
    toml = removeMcpServer(toml, name);
    legacy.push(`mcp ${name}`);
  }
  return { toml, mcpAdded, oneWay };
}

const NO_MIRROR = { mirrored: [], toClaude: [], removed: [], conflicts: [], transport: [], unsupported: [], excluded: [], staleExcluded: [], unreadable: null };

/** Every other stdio server goes both ways between .claude.json and config.toml (3-way merge against the last synced set). */
async function planMirror({ opts, t, toml, oneWay, claudeBuf, writes }) {
  if (opts.mirrorMcp === false) return { toml, mirror: { enabled: false, ...NO_MIRROR } }; // --no-mirror-mcp is per run
  const source = resolveClaudeSource(opts);
  const baseBuf = await readOrNull(baseFileOf(t.stateDir));
  let base = {};
  let exclude = []; // the user's own list: <state dir>/mcp-sync.json { "exclude": [...] }
  try {
    const parsed = JSON.parse(baseBuf?.toString('utf8') ?? '{}');
    base = parsed.servers ?? {};
    if (Array.isArray(parsed.exclude)) exclude = parsed.exclude.filter((n) => typeof n === 'string');
  } catch {
    base = {};
  }
  if (claudeBuf === null) return { toml, mirror: { enabled: true, ...NO_MIRROR } };
  const internalPaths = [{ path: '/usr/lib/chatgpt', runtime: 'codex' }, { path: '/opt/claude', runtime: 'claude' },
    { path: t.codexHome, runtime: 'codex' }, { path: source.claudeHome, runtime: 'claude' }];
  const r = planMcpSync({ claudeText: claudeBuf.toString('utf8'), tomlText: toml, base, managed: oneWay, exclude, internalPaths });
  const rp = r.report;
  const removed = [...rp.removedFromCodex.map((n) => `codex:${n}`), ...rp.removedFromClaude.map((n) => `claude:${n}`), ...rp.removedExcluded];
  const mirror = { enabled: true, mirrored: rp.toCodex, toClaude: rp.toClaude, removed, excluded: rp.excluded, staleExcluded: rp.staleExcluded,
    conflicts: rp.conflicts, transport: rp.transport, unsupported: rp.unsupported, unreadable: rp.unreadable };
  if (r.claudeText !== null) writes.push({ rel: '.claude.json', path: source.claudeJson, data: Buffer.from(r.claudeText, 'utf8'), mode: 0o600 });
  if (r.base !== base || baseBuf === null) {
    const text = toJson({ schema: 'amauta.mcp-sync/v1', servers: r.base, ...(exclude.length > 0 ? { exclude } : {}) });
    const worth = Object.keys(r.base).length > 0 || exclude.length > 0 || baseBuf !== null;
    if (baseBuf?.toString('utf8') !== text && worth) writes.push({ rel: 'mcp-sync.json', path: baseFileOf(t.stateDir), data: Buffer.from(text, 'utf8') });
  }
  return { toml: r.toml, mirror };
}

function codexState({ t, prev, o, md, managed, links, mcpAdded, mirror, created }) {
  return (lastBackup) => ({
    schema: CODEX_STATE_SCHEMA,
    version: packageVersion(),
    installed_at: prev?.installed_at ?? new Date().toISOString(),
    codex_home: t.codexHome,
    codex_skills_dir: t.codexSkillsDir,
    persona: o.persona,
    last_backup: lastBackup ?? prev?.last_backup ?? null,
    agents_md_sections: md.ids,
    managed_files: managed.managedFiles,
    skill_links: links.skillLinks,
    telemetry: o.telemetry,
    sdd: o.sdd,
    impeccable: o.impeccable,
    archify: o.archify,
    rea: o.rea,
    context7: o.context7,
    mcp_added: mcpAdded,
    mcp_unsupported: mirror.unsupported.map((u) => u.name),
    created_files: created,
  });
}

async function plan(opts) {
  const t = resolveCodexTargets(opts);
  const manifest = await loadManifest();
  const prev = await readCodexState(t.stateDir);
  const claudeState = await readClaudeState(t.stateDir);
  const o = await resolveCodexOptions(opts, manifest, prev, claudeState);
  const legacy = []; // amauta entries from an older checkout or adapter that this run replaces
  const created = prev?.created_files ?? [];
  const note = (file, existed) => {
    if (!existed && !created.includes(file) && prev === null) created.push(file);
  };

  // AGENTS.md: the same marked blocks CLAUDE.md gets.
  const mdFile = path.join(t.codexHome, 'AGENTS.md');
  const md = await planInstructionBlocks({ rel: 'AGENTS.md', file: mdFile, sections: await renderSections(manifest, o.persona), previousIds: prev?.agents_md_sections ?? [] });
  note(mdFile, md.existed);

  // Skills: rendered once into the amauta store (the same bytes the Claude install writes), linked from the Codex skills dir.
  const rendered = await renderSkillSet(manifest, { ...o, stateDir: t.stateDir });
  const managed = await planManagedFiles({
    rendered, prevHashes: prev?.managed_files ?? {}, force: opts.force,
    fileOf: (rel) => storePathOf(t.stateDir, rel),
    rootOf: (rel) => (isSkillKey(rel) ? t.stateDir : t.codexSkillsDir),
    keep: (rel) => claudeState?.managed_files?.[rel] !== undefined,
  });
  const skipped = managed.skipped;
  const links = await planSkillLinks({ skillsDir: t.codexSkillsDir, stateDir: t.stateDir, rendered, prevLinks: prev?.skill_links ?? {},
    prevHashes: prev?.managed_files ?? {}, skipped, force: opts.force === true });

  // hooks.json
  const hooksFile = path.join(t.codexHome, 'hooks.json');
  const hooksIn = await readJsonObject(hooksFile, 'hooks.json');
  const wantedHooks = desiredCodexHooks({ stateDir: t.stateDir, telemetry: o.telemetry });
  const hooksPlan = planOwnedHooks(hooksIn.data, wantedHooks);
  legacy.push(...hooksPlan.legacy);
  const hooks = ensureTimeouts(hooksPlan.doc, wantedHooks);
  const writes = [md.write, ...managed.writes].filter(Boolean);
  if (!hooksIn.existed || !isDeepStrictEqual(hooks, hooksIn.data)) writes.push({ rel: 'hooks.json', path: hooksFile, data: Buffer.from(toJson(hooks), 'utf8') });
  note(hooksFile, hooksIn.existed);

  // config.toml: only our [mcp_servers.*] tables; every other byte stays.
  const tomlFile = path.join(t.codexHome, 'config.toml');
  const tomlBuf = await readOrNull(tomlFile);
  const tomlBefore = tomlBuf ? tomlBuf.toString('utf8') : '';
  const claudeBuf = await readOrNull(resolveClaudeSource(opts).claudeJson);
  const wanted = desiredCodexServers({ stateDir: t.stateDir, rea: o.rea, context7: o.context7, codegraph: o.codegraph });
  const own = planOwnServers({ toml: tomlBefore, wanted, prev, claudeNames: claudeServerNames(claudeBuf), legacy, skipped });
  const { toml, mirror } = await planMirror({ opts, t, toml: own.toml, oneWay: own.oneWay, claudeBuf, writes });
  if (!tomlBuf || toml !== tomlBefore) writes.push({ rel: 'config.toml', path: tomlFile, data: Buffer.from(toml, 'utf8') });
  note(tomlFile, tomlBuf !== null);

  return {
    t, prev, writes: await realWrites(writes), removes: managed.removes, skipped, legacy,
    makeState: codexState({ t, prev, o, md, managed, links, mcpAdded: own.mcpAdded, mirror, created }),
    linkPlan: links.linkPlan, managedNames: new Set(links.names), mirror, impeccable: o.impeccable, manifest,
  };
}

/** Personal skill links in both directions between the Claude and Codex skills dirs. */
async function personalSkills(opts, t, managedNames, dryRun = false) {
  const cs = resolveClaudeSource(opts);
  const sides = [{ dir: path.join(cs.claudeHome, 'skills'), create: (await statOrNull(cs.claudeHome)) !== null }, { dir: t.codexSkillsDir }];
  return syncPersonalSkills({ stateDir: t.stateDir, managed: managedNames, dryRun, sides });
}

export async function installCodex(opts = {}) {
  const p = await plan(opts);
  const { t, prev, writes, removes, skipped, legacy, mirror, linkPlan, managedNames, impeccable, manifest } = p;
  const files = writes.map((w) => w.rel);
  const removed = removes.map((r) => r.rel);
  const touches = touchesDisk(p);
  const engine = manifest.impeccable?.engine.version;
  if (opts.dryRun) {
    const personal = await personalSkills(opts, t, managedNames, true);
    const pending = personal.linked.length > 0 || personal.removed.length > 0;
    const listed = [...files, ...personal.linked.map((n) => `skills/${n} (link)`)];
    const dry = { dryRun: true, changed: touches || pending, files: listed, removed, skipped, legacy, backup: null, mirror, personal };
    if (impeccable) dry.impeccable = { engine: (await engineVersion(t.stateDir)) === engine ? 'present' : 'would-install', version: engine };
    return dry;
  }
  const statePath = stateFileOf(t.stateDir);
  const backup = touches
    ? await applyPlan({ stateDir: t.stateDir, statePath, homeRoot: t.codexSkillsDir, skillsDir: t.codexSkillsDir, writes, removes, linkPlan })
    : null;
  const personal = await personalSkills(opts, t, managedNames);
  const stateText = toJson(p.makeState(backup));
  const stateChanged = await needsWrite(statePath, stateText);
  if (stateChanged) await writeFileAtomic(statePath, stateText);
  const recordText = toJson({ fingerprint: await sourceFingerprint(opts) }); // what the next SessionStart check compares with
  if (await needsWrite(syncRecordOf(t.stateDir), recordText)) await writeFileAtomic(syncRecordOf(t.stateDir), recordText);
  const linkedAny = personal.linked.length > 0 || personal.removed.length > 0;
  const result = { dryRun: false, changed: touches || stateChanged || !prev || linkedAny, files, removed, skipped, legacy, backup, mirror, personal };
  if (impeccable) {
    // The engine is one shared store: whichever runtime installs the module prepares it (after the state is written, so a failed run is retried).
    result.impeccable = await ensureEngine({ stateDir: t.stateDir, version: engine, searchPath: opts.searchPath });
    if (result.impeccable.engine === 'installed') result.changed = true;
  }
  return result;
}

/** Re-sync Codex with the Claude side and the shared store: the same idempotent pass an install does, for an existing Codex install. */
export async function syncCodex(opts = {}) {
  const t = resolveCodexTargets(opts);
  if (!(await readCodexState(t.stateDir))) return { synced: false, changed: false, reason: 'no codex install' };
  return { synced: true, ...(await installCodex(opts)) };
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
  if (tomlBuf) {
    const before = tomlBuf.toString('utf8');
    let toml = before;
    for (const [name, value] of Object.entries(state?.mcp_added ?? {})) {
      const cur = readMcpServer(toml, name);
      if (cur.found && isDeepStrictEqual(mcpCore(cur.value), mcpCore(value))) toml = removeMcpServer(toml, name);
      else if (cur.found && !isStaleAmautaServer(cur.value)) kept.push(`mcp:${name}`);
    }
    // Entries an older checkout or adapter left under amauta's names, whatever the install recorded.
    for (const name of AMAUTA_SERVER_NAMES) if (isStaleAmautaServer(readMcpServer(toml, name).value)) toml = removeMcpServer(toml, name);
    if (toml !== before) {
      if (created.has(tomlFile) && toml.trim() === '') deletes.push(tomlFile);
      else writes.push({ path: tomlFile, data: Buffer.from(toml, 'utf8') });
    }
  }

  const claudeKept = (await readJsonFile(path.join(t.stateDir, 'state.json')))?.managed_files ?? {};
  for (const [rel, hash] of Object.entries(state?.managed_files ?? {})) {
    if (isSkillKey(rel) && rel in claudeKept) continue; // the Claude install still uses this store file
    const file = await safeManagedPath(isSkillKey(rel) ? t.stateDir : t.codexSkillsDir, rel);
    if (file === null) {
      kept.push(rel);
      continue;
    }
    const buf = await readOrNull(file);
    if (buf === null) continue;
    if (sha256(buf) === hash) deletes.push(file);
    else kept.push(rel);
  }

  const baseBuf = await readOrNull(baseFileOf(t.stateDir));
  let keepExclude = [];
  try {
    const parsed = JSON.parse(baseBuf?.toString('utf8') ?? '{}');
    if (Array.isArray(parsed.exclude)) keepExclude = parsed.exclude;
  } catch {
    keepExclude = [];
  }
  if (baseBuf !== null && keepExclude.length === 0) deletes.push(baseFileOf(t.stateDir));
  else if (baseBuf !== null) writes.push({ path: baseFileOf(t.stateDir), data: Buffer.from(toJson({ schema: 'amauta.mcp-sync/v1', servers: {}, exclude: keepExclude }), 'utf8') }); // the user's own list outlives the install
  if ((await statOrNull(syncRecordOf(t.stateDir))) !== null) deletes.push(syncRecordOf(t.stateDir));
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
    await pruneEmptyDirs(path.dirname(file), file.startsWith(storeDirOf(t.stateDir) + path.sep) ? storeDirOf(t.stateDir) : file.startsWith(t.codexSkillsDir + path.sep) ? t.codexSkillsDir : t.codexHome);
  }
  await removeLinks(t.codexSkillsDir, state?.skill_links);
  await rmdir(storeDirOf(t.stateDir)).catch(() => {}); // the store goes with the last runtime that used it
  await removePersonalLinks({ stateDir: t.stateDir, skillsDir: t.codexSkillsDir });
  if (hadState) await rm(statePath, { force: true });
  if (state?.impeccable === true && (await readJsonFile(path.join(t.stateDir, 'state.json')))?.impeccable !== true) await removeEngine(t.stateDir); // the engine goes with the last runtime that used it
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
  for (const [name, target] of Object.entries(state.skill_links ?? {})) {
    const cur = await readlink(path.join(t.codexSkillsDir, name)).catch(() => null);
    add(`skill link ${name}`, cur === target, cur === target ? '' : 'not linked to the amauta store');
  }
  for (const [rel, hash] of Object.entries(state.managed_files ?? {})) {
    const buf = await readOrNull(storePathOf(t.stateDir, rel));
    if (buf === null) add(`skill ${rel}`, false, 'missing');
    else if (sha256(buf) !== hash) add(`skill ${rel}`, false, 'modified');
    else add(`skill ${rel}`, true);
  }
  // Drift: what a sync would change right now (the Claude side moved, a file was lost, a server changed in one runtime).
  const pending = await installCodex({ ...opts, dryRun: true });
  if (pending.changed) add('sync', false, `Codex out of sync: ${[...pending.files, ...pending.removed.map((r) => `remove ${r}`)].join(', ') || 'state'} (run: amauta sync)`);
  for (const name of pending.mirror.conflicts) add(`mcp conflict ${name}`, false, 'changed differently in Claude and Codex; make one side match the other, then run: amauta sync');
  const notes = [];
  if ((state.mcp_unsupported ?? []).length > 0) notes.push({ name: 'mcp not mirrored', ok: true, detail: `${state.mcp_unsupported.join(', ')} (not stdio, or keys beyond command/args/env: kept where they are, not synced)` });
  if (pending.mirror.excluded.length > 0) notes.push({ name: 'mcp excluded from sync', ok: true, detail: `${pending.mirror.excluded.join(', ')} (runtime-internal or in the exclude list of mcp-sync.json)` });
  for (const n of pending.mirror.staleExcluded) notes.push({ name: `mcp excluded copy ${n}`, ok: true, detail: 'an earlier sync copied it to the other runtime and the copy was edited; remove it by hand' });
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
