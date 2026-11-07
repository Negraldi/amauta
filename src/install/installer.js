import { rm, rmdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { removeSection, listSections } from '../core/markers.js';
import { deepMerge, mergeHooks, removeHooksWhere } from '../core/jsonmerge.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import {
  ensureTimeouts, isObject, needsWrite, readJsonObject, readOrNull, readStateObject, safeManagedPath, sha256,
  statOrNull, toJson
} from './files.js';
import { resolvePython } from './python.js';
import { applyPlan, planInstructionBlocks, planManagedFiles, planOwnedHooks, planSkillLinks, realWrites, touchesDisk } from './steps.js';
import { createBackup, pruneEmptyDirs, restoreBackup } from '../core/backup.js';
import { resolveCodexTargets, resolveTargets } from './paths.js';
import { loadManifest, readAssetBuffer, readAssetText, repoRoot } from './assets.js';
import { DEFAULT_MODEL_ASSIGNMENTS, engramToolPrefix, renderAgent, resolveAssignment } from './templating.js';
import {
  AMAUTA_SERVER_NAMES, DEFAULT_PYTHON, LEGACY_SERVER_ALIASES, desiredHooks, desiredMcpServers, isAmautaHook,
  isStaleAmautaServer, staleAmautaHooks
} from './servers.js';
import { renderSddFiles } from './sdd.js';
import { archifyCli } from './archify.js';
import { engineVersion, ensureEngine, removeEngine } from './impeccable.js';
import {
  applyLinks, isOurSkillDir, isSkillKey, namesOf, planManagedLinks, pruneEmptyTree, readJsonFile, removeDanglingLinks, removeLinks,
  removePersonalLinks, renderSkillFile, renderSkillSet, storeDirOf, storePathOf, syncPersonalSkills
} from './skillstore.js';
import { packageVersion } from '../version.js';
import { CODEGRAPH_HINT, codegraphStatus } from '../codegraph/index.js';
import { findOnPath } from '../core/platform.js';
import { graphifyStatus, lastHookError } from '../graphify/probe.js';

export const STATE_SCHEMA = 'amauta.state/v1';
const RDD_MODES = ['on', 'off'];
const COMPONENTS = ['claude-md', 'output-style', 'skills', 'agents', 'settings', 'mcp'];
const STYLE_NAMES = ['Gentleman', 'Neutral'];
/** Always-on CLAUDE.md budget (chars across the blocks amauta installed). */
export const CLAUDE_MD_BUDGET = 20000;
/** CLAUDE.md section ids an earlier version shipped (agent-routing nested remote-authorization). */
const RETIRED_SECTIONS = ['agent-routing', 'remote-authorization'];
export const CODEGRAPH_PROMPT_HOOK = 'codegraph prompt-hook';
const CODEGRAPH_HOOK_TIMEOUT = 10;

const hasCommand = (settings, event, command) =>
  (Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : []).some((e) => Array.isArray(e?.hooks) && e.hooks.some((h) => h?.command === command));

export { ensureTimeouts, isObject, needsWrite, readJsonObject, readOrNull, safeManagedPath, sha256, statOrNull, toJson } from './files.js';

const statePathOf = (stateDir) => path.join(stateDir, 'state.json');

const readState = (stateDir) => readStateObject(statePathOf(stateDir));

const isOurs = (servers, prev, key) =>
  key in servers && ((prev?.mcp_added?.[key] !== undefined && isDeepStrictEqual(servers[key], prev.mcp_added[key])) || (AMAUTA_SERVER_NAMES.includes(key) && isStaleAmautaServer(servers[key])));

/**
 * Key under which our memory server is registered: "engram" when free (vendored prompts use
 * mcp__engram__*), else "amauta-memory" so a foreign engram entry is never overwritten.
 * Null when the engram plugin already provides memory tools.
 */
function chooseMemoryKey({ settings, currentServers, prev }) {
  if (settings.enabledPlugins?.['engram@engram'] === true) return null;
  const last = prev?.memory_server_key;
  if (last && (isOurs(currentServers, prev, last) || !(last in currentServers))) return last;
  return 'engram' in currentServers && !isOurs(currentServers, prev, 'engram') ? 'amauta-memory' : 'engram';
}

const PERMISSION_KINDS = ['ask', 'deny'];

/**
 * Rules amauta added, per kind. Current schema: `permissions_added: {ask, deny}`. The T15 schema only had
 * `ask_added`. The pre-T15 `deny_added` is deliberately ignored: it listed a broad deny set the user may rely on.
 */
function permissionsAdded(state) {
  const cur = state?.permissions_added;
  const list = (v) => (Array.isArray(v) ? v.filter((r) => typeof r === 'string') : []);
  if (isObject(cur)) return { ask: list(cur.ask), deny: list(cur.deny) };
  return { ask: list(state?.ask_added), deny: [] };
}

/** Deny rules a pre-T15 install recorded as added (`deny_added`), carried forward as `legacy_deny` for reporting only. */
const legacyDenyOf = (state) => [state?.legacy_deny, state?.deny_added].find(Array.isArray)?.filter((r) => typeof r === 'string') ?? [];

/** Append overlay rules the user does not already list; track only what we appended (and still find in place). */
function mergePermissions(settings, prev, overlay) {
  const value = { ...(isObject(settings.permissions) ? settings.permissions : {}) };
  const before = permissionsAdded(prev);
  const added = {};
  let changed = false;
  for (const kind of PERMISSION_KINDS) {
    const existing = Array.isArray(value[kind]) ? value[kind] : [];
    const fresh = (overlay.permissions?.[kind] ?? []).filter((r) => !existing.includes(r));
    added[kind] = [...new Set([...before[kind], ...fresh])].filter((r) => existing.includes(r) || fresh.includes(r));
    if (fresh.length > 0) {
      value[kind] = [...existing, ...fresh];
      changed = true;
    }
  }
  return { value, changed, added };
}

const abs = (claudeHome, rel) => path.join(claudeHome, ...rel.split('/'));
/** Skills live in the amauta store (state dir); everything else under the Claude home. */
const fileOf = (t, rel) => (isSkillKey(rel) ? storePathOf(t.stateDir, rel) : abs(t.claudeHome, rel));

export { renderSkillFile };

/** Managed files (relative posix path -> Buffer) rendered for this install. */
async function renderManagedFiles(manifest, { persona, assignments, engramPrefix, sdd, impeccable, archify, stateDir }) {
  const files = new Map();
  files.set(manifest.outputStyleTarget, await readAssetBuffer(manifest.personas[persona].outputStyle));

  for (const [rel, data] of await renderSkillSet(manifest, { sdd, impeccable, archify, stateDir })) files.set(rel, data);

  const footers = [];
  for (const f of manifest.agentFooters) footers.push({ id: f.id, body: await readAssetText(f.source) });
  for (const agent of manifest.agents) {
    const template = await readAssetText(`${manifest.agentsDir}/${agent.name}.md`);
    const text = renderAgent(template, {
      assignment: resolveAssignment(assignments, agent.modelKey),
      engramPrefix,
      footers,
      lockTools: agent.toolsLocked === true,
    });
    files.set(`agents/${agent.name}.md`, Buffer.from(text, 'utf8'));
  }
  if (sdd) for (const [rel, data] of await renderSddFiles(manifest, { assignments, engramPrefix, footers })) if (!isSkillKey(rel)) files.set(rel, data); // its skills are in the store set
  return files;
}

export async function renderSections(manifest, persona) {
  const out = [];
  for (const s of manifest.claudeMd) {
    const source = s.source.startsWith('persona:') ? manifest.personas[persona].residual : s.source;
    out.push({ id: s.id, body: await readAssetText(source) });
  }
  return out;
}

/** Options resolved from the flags and the previous state; modules are sticky (an absent flag keeps the earlier choice). */
async function resolveOptions(opts, manifest, prev, settings, currentServers) {
  const persona = opts.persona ?? 'gentleman';
  if (!manifest.personas[persona]) throw new Error(`unknown persona: ${persona} (expected gentleman or neutral)`);
  if (opts.rddMode !== undefined && !RDD_MODES.includes(opts.rddMode)) throw new Error(`unknown review mode: ${opts.rddMode} (expected on or off)`);
  // An explicit `false` (--without-*) turns a module off.
  const sticky = (flag, key) => (flag === false ? false : flag === true || prev?.[key] === true);
  // Opt-in MCP servers, sticky like sdd. A state that predates the opt-in (no key at all) registered both servers by
  // default: keep each one that is still exactly what we wrote (carry-over); an edited entry is the user's.
  const optIn = (flag, key) => flag !== false &&
    (flag === true || prev?.[key] === true || (prev !== null && prev?.[key] === undefined && isOurs(currentServers, prev, key)));
  const memoryKey = chooseMemoryKey({ settings, currentServers, prev });
  return {
    persona,
    assignments: { ...DEFAULT_MODEL_ASSIGNMENTS, ...(prev?.model_assignments ?? {}) },
    telemetry: opts.telemetry !== false,
    sdd: sticky(opts.withSdd, 'sdd'),
    impeccable: sticky(opts.withImpeccable, 'impeccable'), // optional design skill + pinned npm engine
    archify: sticky(opts.withArchify, 'archify'), // optional diagram skill (pure Node, vendored)
    codegraphOnPath: (await findOnPath('codegraph', opts.searchPath)) !== null,
    rea: optIn(opts.withRea, 'rea'),
    context7: optIn(opts.withContext7, 'context7'),
    memoryKey,
    engramPrefix: engramToolPrefix(settings, memoryKey ?? 'engram'),
    python: resolvePython(opts, prev?.python),
  };
}

/** codegraph's own prompt hook: only when the tool is installed, never duplicated, removed only if we added it. */
function planCodegraphHook(settingsBefore, settings, prev, onPath) {
  const wasThere = hasCommand(settingsBefore, 'UserPromptSubmit', CODEGRAPH_PROMPT_HOOK);
  const weAdded = prev?.codegraph_hook_added === true && wasThere;
  const drop = weAdded && !onPath; // a hook we added must not outlive the tool: it would fail on every prompt
  let out = settings;
  if (drop) out = removeHooksWhere(out, (c) => c === CODEGRAPH_PROMPT_HOOK);
  if (onPath && !wasThere) {
    const entry = { matcher: '', hooks: [{ type: 'command', command: CODEGRAPH_PROMPT_HOOK, timeout: CODEGRAPH_HOOK_TIMEOUT }] };
    out = mergeHooks(out, { UserPromptSubmit: [entry] });
  }
  return { settings: out, added: !drop && (weAdded || (onPath && !wasThere)) };
}

/** settings.json: output style, permission rules, our hooks with timeouts, codegraph's hook. */
async function planSettings({ manifest, t, prev, o, settingsIn }) {
  const overlay = JSON.parse(await readAssetText(manifest.settingsOverlay));
  const styleName = manifest.personas[o.persona].styleName;
  const prevStyle = prev?.settings_prev ? prev.settings_prev.outputStyle : (settingsIn.data.outputStyle ?? null);
  // Permissions: the overlay's `ask` and `deny` rules are appended after the user's own. State records only the rules
  // we appended (`permissions_added`); a rule the user already had is never recorded, so it is never removed.
  const permissions = mergePermissions(settingsIn.data, prev, overlay);
  let settings = deepMerge(settingsIn.data, { outputStyle: styleName });
  if (permissions.changed) settings = { ...settings, permissions: permissions.value };
  const wantedHooks = desiredHooks({ stateDir: t.stateDir, telemetry: o.telemetry, sdd: o.sdd, python: o.python });
  const hooks = planOwnedHooks(settings, wantedHooks); // drops stale amauta commands (e.g. PATH-based ones) first
  const codegraph = planCodegraphHook(settingsIn.data, hooks.doc, prev, o.codegraphOnPath);
  // Hooks we own keep a timeout across upgrades (mergeHooks keeps an older entry as is when its command did not change).
  const owned = { ...wantedHooks };
  if (codegraph.added) {
    owned.UserPromptSubmit = [...(owned.UserPromptSubmit ?? []), { hooks: [{ command: CODEGRAPH_PROMPT_HOOK, timeout: CODEGRAPH_HOOK_TIMEOUT }] }];
  }
  settings = ensureTimeouts(codegraph.settings, owned);
  const file = abs(t.claudeHome, 'settings.json');
  const changed = !settingsIn.existed || !isDeepStrictEqual(settings, settingsIn.data);
  const write = changed ? { rel: 'settings.json', path: file, data: Buffer.from(toJson(settings), 'utf8') } : null;
  return { write, legacy: hooks.legacy, prevStyle, permissionsAdded: permissions.added, codegraphHookAdded: codegraph.added };
}

/** .claude.json MCP servers: added only when absent; ours from an earlier install are refreshed; a user's entry stays. */
async function planClaudeMcp({ t, prev, o, claudeJsonIn, currentServers }) {
  const legacy = [];
  const { memory, ...wanted } = desiredMcpServers({ stateDir: t.stateDir, rea: o.rea, context7: o.context7, python: o.python });
  if (o.memoryKey) wanted[o.memoryKey] = memory;
  if (!o.codegraphOnPath && !isOurs(currentServers, prev, 'codegraph')) delete wanted.codegraph; // external tool: only when present
  const mcpAdded = {};
  const servers = { ...currentServers };
  for (const [name, value] of Object.entries(wanted)) {
    if (name in currentServers && !isOurs(currentServers, prev, name)) continue;
    const ownedBefore = prev?.mcp_added?.[name] !== undefined && isDeepStrictEqual(currentServers[name], prev.mcp_added[name]);
    if (name in currentServers && !isDeepStrictEqual(currentServers[name], value) && !ownedBefore) legacy.push(`mcp ${name}`);
    servers[name] = value; // new, or ours from an earlier install (or an older checkout): refresh it
    mcpAdded[name] = value;
  }
  for (const name of LEGACY_SERVER_ALIASES) {
    if (name in wanted || !(name in servers) || !isStaleAmautaServer(servers[name])) continue;
    delete servers[name];
    legacy.push(`mcp ${name}`);
  }
  // Entries we added before that are no longer wanted (e.g. the old compiled engram) go away if untouched.
  for (const name of Object.keys(prev?.mcp_added ?? {})) if (!(name in wanted) && isOurs(currentServers, prev, name)) delete servers[name];
  const claudeJson = { ...claudeJsonIn.data, mcpServers: servers };
  const wrongMode = process.platform !== 'win32' && ((await statOrNull(t.claudeJson))?.mode & 0o777) !== 0o600; // no POSIX modes on Windows
  const changed = !claudeJsonIn.existed || !isDeepStrictEqual(claudeJson, claudeJsonIn.data) || wrongMode;
  const write = changed ? { rel: '.claude.json', path: t.claudeJson, data: Buffer.from(toJson(claudeJson), 'utf8'), mode: 0o600 } : null;
  return { write, legacy, mcpAdded };
}

/** Option changes against the previous state, for the install report. */
function optionChanges(prev, seen) {
  if (prev === null) return {};
  const was = { persona: prev.persona, rdd_mode: prev.rdd_mode ?? 'off' };
  for (const k of ['telemetry', 'sdd', 'rea', 'impeccable', 'archify', 'context7']) was[k] = prev[k] === true;
  const out = {};
  for (const [k, v] of Object.entries(seen)) if (was[k] !== v && !(k === 'rea' && prev.rea === undefined && v === was.rea)) out[k] = { from: was[k], to: v };
  return out;
}

function claudeState({ t, prev, o, rddMode, rddChanged, managed, links, md, settingsPlan, mcp, created }) {
  return (lastBackup) => ({
    schema: STATE_SCHEMA,
    version: packageVersion(),
    installed_at: prev?.installed_at ?? new Date().toISOString(),
    claude_home: t.claudeHome,
    claude_json: t.claudeJson,
    components: COMPONENTS,
    persona: o.persona,
    model_assignments: o.assignments,
    rdd_mode: rddMode,
    ...(rddChanged ? { rdd_mode_recorded_at: new Date().toISOString() } : prev?.rdd_mode_recorded_at ? { rdd_mode_recorded_at: prev.rdd_mode_recorded_at } : {}),
    last_backup: lastBackup ?? prev?.last_backup ?? null,
    managed_files: managed.managedFiles,
    skill_links: links.skillLinks,
    claude_md_sections: md.ids,
    settings_prev: { outputStyle: settingsPlan.prevStyle },
    permissions_added: settingsPlan.permissionsAdded,
    ...(legacyDenyOf(prev).length > 0 ? { legacy_deny: legacyDenyOf(prev) } : {}),
    mcp_added: mcp.mcpAdded,
    memory_server_key: o.memoryKey,
    telemetry: o.telemetry,
    sdd: o.sdd,
    impeccable: o.impeccable,
    archify: o.archify,
    rea: o.rea,
    context7: o.context7,
    codegraph_hook_added: settingsPlan.codegraphHookAdded,
    ...(o.python !== DEFAULT_PYTHON ? { python: o.python } : {}),
    created_files: created,
  });
}

/** Compute everything install would do, without touching the disk. */
async function plan(opts) {
  const t = resolveTargets(opts);
  const manifest = await loadManifest();
  const prev = await readState(t.stateDir);
  const settingsIn = await readJsonObject(abs(t.claudeHome, 'settings.json'), 'settings.json');
  const claudeJsonIn = await readJsonObject(t.claudeJson, '.claude.json');
  const currentServers = isObject(claudeJsonIn.data.mcpServers) ? claudeJsonIn.data.mcpServers : {};
  const o = await resolveOptions(opts, manifest, prev, settingsIn.data, currentServers);

  // Managed files (output style, skills, agents) and the skill links into the store.
  const rendered = await renderManagedFiles(manifest, { ...o, stateDir: t.stateDir });
  const codexState = await readJsonFile(path.join(t.stateDir, 'codex-state.json'));
  const managed = await planManagedFiles({
    rendered, prevHashes: prev?.managed_files ?? {}, force: opts.force,
    fileOf: (rel) => fileOf(t, rel),
    rootOf: (rel) => (isSkillKey(rel) ? t.stateDir : t.claudeHome),
    keep: (rel) => isSkillKey(rel) && codexState?.managed_files?.[rel] !== undefined, // the Codex install still uses it
  });
  const links = await planSkillLinks({
    skillsDir: abs(t.claudeHome, 'skills'), stateDir: t.stateDir, rendered, prevLinks: prev?.skill_links ?? {},
    prevHashes: prev?.managed_files ?? {}, skipped: managed.skipped, force: opts.force === true,
  });
  // CLAUDE.md sections; retired ids are dropped too, so a missing or reset state.json still converges.
  const mdFile = abs(t.claudeHome, 'CLAUDE.md');
  const md = await planInstructionBlocks({
    rel: 'CLAUDE.md', file: mdFile, sections: await renderSections(manifest, o.persona),
    previousIds: prev?.claude_md_sections ?? [], retired: RETIRED_SECTIONS,
  });
  const settingsPlan = await planSettings({ manifest, t, prev, o, settingsIn });
  const mcp = await planClaudeMcp({ t, prev, o, claudeJsonIn, currentServers });

  const created = prev?.created_files ?? [
    ...(md.existed ? [] : [mdFile]),
    ...(settingsIn.existed ? [] : [abs(t.claudeHome, 'settings.json')]),
    ...(claudeJsonIn.existed ? [] : [t.claudeJson]),
  ];
  const rddMode = opts.rddMode ?? prev?.rdd_mode ?? 'off';
  const rddChanged = prev !== null && opts.rddMode !== undefined && opts.rddMode !== (prev.rdd_mode ?? 'off');
  const seen = { persona: o.persona, telemetry: o.telemetry, sdd: o.sdd, rea: o.rea, impeccable: o.impeccable, archify: o.archify, context7: o.context7, rdd_mode: rddMode };
  const writes = [...managed.writes, md.write, settingsPlan.write, mcp.write].filter(Boolean);
  return {
    t, prev, writes: await realWrites(writes), removes: managed.removes, skipped: managed.skipped,
    legacy: [...settingsPlan.legacy, ...mcp.legacy],
    makeState: claudeState({ t, prev, o, rddMode, rddChanged, managed, links, md, settingsPlan, mcp, created }),
    impeccable: o.impeccable, manifest, stateChanges: optionChanges(prev, seen), rddChanged,
    impeccableWas: prev?.impeccable === true, linkPlan: links.linkPlan, managedNames: new Set(links.names),
  };
}

export async function install(opts = {}) {
  const p = await plan(opts);
  const { t, prev, writes, removes, skipped, legacy, impeccable, manifest, stateChanges, linkPlan, managedNames } = p;
  const report = { files: writes.map((w) => w.rel), removed: removes.map((r) => r.rel), skipped, legacy, state_changes: stateChanges };
  const wanted = manifest.impeccable?.engine.version;
  const touches = touchesDisk(p) || p.rddChanged;
  if (opts.dryRun) {
    const dry = { dryRun: true, changed: touches, ...report, backup: null };
    if (impeccable) dry.impeccable = { engine: (await engineVersion(t.stateDir)) === wanted ? 'present' : 'would-install', version: wanted };
    return dry;
  }
  const statePath = statePathOf(t.stateDir);
  const backup = touches
    ? await applyPlan({ stateDir: t.stateDir, statePath, homeRoot: t.claudeHome, skillsDir: abs(t.claudeHome, 'skills'), writes, removes, linkPlan })
    : null;
  const stateText = toJson(p.makeState(backup));
  const stateChanged = await needsWrite(statePath, stateText);
  if (stateChanged) await writeFileAtomic(statePath, stateText);
  const result = { dryRun: false, changed: touches || stateChanged || !prev, ...report, backup };
  if ((await statOrNull(path.join(t.stateDir, 'codex-state.json'))) !== null) {
    const sides = [{ dir: abs(t.claudeHome, 'skills') }, { dir: resolveCodexTargets(opts).codexSkillsDir }];
    const personal = await syncPersonalSkills({ stateDir: t.stateDir, managed: managedNames, sides });
    if (personal.linked.length > 0 || personal.removed.length > 0) result.changed = true;
    result.personal = personal;
  }
  if (p.impeccableWas && !impeccable) await removeEngine(t.stateDir);
  if (impeccable) {
    // After the state is written, so a failed or offline npm run is retried by the next install.
    result.impeccable = await ensureEngine({ stateDir: t.stateDir, version: wanted, searchPath: opts.searchPath });
    if (result.impeccable.engine === 'installed') result.changed = true;
  }
  return result;
}

const BACKUP_ID = /^\d{8}T\d{6}Z(-\d{3})?$/;

/** Restore one installer backup by id (its directory name under <stateDir>/backups); the id is matched strictly, never joined as a path. */
export async function restore(opts = {}) {
  const t = resolveTargets(opts);
  const c = resolveCodexTargets(opts); // a backup may hold Codex files too
  if (typeof opts.backup !== 'string' || !BACKUP_ID.test(opts.backup)) throw new Error(`invalid backup id: ${String(opts.backup)} (expected a name like 20261016T101500Z)`);
  const dir = path.join(t.stateDir, 'backups', opts.backup);
  if ((await statOrNull(dir)) === null) throw new Error(`no such backup: ${opts.backup}`);
  const manifest = await restoreBackup(dir, { stop: t.claudeHome, allow: [t.claudeHome, t.claudeJson, t.stateDir, c.codexHome, c.codexSkillsDir] });
  // A restored-away store file leaves its link dangling: drop links that point into the store and lead nowhere.
  await pruneEmptyTree(storeDirOf(t.stateDir));
  for (const skillsDir of [path.join(t.claudeHome, 'skills'), c.codexSkillsDir]) await removeDanglingLinks(skillsDir, storeDirOf(t.stateDir));
  return { backup: opts.backup, restored: manifest.entries.map((e) => e.original_path) };
}

export async function uninstall(opts = {}) {
  const t = resolveTargets(opts);
  const state = await readState(t.stateDir);
  const created = new Set(state?.created_files ?? []);
  const writes = [];
  const deletes = [];
  const kept = [];

  // CLAUDE.md
  const mdFile = abs(t.claudeHome, 'CLAUDE.md');
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

  // settings.json
  const settingsFile = abs(t.claudeHome, 'settings.json');
  const settingsIn = await readJsonObject(settingsFile, 'settings.json');
  if (settingsIn.existed) {
    let s = removeHooksWhere(settingsIn.data, (c) => isAmautaHook(c) || (state?.codegraph_hook_added === true && c === CODEGRAPH_PROMPT_HOOK));
    if (state?.settings_prev && STYLE_NAMES.includes(s.outputStyle)) {
      s = { ...s };
      if (state.settings_prev.outputStyle === null) delete s.outputStyle;
      else s.outputStyle = state.settings_prev.outputStyle;
    }
    const addedRules = permissionsAdded(state);
    for (const key of PERMISSION_KINDS) {
      const added = addedRules[key];
      if (added?.length && Array.isArray(s.permissions?.[key])) {
        s = { ...s, permissions: { ...s.permissions, [key]: s.permissions[key].filter((d) => !added.includes(d)) } };
        if (s.permissions[key].length === 0) delete s.permissions[key];
        if (Object.keys(s.permissions).length === 0) delete s.permissions;
      }
    }
    if (!isDeepStrictEqual(s, settingsIn.data)) {
      if (created.has(settingsFile) && Object.keys(s).length === 0) deletes.push(settingsFile);
      else writes.push({ path: settingsFile, data: Buffer.from(toJson(s), 'utf8') });
    }
  }

  // .claude.json
  const cjIn = await readJsonObject(t.claudeJson, '.claude.json');
  if (cjIn.existed && state?.mcp_added && isObject(cjIn.data.mcpServers)) {
    const servers = { ...cjIn.data.mcpServers };
    for (const [name, value] of Object.entries(state.mcp_added)) {
      if (name in servers && (isDeepStrictEqual(servers[name], value) || (AMAUTA_SERVER_NAMES.includes(name) && isStaleAmautaServer(servers[name])))) delete servers[name];
      else if (name in servers) kept.push(`mcp:${name}`);
    }
    const next = { ...cjIn.data, mcpServers: servers };
    if (Object.keys(servers).length === 0) delete next.mcpServers;
    if (!isDeepStrictEqual(next, cjIn.data)) {
      if (created.has(t.claudeJson) && Object.keys(next).length === 0) deletes.push(t.claudeJson);
      else writes.push({ path: t.claudeJson, data: Buffer.from(toJson(next), 'utf8'), mode: 0o600 });
    }
  }

  // Managed files, only when byte-identical to what was installed.
  const codexKept = (await readJsonFile(path.join(t.stateDir, 'codex-state.json')))?.managed_files ?? {};
  for (const [rel, hash] of Object.entries(state?.managed_files ?? {})) {
    // Skills sit in the amauta store (kept while the Codex install still lists the file); a pre-store install has real copies in the Claude home.
    const candidates = isSkillKey(rel) ? [rel in codexKept ? null : [t.stateDir, rel], [t.claudeHome, rel]] : [[t.claudeHome, rel]];
    for (const c of candidates) {
      if (c === null) continue;
      const file = await safeManagedPath(c[0], c[1]);
      if (file === null) {
        kept.push(rel);
        continue;
      }
      const buf = await readOrNull(file);
      if (buf === null) continue;
      if (sha256(buf) === hash) deletes.push(file);
      else kept.push(rel);
    }
  }

  const statePath = statePathOf(t.stateDir);
  const hadState = (await statOrNull(statePath)) !== null;
  if (writes.length === 0 && deletes.length === 0 && !hadState) return { changed: false, backup: null, removed: [], kept };

  let backup = null;
  if (writes.length > 0 || deletes.length > 0) {
    ({ dir: backup } = await createBackup(t.stateDir, [...writes.map((w) => w.path), ...deletes, statePath]));
  }
  for (const w of writes) await writeFileAtomic(w.path, w.data, w.mode === undefined ? {} : { mode: w.mode });
  for (const file of deletes) {
    await rm(file, { force: true });
    await pruneEmptyDirs(path.dirname(file), file.startsWith(storeDirOf(t.stateDir) + path.sep) ? storeDirOf(t.stateDir) : t.claudeHome);
  }
  await removeLinks(abs(t.claudeHome, 'skills'), state?.skill_links);
  await rmdir(storeDirOf(t.stateDir)).catch(() => {}); // the store goes with the last runtime that used it
  await removePersonalLinks({ stateDir: t.stateDir, skillsDir: abs(t.claudeHome, 'skills') });
  if (hadState) await rm(statePath, { force: true });
  if (state?.impeccable === true) await removeEngine(t.stateDir);
  return { changed: true, backup, removed: [...writes.map((w) => w.path), ...deletes], kept };
}

export async function status(opts = {}) {
  const t = resolveTargets(opts);
  const state = await readState(t.stateDir);
  if (!state) return { installed: false, ok: false, items: [] };
  const items = [];
  const notes = [];
  const add = (name, ok, detail = '') => items.push({ name, ok, detail });

  const md = (await readOrNull(abs(t.claudeHome, 'CLAUDE.md')))?.toString('utf8') ?? '';
  const found = listSections(md);
  const present = new Set(found.map((s) => s.id));
  for (const id of state.claude_md_sections ?? []) add(`CLAUDE.md section ${id}`, present.has(id), present.has(id) ? '' : 'missing');

  const settings = (await readJsonObject(abs(t.claudeHome, 'settings.json'), 'settings.json')).data;
  const commands = (event) => (settings.hooks?.[event] ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
  const expectedHooks = desiredHooks({ stateDir: t.stateDir, telemetry: state.telemetry === true, sdd: state.sdd === true, python: state.python });
  for (const [event, entries] of Object.entries(expectedHooks)) {
    for (const cmd of entries.flatMap((e) => e.hooks.map((h) => h.command))) {
      const ok = commands(event).includes(cmd);
      add(`hook ${event}`, ok, ok ? cmd : 'missing');
    }
  }
  if (state.sdd === true) {
    const entry = path.join(repoRoot, 'python', 'amauta', 'sdd', '__main__.py');
    const present = (await statOrNull(entry)) !== null;
    add('sdd module', present, present ? entry : `missing ${entry}`);
  }
  if (state.impeccable === true) {
    const want = (await loadManifest()).impeccable?.engine.version;
    const have = await engineVersion(t.stateDir);
    add('impeccable engine', have !== null && have === want, have === null ? 'missing (run: amauta install)' : have === want ? `${have} (${t.stateDir}/impeccable)` : `version ${have}, expected ${want} (run: amauta install)`);
  }
  if (state.archify === true) {
    const cli = archifyCli(t.claudeHome);
    const ok = (await statOrNull(cli)) !== null;
    add('archify skill', ok, ok ? cli : `missing ${cli} (run: amauta install)`);
  }
  add('outputStyle', STYLE_NAMES.includes(settings.outputStyle), String(settings.outputStyle ?? 'unset'));

  const servers = (await readJsonObject(t.claudeJson, '.claude.json')).data.mcpServers ?? {};
  for (const name of Object.keys(state.mcp_added ?? {})) add(`mcp ${name}`, name in servers, name in servers ? '' : 'missing');

  for (const [name, target] of Object.entries(state.skill_links ?? {})) {
    const ok = await isOurSkillDir(abs(t.claudeHome, `skills/${name}`), target); // a link, or the copy made where links fail
    add(`skill link ${name}`, ok, ok ? '' : 'not linked to the amauta store');
  }
  for (const [rel, hash] of Object.entries(state.managed_files ?? {})) {
    const buf = await readOrNull(fileOf(t, rel));
    if (buf === null) add(`file ${rel}`, false, 'missing');
    else if (sha256(buf) !== hash) add(`file ${rel}`, false, 'modified');
    else add(`file ${rel}`, true);
  }
  // Optional external tools: reported, but never make the install unhealthy.
  const cg = await codegraphStatus({ cwd: opts.cwd, searchPath: opts.searchPath });
  notes.push({ name: 'codegraph', ok: cg.onPath, detail: cg.onPath ? `${cg.path}; index in ${path.resolve(opts.cwd ?? process.cwd())}: ${cg.indexed ? 'present' : 'missing (run: amauta codegraph init)'}` : CODEGRAPH_HINT });
  const gfy = await graphifyStatus({ searchPath: opts.searchPath, deep: opts.deep === true });
  notes.push({ name: 'graphify', ok: gfy.onPath, detail: gfy.detail });
  const hookError = await lastHookError(t.stateDir);
  if (hookError) notes.push({ name: 'graphify hook', ok: false, detail: `last error: ${hookError} (log: ${path.join(t.stateDir, 'graphify-hook.log')})` });
  const blocks = found
    .filter((s) => (state.claude_md_sections ?? []).includes(s.id))
    .map((s) => ({ id: s.id, chars: s.body.length, lines: s.body.split('\n').length }));
  const total = blocks.reduce((n, b) => n + b.chars, 0);
  const sizes = { blocks, total, budget: CLAUDE_MD_BUDGET, over: total > CLAUDE_MD_BUDGET };
  const warnings = sizes.over ? [`CLAUDE.md blocks use ${total} chars, over the ${CLAUDE_MD_BUDGET}-char budget; every session pays for them`] : [];
  const rules = (kind) => permissionsAdded(state)[kind].map((rule) => ({ rule, present: (settings.permissions?.[kind] ?? []).includes(rule) }));
  const permissions = {
    ask: rules('ask'),
    deny: rules('deny'),
    // Pre-T15 installs recorded a broad deny set; it is kept in settings.json untouched and only reported here.
    legacy_deny: legacyDenyOf(state).filter((r) => (settings.permissions?.deny ?? []).includes(r)),
  };
  return { installed: true, ok: items.every((i) => i.ok), items, notes, sizes, warnings, permissions, state };
}
