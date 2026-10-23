import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { listSections } from '../core/markers.js';
import { listMcpServers, readMcpServer } from '../core/toml.js';
import { hashOf, isMemoryServer, stdioOf } from './mcpsync.js';
import { resolveClaudeSource, resolveCodexTargets } from './paths.js';
import { isAmautaHook } from './servers.js';

/** Hook events Codex fires (the ones hooks.json can name). Claude events outside this set have no Codex counterpart. */
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'];

const text = (file) => readFile(file, 'utf8').catch(() => null);
const json = async (file) => {
  try {
    const v = JSON.parse((await text(file)) ?? '');
    return v !== null && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

/** Short readable name of a hook command (never the whole command line). */
export function hookName(command) {
  const m = /amauta\.js['"]?\s+hook\s+(\S+)/.exec(command) ?? /-m\s+amauta\.(\w+)['"]?\s+hook/.exec(command);
  if (m) return `amauta ${m[1]}`;
  const first = command.trim().split(/\s+/).find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) && w !== 'env') ?? command;
  return path.basename(first);
}

const eventsOf = (hooks) => Object.entries(hooks ?? {}).flatMap(([event, entries]) => (Array.isArray(entries) ? entries : []).flatMap((e) => (e?.hooks ?? []).map((h) => ({ event, command: String(h?.command ?? '') }))));

async function skillNames(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) if (!name.startsWith('.') && (await stat(path.join(dir, name, 'SKILL.md')).catch(() => null))) out.push(name);
  return out.sort();
}

const diff = (a, b) => ({ onlyClaude: a.filter((x) => !b.includes(x)), onlyCodex: b.filter((x) => !a.includes(x)) });
const comparable = (v) => hashOf({ ...v, env: Object.fromEntries(Object.entries(v.env ?? {}).filter(([k]) => k !== 'AMAUTA_RUNTIME')) });

/**
 * What one runtime has that the other lacks or has differently (names only). Present only when both are installed.
 * Informational: it never changes an exit code.
 */
export async function computeParity(opts = {}) {
  const t = resolveCodexTargets(opts);
  const c = resolveClaudeSource(opts);
  const both = (await stat(path.join(t.stateDir, 'state.json')).catch(() => null)) && (await stat(path.join(t.stateDir, 'codex-state.json')).catch(() => null));
  if (!both) return { present: false };

  const servers = (await json(c.claudeJson)).mcpServers ?? {};
  const claudeMcp = new Map();
  for (const [key, raw] of Object.entries(servers)) {
    const r = stdioOf(raw);
    if (r.value) claudeMcp.set(isMemoryServer(r.value) && key !== 'engram' && !('engram' in servers && !isMemoryServer(stdioOf(servers.engram).value)) ? 'engram' : key, r.value);
  }
  const toml = (await text(path.join(t.codexHome, 'config.toml'))) ?? '';
  const codexMcp = new Map();
  for (const name of listMcpServers(toml)) {
    const r = stdioOf(readMcpServer(toml, name).value);
    if (r.value) codexMcp.set(name, r.value);
  }
  const mcp = { ...diff([...claudeMcp.keys()].sort(), [...codexMcp.keys()].sort()), differs: [...claudeMcp.keys()].filter((n) => codexMcp.has(n) && comparable(claudeMcp.get(n)) !== comparable(codexMcp.get(n))).sort() };

  const skills = diff(await skillNames(path.join(c.claudeHome, 'skills')), await skillNames(t.codexSkillsDir));
  const ids = async (file) => listSections((await text(file)) ?? '').map((s) => s.id).sort();
  const instructions = diff(await ids(path.join(c.claudeHome, 'CLAUDE.md')), await ids(path.join(t.codexHome, 'AGENTS.md')));

  const claudeHooks = eventsOf((await json(path.join(c.claudeHome, 'settings.json'))).hooks);
  const codexHooks = eventsOf((await json(path.join(t.codexHome, 'hooks.json'))).hooks);
  const noCodexEvent = claudeHooks.filter((h) => !CODEX_HOOK_EVENTS.includes(h.event)).map((h) => ({ event: h.event, name: hookName(h.command) }));
  const have = new Set(codexHooks.map((h) => `${h.event}|${hookName(h.command)}`));
  const missingInCodex = claudeHooks
    .filter((h) => CODEX_HOOK_EVENTS.includes(h.event) && isAmautaHook(h.command) && !/preflight-hook/.test(h.command))
    .map((h) => ({ event: h.event, name: hookName(h.command) }))
    .filter((h) => !have.has(`${h.event}|${h.name}`));
  return { present: true, mcp, skills, instructions, hooks: { noCodexEvent, missingInCodex } };
}

/** Lines for the text status, names only. */
export function parityLines(p) {
  const out = [];
  const list = (label, names) => names.length > 0 && out.push(`${label}: ${names.join(', ')}`);
  for (const [kind, d] of [['mcp', p.mcp], ['skill', p.skills], ['instruction block', p.instructions]]) {
    list(`${kind} only in Claude`, d.onlyClaude);
    list(`${kind} only in Codex`, d.onlyCodex);
  }
  list('mcp different in the two runtimes', p.mcp.differs);
  for (const h of p.hooks.noCodexEvent) out.push(`hook ${h.event}: no Codex event (${h.name})`);
  for (const h of p.hooks.missingInCodex) out.push(`hook ${h.event} ${h.name}: in Claude, missing in Codex`);
  return out;
}
