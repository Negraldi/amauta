import { createHash } from 'node:crypto';
import { readFile, rm, rmdir, stat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { injectSection, removeSection, listSections } from '../core/markers.js';
import { deepMerge, mergeHooks, removeHooksWhere } from '../core/jsonmerge.js';
import { writeFileAtomic } from '../core/fsatomic.js';
import { createBackup } from '../core/backup.js';
import { resolveTargets } from './paths.js';
import { assetPath, listFiles, loadManifest, readAssetBuffer, readAssetText, repoRoot } from './assets.js';
import {
  DEFAULT_MODEL_ASSIGNMENTS,
  engramToolPrefix,
  renderAgent,
  resolveAssignment,
} from './templating.js';
import { desiredHooks, desiredMcpServers, isAmautaHook, shellQuote } from './servers.js';
import { renderSddFiles } from './sdd.js';
import { packageVersion } from '../version.js';
import { CODEGRAPH_HINT, codegraphStatus, findOnPath } from '../codegraph/index.js';
import { graphifyStatus, lastHookError } from '../graphify/probe.js';

export const STATE_SCHEMA = 'amauta.state/v1';
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

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const toJson = (obj) => `${JSON.stringify(obj, null, 2)}\n`;
const statOrNull = (p) => stat(p).then((s) => s, () => null);
const readOrNull = (p) => readFile(p).then((b) => b, () => null);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

async function readJsonObject(file, label) {
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

const statePathOf = (stateDir) => path.join(stateDir, 'state.json');

async function readState(stateDir) {
  const buf = await readOrNull(statePathOf(stateDir));
  if (!buf) return null;
  try {
    const state = JSON.parse(buf.toString('utf8'));
    return isObject(state) ? state : null;
  } catch {
    return null;
  }
}

const isOurs = (servers, prev, key) =>
  key in servers && prev?.mcp_added?.[key] !== undefined && isDeepStrictEqual(servers[key], prev.mcp_added[key]);

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

/** Set `timeout` on installed hooks that lack one, matched by event and exact command from `owned`. */
function ensureTimeouts(settings, owned) {
  let out = settings;
  for (const [event, entries] of Object.entries(owned)) {
    const want = new Map(entries.flatMap((e) => e.hooks).filter((h) => h.timeout).map((h) => [h.command, h.timeout]));
    const current = out.hooks?.[event];
    if (!Array.isArray(current)) continue;
    const next = current.map((e) => (!Array.isArray(e?.hooks) ? e : { ...e, hooks: e.hooks.map((h) => (h && want.has(h.command) && h.timeout === undefined ? { ...h, timeout: want.get(h.command) } : h)) }));
    if (!isDeepStrictEqual(next, current)) out = { ...out, hooks: { ...out.hooks, [event]: next } };
  }
  return out;
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

/** Markdown skill files may name helper code of this checkout; resolve those placeholders to shell-safe absolute values. */
export function renderSkillFile(rel, buf, pythonDir = path.join(repoRoot, 'python')) {
  if (!rel.endsWith('.md')) return buf;
  let text = buf.toString('utf8');
  if (!text.includes('{{AMAUTA_')) return buf;
  // The whole `NAME=value` assignment is quoted, so a checkout path with spaces or quotes still forms one `env` argument.
  text = text.replaceAll('{{AMAUTA_PYTHONPATH_ENV}}', shellQuote(`PYTHONPATH=${pythonDir}`));
  return Buffer.from(text, 'utf8');
}

/** Managed files (relative posix path -> Buffer) rendered for this install. */
async function renderManagedFiles(manifest, { persona, assignments, engramPrefix, sdd }) {
  const files = new Map();
  files.set(manifest.outputStyleTarget, await readAssetBuffer(manifest.personas[persona].outputStyle));

  for (const skill of manifest.skills) {
    const dir = `${manifest.skillsDir}/${skill}`;
    for (const rel of await listFiles(assetPath(dir))) {
      files.set(`skills/${skill}/${rel.split(path.sep).join('/')}`, renderSkillFile(rel, await readAssetBuffer(`${dir}/${rel.split(path.sep).join('/')}`)));
    }
  }
  for (const rel of await listFiles(assetPath(manifest.sharedSkillsDir))) {
    const posix = rel.split(path.sep).join('/');
    files.set(`skills/_shared/${posix}`, await readAssetBuffer(`${manifest.sharedSkillsDir}/${posix}`));
  }

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
  if (sdd) for (const [rel, data] of await renderSddFiles(manifest, { assignments, engramPrefix, footers })) files.set(rel, data);
  return files;
}

async function renderSections(manifest, persona) {
  const out = [];
  for (const s of manifest.claudeMd) {
    const source = s.source.startsWith('persona:') ? manifest.personas[persona].residual : s.source;
    out.push({ id: s.id, body: await readAssetText(source) });
  }
  return out;
}

const needsWrite = async (file, data, mode) => {
  const st = await statOrNull(file);
  if (!st) return true;
  if (mode !== undefined && (st.mode & 0o777) !== mode) return true;
  const current = await readOrNull(file);
  return !current || !current.equals(Buffer.isBuffer(data) ? data : Buffer.from(data));
};

/** Compute everything install would do, without touching the disk. */
async function plan(opts) {
  const t = resolveTargets(opts);
  const manifest = await loadManifest();
  const persona = opts.persona ?? 'gentleman';
  if (!manifest.personas[persona]) throw new Error(`unknown persona: ${persona} (expected gentleman or neutral)`);
  const prev = await readState(t.stateDir);

  const settingsFile = abs(t.claudeHome, 'settings.json');
  const mdFile = abs(t.claudeHome, 'CLAUDE.md');
  const settingsIn = await readJsonObject(settingsFile, 'settings.json');
  const claudeJsonIn = await readJsonObject(t.claudeJson, '.claude.json');
  const mdBuf = await readOrNull(mdFile);

  const assignments = { ...DEFAULT_MODEL_ASSIGNMENTS, ...(prev?.model_assignments ?? {}) };
  const telemetry = opts.telemetry !== false;
  const sdd = opts.withSdd === true || prev?.sdd === true; // optional module; sticky until uninstall
  const codegraphOnPath = (await findOnPath('codegraph', opts.searchPath)) !== null;
  const currentServers = isObject(claudeJsonIn.data.mcpServers) ? claudeJsonIn.data.mcpServers : {};
  // Opt-in MCP servers, sticky like sdd. A state that predates the opt-in (no key at all) registered both servers by
  // default: keep each one that is still exactly what we wrote (carry-over); an edited entry is the user's.
  const optIn = (flag, key) => flag === true || prev?.[key] === true || (prev !== null && prev?.[key] === undefined && isOurs(currentServers, prev, key));
  const rea = optIn(opts.withRea, 'rea');
  const context7 = optIn(opts.withContext7, 'context7');
  const memoryKey = chooseMemoryKey({ settings: settingsIn.data, currentServers, prev });
  const engramPrefix = engramToolPrefix(settingsIn.data, memoryKey ?? 'engram');
  const writes = [];
  const skipped = [];
  const managedFiles = {};

  // Managed files (output style, skills, agents).
  const rendered = await renderManagedFiles(manifest, { persona, assignments, engramPrefix, sdd });
  for (const [rel, data] of rendered) {
    const file = abs(t.claudeHome, rel);
    const existing = await readOrNull(file);
    if (existing === null) {
      writes.push({ rel, path: file, data });
    } else if (existing.equals(data)) {
      // already in place: adopt
    } else if (opts.force || prev?.managed_files?.[rel] === sha256(existing)) {
      writes.push({ rel, path: file, data });
    } else {
      skipped.push(rel);
      continue;
    }
    managedFiles[rel] = sha256(data);
  }

  // CLAUDE.md sections.
  const sections = await renderSections(manifest, persona);
  const mdBefore = mdBuf ? mdBuf.toString('utf8') : '';
  let md = mdBefore;
  for (const s of sections) md = injectSection(md, s.id, s.body);
  // Sections an earlier version installed and this one no longer ships: those its state lists, plus the known retired
  // ids (so a missing or reset state.json still converges). Removing an outer section takes nested markers with it.
  const wantedIds = new Set(sections.map((s) => s.id));
  for (const id of new Set([...(prev?.claude_md_sections ?? []), ...RETIRED_SECTIONS])) if (!wantedIds.has(id)) md = removeSection(md, id);
  if (!mdBuf || md !== mdBefore) writes.push({ rel: 'CLAUDE.md', path: mdFile, data: Buffer.from(md, 'utf8') });

  // settings.json.
  const overlay = JSON.parse(await readAssetText(manifest.settingsOverlay));
  const styleName = manifest.personas[persona].styleName;
  const settingsPrevStyle = prev?.settings_prev ? prev.settings_prev.outputStyle : (settingsIn.data.outputStyle ?? null);
  // Permissions: the overlay's `ask` and `deny` rules are appended after the user's own. State records only the rules
  // we appended (`permissions_added`); a rule the user already had is never recorded, so it is never removed.
  const permissions = mergePermissions(settingsIn.data, prev, overlay);
  let settings = deepMerge(settingsIn.data, { outputStyle: styleName });
  if (permissions.changed) settings = { ...settings, permissions: permissions.value };
  const wantedHooks = desiredHooks({ stateDir: t.stateDir, telemetry, sdd });
  const wantedCommands = new Set(Object.values(wantedHooks).flatMap((es) => es.flatMap((e) => e.hooks.map((h) => h.command))));
  // Drop stale amauta hook commands (e.g. PATH-based ones from earlier versions) before adding ours.
  settings = removeHooksWhere(settings, (c) => isAmautaHook(c) && !wantedCommands.has(c));
  settings = mergeHooks(settings, wantedHooks);
  // codegraph's own prompt hook: only when the tool is installed, never duplicated, and only removed again if we added it.
  const hookWasThere = hasCommand(settingsIn.data, 'UserPromptSubmit', CODEGRAPH_PROMPT_HOOK);
  const weAddedHook = prev?.codegraph_hook_added === true && hookWasThere;
  const dropHook = weAddedHook && !codegraphOnPath; // a hook we added must not outlive the tool: it would fail on every prompt
  const codegraphHookAdded = !dropHook && (weAddedHook || (codegraphOnPath && !hookWasThere));
  if (dropHook) settings = removeHooksWhere(settings, (c) => c === CODEGRAPH_PROMPT_HOOK);
  if (codegraphOnPath && !hookWasThere) {
    settings = mergeHooks(settings, { UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: CODEGRAPH_PROMPT_HOOK, timeout: CODEGRAPH_HOOK_TIMEOUT }] }] });
  }
  // Hooks we own keep a timeout across upgrades (mergeHooks keeps an older entry as is when its command did not change).
  const owned = { ...wantedHooks };
  if (codegraphHookAdded) owned.UserPromptSubmit = [...(owned.UserPromptSubmit ?? []), { hooks: [{ command: CODEGRAPH_PROMPT_HOOK, timeout: CODEGRAPH_HOOK_TIMEOUT }] }];
  settings = ensureTimeouts(settings, owned);
  if (!settingsIn.existed || !isDeepStrictEqual(settings, settingsIn.data)) {
    writes.push({ rel: 'settings.json', path: settingsFile, data: Buffer.from(toJson(settings), 'utf8') });
  }

  // .claude.json MCP servers (only when absent; never overwrite a user's entry).
  const { memory, ...wanted } = desiredMcpServers({ stateDir: t.stateDir, rea, context7 });
  if (memoryKey) wanted[memoryKey] = memory;
  if (!codegraphOnPath && !isOurs(currentServers, prev, 'codegraph')) delete wanted.codegraph; // external tool: register only when present
  const mcpAdded = {};
  const servers = { ...currentServers };
  for (const [name, value] of Object.entries(wanted)) {
    if (!(name in currentServers)) {
      servers[name] = value;
      mcpAdded[name] = value;
    } else if (isOurs(currentServers, prev, name)) {
      servers[name] = value; // ours from an earlier install: refresh it
      mcpAdded[name] = value;
    }
  }
  // Entries we added before that are no longer wanted (e.g. the old compiled engram) go away if untouched.
  for (const name of Object.keys(prev?.mcp_added ?? {})) {
    if (!(name in wanted) && isOurs(currentServers, prev, name)) delete servers[name];
  }
  const claudeJson = { ...claudeJsonIn.data, mcpServers: servers };
  if (!claudeJsonIn.existed || !isDeepStrictEqual(claudeJson, claudeJsonIn.data) ||
      ((await statOrNull(t.claudeJson))?.mode & 0o777) !== 0o600) {
    writes.push({ rel: '.claude.json', path: t.claudeJson, data: Buffer.from(toJson(claudeJson), 'utf8'), mode: 0o600 });
  }

  const created = prev?.created_files ?? [
    ...(mdBuf ? [] : [mdFile]),
    ...(settingsIn.existed ? [] : [settingsFile]),
    ...(claudeJsonIn.existed ? [] : [t.claudeJson]),
  ];

  const makeState = (lastBackup) => ({
    schema: STATE_SCHEMA,
    version: packageVersion(),
    installed_at: prev?.installed_at ?? new Date().toISOString(),
    claude_home: t.claudeHome,
    claude_json: t.claudeJson,
    components: COMPONENTS,
    persona,
    model_assignments: assignments,
    rdd_mode: prev?.rdd_mode ?? 'off',
    last_backup: lastBackup ?? prev?.last_backup ?? null,
    managed_files: managedFiles,
    claude_md_sections: sections.map((s) => s.id),
    settings_prev: { outputStyle: settingsPrevStyle },
    permissions_added: permissions.added,
    ...(legacyDenyOf(prev).length > 0 ? { legacy_deny: legacyDenyOf(prev) } : {}),
    mcp_added: mcpAdded,
    memory_server_key: memoryKey,
    telemetry,
    sdd,
    rea,
    context7,
    codegraph_hook_added: codegraphHookAdded,
    created_files: created,
  });

  const real = [];
  for (const w of writes) if (await needsWrite(w.path, w.data, w.mode)) real.push(w);
  return { t, prev, writes: real, skipped, makeState };
}

export async function install(opts = {}) {
  const { t, prev, writes, skipped, makeState } = await plan(opts);
  const files = writes.map((w) => w.rel);
  if (opts.dryRun) return { dryRun: true, changed: writes.length > 0, files, skipped, backup: null };

  const statePath = statePathOf(t.stateDir);
  let backup = null;
  if (writes.length > 0) {
    ({ dir: backup } = await createBackup(t.stateDir, [...writes.map((w) => w.path), statePath]));
    for (const w of writes) await writeFileAtomic(w.path, w.data, w.mode === undefined ? {} : { mode: w.mode });
  }
  const stateText = toJson(makeState(backup));
  const stateChanged = await needsWrite(statePath, stateText);
  if (stateChanged) await writeFileAtomic(statePath, stateText);
  return { dryRun: false, changed: writes.length > 0 || stateChanged || !prev, files, skipped, backup };
}

async function pruneEmptyDirs(start, stop) {
  let dir = start;
  while (dir.startsWith(stop + path.sep) && dir !== stop) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
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
      if (name in servers && isDeepStrictEqual(servers[name], value)) delete servers[name];
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
  for (const [rel, hash] of Object.entries(state?.managed_files ?? {})) {
    const file = abs(t.claudeHome, rel);
    const buf = await readOrNull(file);
    if (buf === null) continue;
    if (sha256(buf) === hash) deletes.push(file);
    else kept.push(rel);
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
    await pruneEmptyDirs(path.dirname(file), t.claudeHome);
  }
  if (hadState) await rm(statePath, { force: true });
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
  for (const [event, entries] of Object.entries(desiredHooks({ stateDir: t.stateDir, telemetry: state.telemetry === true, sdd: state.sdd === true }))) {
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
  add('outputStyle', STYLE_NAMES.includes(settings.outputStyle), String(settings.outputStyle ?? 'unset'));

  const servers = (await readJsonObject(t.claudeJson, '.claude.json')).data.mcpServers ?? {};
  for (const name of Object.keys(state.mcp_added ?? {})) add(`mcp ${name}`, name in servers, name in servers ? '' : 'missing');

  for (const [rel, hash] of Object.entries(state.managed_files ?? {})) {
    const buf = await readOrNull(abs(t.claudeHome, rel));
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
