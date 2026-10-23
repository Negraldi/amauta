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
  const excludedClaude = new Map();
  const excludedCodex = new Map();
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
  const claudeSide = new Map();
  const claudeOther = new Set(); // present in Claude but not a stdio server Codex can take
  for (const [name, raw] of Object.entries(servers)) {
    if (managed.has(name)) continue;
    const r = stdioOf(raw);
    const ex = excludedBy(name, r.value ?? raw);
    if (ex) {
      excludedClaude.set(name, { ...ex, raw, value: r.value });
      continue;
    }
    if (r.reason) {
      report.unsupported.push({ name, reason: r.reason });
      claudeOther.add(name);
    } else if (!isMemoryServer(r.value)) claudeSide.set(name, { value: r.value, raw });
  }
  const codexSide = new Map();
  const codexOther = new Set();
  for (const name of listMcpServers(tomlText)) {
    if (managed.has(name)) continue;
    const { value } = readMcpServer(tomlText, name);
    const r = value === null ? { reason: 'unreadable' } : stdioOf(value);
    const ex = excludedBy(name, r.value ?? value);
    if (ex) {
      excludedCodex.set(name, { ...ex, value: r.value, extras: r.extras });
      continue;
    }
    if (r.reason) {
      report.unsupported.push({ name, reason: `codex: ${r.reason}` });
      codexOther.add(name);
    } else if (!isMemoryServer(r.value)) codexSide.set(name, { value: r.value, extras: r.extras });
  }
  let toml = tomlText;
  let changedClaude = false;
  const nextBase = {};
  // Excluded servers: never synced. A copy an earlier sync wrote to the other runtime goes only if untouched.
  for (const name of new Set([...excludedClaude.keys(), ...excludedCodex.keys()])) {
    const c = excludedClaude.get(name);
    const x = excludedCodex.get(name);
    report.excluded.push(name);
    if (base[name] === undefined) continue;
    const runtime = (c ?? x).runtime;
    const copy = runtime === 'codex' ? c : runtime === 'claude' ? x : undefined; // the side that is not the owner
    if (!copy) {
      report.staleExcluded.push(name);
      nextBase[name] = base[name];
      continue;
    }
    const intact = copy.value !== undefined && hashOf(copy.value) === base[name] && (runtime === 'codex' ? isDeepStrictEqual(copy.raw, { type: 'stdio', ...core(copy.value) }) : Object.keys(copy.extras ?? {}).length === 0);
    if (!intact) {
      report.staleExcluded.push(name);
      nextBase[name] = base[name];
    } else if (runtime === 'codex') {
      delete servers[name];
      changedClaude = true;
      report.removedExcluded.push(`claude:${name}`);
    } else {
      toml = removeMcpServer(toml, name);
      report.removedExcluded.push(`codex:${name}`);
    }
  }
  const names = new Set([...Object.keys(base), ...claudeSide.keys(), ...codexSide.keys()]);
  for (const name of [...names].sort()) {
    if (managed.has(name) || excludedClaude.has(name) || excludedCodex.has(name)) continue;
    // Another transport on one side (e.g. HTTP in Codex, stdio in Claude): never converted, left alone on both sides.
    if ((claudeSide.has(name) && codexOther.has(name)) || (codexSide.has(name) && claudeOther.has(name))) {
      report.transport.push(name);
      if (base[name] !== undefined) nextBase[name] = base[name];
      continue;
    }
    const c = claudeSide.get(name);
    const x = codexSide.get(name);
    const hc = c ? hashOf(c.value) : undefined;
    const hx = x ? hashOf(x.value) : undefined;
    const hb = base[name];
    const toCodex = () => {
      if (c) {
        const extras = x?.extras ?? {};
        for (const v of Object.values(extras)) if (!EXTRA_OK(v)) return false;
        toml = setMcpServer(toml, name, { ...core(c.value), ...extras });
        report.toCodex.push(name);
      } else {
        toml = removeMcpServer(toml, name);
        report.removedFromCodex.push(name);
      }
      return true;
    };
    const toClaude = () => {
      if (x) {
        const { type, command: _c, args: _a, env: _e, ...keep } = c?.raw ?? {};
        servers[name] = { type: type ?? 'stdio', ...core(x.value), ...keep };
        report.toClaude.push(name);
      } else {
        delete servers[name];
        report.removedFromClaude.push(name);
      }
      changedClaude = true;
    };
    if (hc === hx) {
      if (hc !== undefined) nextBase[name] = hc;
    } else if (hb === undefined) {
      if (c && x) {
        report.conflicts.push(name); // both sides have it with different values and there is no common ancestor
      } else if (c) {
        if (toCodex()) nextBase[name] = hc;
      } else {
        toClaude();
        nextBase[name] = hx;
      }
    } else if (hc === hb) {
      toClaude(); // Codex changed it or removed it
      if (hx !== undefined) nextBase[name] = hx;
    } else if (hx === hb) {
      if (toCodex()) {
        if (hc !== undefined) nextBase[name] = hc;
      } else nextBase[name] = hb;
    } else {
      report.conflicts.push(name);
      nextBase[name] = hb;
    }
  }
  let outClaude = null;
  if (changedClaude) {
    const next = { ...claudeData, mcpServers: servers };
    if (Object.keys(servers).length === 0) delete next.mcpServers;
    outClaude = `${JSON.stringify(next, null, 2)}\n`;
  }
  const same = isDeepStrictEqual(nextBase, base);
  return { toml, claudeText: outClaude, base: same ? base : nextBase, report };
}
