import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { listMcpServers, readMcpServer } from '../core/toml.js';
import { packageVersion } from '../version.js';
import { resolveClaudeSource, resolveCodexTargets } from './paths.js';

/**
 * A cheap fingerprint of everything the Claude <-> Codex sync reads: the MCP servers of both runtimes, the skills
 * directories of both runtimes, the amauta version and the install choices. The SessionStart step compares it with the
 * one recorded by the last sync and only runs the (heavier) sync when it moved. Keeps no values: it is a hash.
 */
const readText = (file) => readFile(file, 'utf8').catch(() => null);

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

async function listing(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((e) => `${e.name}:${e.isSymbolicLink() ? 'l' : e.isDirectory() ? 'd' : 'f'}`).sort();
  } catch {
    return null;
  }
}

const pick = (state, keys) => (state ? Object.fromEntries(keys.map((k) => [k, state[k] ?? null])) : null);
const jsonOf = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const CHOICES = ['persona', 'telemetry', 'sdd', 'rea', 'context7', 'impeccable', 'archify'];

export async function sourceFingerprint(opts = {}) {
  const t = resolveCodexTargets(opts);
  const c = resolveClaudeSource(opts);
  const claudeJson = jsonOf((await readText(c.claudeJson)) ?? '');
  const toml = (await readText(path.join(t.codexHome, 'config.toml'))) ?? '';
  const codexMcp = Object.fromEntries(listMcpServers(toml).map((n) => [n, readMcpServer(toml, n).value]));
  const parts = {
    version: packageVersion(),
    claudeMcp: claudeJson?.mcpServers ?? null,
    codexMcp,
    claudeSkills: await listing(path.join(c.claudeHome, 'skills')),
    codexSkills: await listing(t.codexSkillsDir),
    claude: pick(jsonOf((await readText(path.join(t.stateDir, 'state.json'))) ?? ''), CHOICES),
    codex: pick(jsonOf((await readText(path.join(t.stateDir, 'codex-state.json'))) ?? ''), CHOICES),
  };
  return createHash('sha256').update(stable(parts)).digest('hex');
}

export const syncRecordOf = (stateDir) => path.join(stateDir, 'sync.json');

/** Run the sync only when the fingerprint moved since the last one. Never throws; the hook wrapper prints nothing. */
export async function syncIfChanged(opts = {}) {
  const t = resolveCodexTargets(opts);
  if ((await lstat(path.join(t.stateDir, 'codex-state.json')).catch(() => null)) === null) return { ran: false, reason: 'no codex install' };
  const recorded = jsonOf((await readText(syncRecordOf(t.stateDir))) ?? '')?.fingerprint;
  if (recorded === (await sourceFingerprint(opts))) return { ran: false, reason: 'unchanged' };
  const { syncCodex } = await import('./codex.js');
  await syncCodex(opts);
  return { ran: true };
}
