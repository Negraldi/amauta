import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { listMcpServers, readMcpServer, removeMcpServer, setMcpServer } from '../core/toml.js';

/**
 * Two-way sync of stdio MCP servers between the Claude user config (`.claude.json` mcpServers) and Codex's
 * `config.toml` (`[mcp_servers.<name>]`), as a 3-way merge against the set both sides had at the last sync.
 *
 * Keys that map: `command`, `args`, `env` (stdio only). Everything else stays on the side that has it and is ignored
 * for comparison: Claude's `type` and any other Claude key, Codex's tuning keys (`startup_timeout_sec`, `enabled`, ...).
 * Servers amauta writes itself (`managed`) are one-way and never go through here; neither does amauta's memory server.
 * The base keeps hashes only, never values.
 */
export const baseFileOf = (stateDir) => path.join(stateDir, 'mcp-sync.json');

const sha = (text) => createHash('sha256').update(text).digest('hex');
export const isMemoryServer = (v) => Array.isArray(v?.args) && v.args.includes('amauta.memory');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `{ value: {command, args?, env?} }` for a stdio server Codex can take, else `{ reason }` (never containing a value). */
export function stdioOf(raw) {
  if (!isObject(raw)) return { reason: 'not an object' };
  const { type, command, args, env, ...rest } = raw;
  if ((type !== undefined && type !== 'stdio') || typeof command !== 'string') return { reason: `not a stdio server${type ? ` (${type})` : ''}` };
  if (args !== undefined && !(Array.isArray(args) && args.every((a) => typeof a === 'string'))) return { reason: 'args are not a list of strings' };
  if (env !== undefined && !(isObject(env) && Object.values(env).every((v) => typeof v === 'string'))) return { reason: 'env values are not strings' };
  return { value: { command, ...(args !== undefined ? { args } : {}), ...(env !== undefined ? { env } : {}) }, extras: rest };
}

const core = ({ command, args, env }) => ({ command, ...(args !== undefined ? { args } : {}), ...(env !== undefined ? { env } : {}) });
const canonical = (v) => JSON.stringify({ command: v.command, args: v.args ?? [], env: Object.fromEntries(Object.entries(v.env ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) });
export const hashOf = (v) => sha(canonical(v));

/** Servers that belong to one runtime's own machinery; the value is the runtime that owns (and so registers) them. */
export const BUILTIN_EXCLUDED = { node_repl: 'codex', codex_apps: 'codex' };

const under = (file, dir) => typeof file === 'string' && (file === dir || file.startsWith(dir.endsWith('/') ? dir : `${dir}/`));
/** Normalize `internalPaths` entries: a path string or `{ path, runtime }`. */
const asDirs = (list) => list.map((e) => (typeof e === 'string' ? { path: e } : e));

const EXTRA_OK = (v) => ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === 'string'));

/**
 * Plan one sync. Inputs are file texts; nothing is read or written here.
 *   claudeText  .claude.json text ('' when absent)   tomlText  config.toml text ('' when absent)
 *   base        { name: hash } from the last sync    managed   names amauta writes one-way (skipped here)
 * Returns { toml, claudeText (null when unchanged), base, report } where report lists names only:
 *   toCodex / toClaude (added or changed), removedFromCodex / removedFromClaude, conflicts, unsupported ({name, reason}).
 */
/** Stdio servers of one side split into syncable (`side`), not syncable (`other`, reported) and excluded ones. */
function classify(entries, { managed, excludedBy, report, prefix = '' }) {
  const side = new Map();
  const other = new Set();
  const excluded = new Map();
  for (const [name, raw, r] of entries) {
    if (managed.has(name)) continue;
    const ex = excludedBy(name, r.value ?? raw);
    if (ex) excluded.set(name, { ...ex, raw, value: r.value, extras: r.extras });
    else if (r.reason) {
      report.unsupported.push({ name, reason: `${prefix}${r.reason}` });
      other.add(name);
    } else if (!isMemoryServer(r.value)) side.set(name, { value: r.value, raw, extras: r.extras });
  }
  return { side, other, excluded };
}

/** Excluded servers are never synced; a copy an earlier sync wrote to the other runtime goes only if untouched. */
function settleExcluded(s, { base, excludedClaude, excludedCodex }) {
  for (const name of new Set([...excludedClaude.keys(), ...excludedCodex.keys()])) {
    const c = excludedClaude.get(name);
    const x = excludedCodex.get(name);
    s.report.excluded.push(name);
    if (base[name] === undefined) continue;
    const runtime = (c ?? x).runtime;
    const copy = runtime === 'codex' ? c : runtime === 'claude' ? x : undefined; // the side that is not the owner
    const untouchedCopy = runtime === 'codex' ? isDeepStrictEqual(copy?.raw, { type: 'stdio', ...core(copy?.value ?? {}) }) : Object.keys(copy?.extras ?? {}).length === 0;
    const intact = copy !== undefined && copy.value !== undefined && hashOf(copy.value) === base[name] && untouchedCopy;
    if (!intact) {
      s.report.staleExcluded.push(name);
      s.nextBase[name] = base[name];
    } else if (runtime === 'codex') {
      delete s.servers[name];
      s.changedClaude = true;
      s.report.removedExcluded.push(`claude:${name}`);
    } else {
      s.toml = removeMcpServer(s.toml, name);
      s.report.removedExcluded.push(`codex:${name}`);
    }
  }
}

/** Copy Claude's value of `name` to Codex (or remove it there); false when a Codex-only extra cannot be kept. */
function copyToCodex(s, name, c, x) {
  if (c) {
    const extras = x?.extras ?? {};
    for (const v of Object.values(extras)) if (!EXTRA_OK(v)) return false;
    s.toml = setMcpServer(s.toml, name, { ...core(c.value), ...extras });
    s.report.toCodex.push(name);
  } else {
    s.toml = removeMcpServer(s.toml, name);
    s.report.removedFromCodex.push(name);
  }
  return true;
}

/** Copy Codex's value of `name` to Claude (or remove it there), keeping Claude-only keys. */
function copyToClaude(s, name, c, x) {
  if (x) {
    const { type, command: _c, args: _a, env: _e, ...keep } = c?.raw ?? {};
    s.servers[name] = { type: type ?? 'stdio', ...core(x.value), ...keep };
    s.report.toClaude.push(name);
  } else {
    delete s.servers[name];
    s.report.removedFromClaude.push(name);
  }
  s.changedClaude = true;
}

/** 3-way decision for one server against the last synced hash `hb`. */
function syncOne(s, name, c, x, hb) {
  const hc = c ? hashOf(c.value) : undefined;
  const hx = x ? hashOf(x.value) : undefined;
  if (hc === hx) {
    if (hc !== undefined) s.nextBase[name] = hc;
  } else if (hb === undefined) {
    if (c && x) s.report.conflicts.push(name); // both sides have it with different values and there is no common ancestor
    else if (c) {
      if (copyToCodex(s, name, c, x)) s.nextBase[name] = hc;
    } else {
      copyToClaude(s, name, c, x);
      s.nextBase[name] = hx;
    }
  } else if (hc === hb) {
    copyToClaude(s, name, c, x); // Codex changed it or removed it
    if (hx !== undefined) s.nextBase[name] = hx;
  } else if (hx === hb) {
    if (!copyToCodex(s, name, c, x)) s.nextBase[name] = hb;
    else if (hc !== undefined) s.nextBase[name] = hc;
  } else {
    s.report.conflicts.push(name);
    s.nextBase[name] = hb;
  }
}

export function planMcpSync({ claudeText, tomlText, base = {}, managed = new Set(), exclude = [], internalPaths = [] }) {
  const report = { toCodex: [], toClaude: [], removedFromCodex: [], removedFromClaude: [], conflicts: [], transport: [], unsupported: [], excluded: [], removedExcluded: [], staleExcluded: [], unreadable: null };
  const dirs = asDirs(internalPaths);
  const userExcluded = new Set(exclude);
  /** `{ runtime }` (runtime may be undefined) when the server is runtime-internal or listed by the user, else null. */
  const excludedBy = (name, value) => {
    if (name in BUILTIN_EXCLUDED) return { runtime: BUILTIN_EXCLUDED[name] };
    const dir = dirs.find((d) => under(value?.command, d.path));
    if (dir) return { runtime: dir.runtime };
    return userExcluded.has(name) ? { runtime: undefined } : null;
  };
  let claudeData = {};
  if (claudeText.trim() !== '') {
    try {
      claudeData = JSON.parse(claudeText);
      if (!isObject(claudeData)) throw new Error('not an object');
    } catch {
      report.unreadable = '.claude.json';
      return { toml: tomlText, claudeText: null, base, report };
    }
  }
  const servers = isObject(claudeData.mcpServers) ? { ...claudeData.mcpServers } : {};
  const claude = classify(Object.entries(servers).map(([name, raw]) => [name, raw, stdioOf(raw)]), { managed, excludedBy, report });
  const codexEntries = listMcpServers(tomlText).map((name) => {
    const { value } = readMcpServer(tomlText, name);
    return [name, value, value === null ? { reason: 'unreadable' } : stdioOf(value)];
  });
  const codex = classify(codexEntries, { managed, excludedBy, report, prefix: 'codex: ' });
  const s = { toml: tomlText, servers, changedClaude: false, nextBase: {}, report };
  settleExcluded(s, { base, excludedClaude: claude.excluded, excludedCodex: codex.excluded });
  const names = new Set([...Object.keys(base), ...claude.side.keys(), ...codex.side.keys()]);
  for (const name of [...names].sort()) {
    if (managed.has(name) || claude.excluded.has(name) || codex.excluded.has(name)) continue;
    // Another transport on one side (e.g. HTTP in Codex, stdio in Claude): never converted, left alone on both sides.
    if ((claude.side.has(name) && codex.other.has(name)) || (codex.side.has(name) && claude.other.has(name))) {
      report.transport.push(name);
      if (base[name] !== undefined) s.nextBase[name] = base[name];
      continue;
    }
    syncOne(s, name, claude.side.get(name), codex.side.get(name), base[name]);
  }
  let outClaude = null;
  if (s.changedClaude) {
    const next = { ...claudeData, mcpServers: s.servers };
    if (Object.keys(s.servers).length === 0) delete next.mcpServers;
    outClaude = `${JSON.stringify(next, null, 2)}\n`;
  }
  const same = isDeepStrictEqual(s.nextBase, base);
  return { toml: s.toml, claudeText: outClaude, base: same ? base : s.nextBase, report };
}
