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

const EXTRA_OK = (v) => ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === 'string'));

/**
 * Plan one sync. Inputs are file texts; nothing is read or written here.
 *   claudeText  .claude.json text ('' when absent)   tomlText  config.toml text ('' when absent)
 *   base        { name: hash } from the last sync    managed   names amauta writes one-way (skipped here)
 * Returns { toml, claudeText (null when unchanged), base, report } where report lists names only:
 *   toCodex / toClaude (added or changed), removedFromCodex / removedFromClaude, conflicts, unsupported ({name, reason}).
 */
export function planMcpSync({ claudeText, tomlText, base = {}, managed = new Set() }) {
  const report = { toCodex: [], toClaude: [], removedFromCodex: [], removedFromClaude: [], conflicts: [], unsupported: [], unreadable: null };
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
  for (const [name, raw] of Object.entries(servers)) {
    if (managed.has(name)) continue;
    const r = stdioOf(raw);
    if (r.reason) report.unsupported.push({ name, reason: r.reason });
    else if (!isMemoryServer(r.value)) claudeSide.set(name, { value: r.value, raw });
  }
  const codexSide = new Map();
  for (const name of listMcpServers(tomlText)) {
    if (managed.has(name)) continue;
    const { value } = readMcpServer(tomlText, name);
    const r = value === null ? { reason: 'unreadable' } : stdioOf(value);
    if (r.reason) report.unsupported.push({ name, reason: `codex: ${r.reason}` });
    else if (!isMemoryServer(r.value)) codexSide.set(name, { value: r.value, extras: r.extras });
  }
  let toml = tomlText;
  let changedClaude = false;
  const nextBase = {};
  const names = new Set([...Object.keys(base), ...claudeSide.keys(), ...codexSide.keys()]);
  for (const name of [...names].sort()) {
    if (managed.has(name)) continue;
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
