import { injectSection } from '../core/markers.js';

/** Same defaults as upstream's balanced preset (SDD keys kept for the optional SDD module). */
export const DEFAULT_MODEL_ASSIGNMENTS = Object.freeze({
  'sdd-explore': 'sonnet',
  'sdd-research': 'sonnet',
  'sdd-propose': 'opus',
  'sdd-spec': 'sonnet',
  'sdd-design': 'opus',
  'sdd-tasks': 'sonnet',
  'sdd-apply': 'sonnet',
  'sdd-verify': 'sonnet',
  'sdd-archive': 'haiku',
  'sdd-onboard': 'haiku',
  'jd-judge-a': 'sonnet',
  'jd-judge-b': 'sonnet',
  'jd-fix-agent': 'sonnet',
  'graphify-extractor': 'haiku',
  default: 'sonnet',
});

/** Assignment values are "model" or { model, effort }. */
export function resolveAssignment(assignments, key) {
  const raw = assignments[key] ?? assignments.default ?? 'sonnet';
  if (typeof raw === 'string') return { model: raw, effort: undefined };
  return { model: raw.model ?? 'sonnet', effort: raw.effort };
}

export function engramToolPrefix(settings, memoryKey = 'engram') {
  return settings?.enabledPlugins?.['engram@engram'] === true ? 'mcp__plugin_engram_engram__' : `mcp__${memoryKey}__`;
}

const CODEGRAPH_TOOL = 'mcp__codegraph__codegraph_explore';

/**
 * Render one agent file: resolve model/effort placeholders, align Engram tool
 * names with the active MCP naming, grant the CodeGraph tool, append footers. `lockTools` (manifest `toolsLocked`)
 * keeps the tool allowlist verbatim and skips the footers, which describe tools such an agent does not have.
 */
export function renderAgent(template, { assignment, engramPrefix, footers = [], lockTools = false }) {
  let text = template.replace('{{CLAUDE_MODEL}}', assignment.model);
  text = assignment.effort
    ? text.replace('{{CLAUDE_EFFORT_FRONTMATTER}}', `effort: ${assignment.effort}`)
    : text.replace(/^\{\{CLAUDE_EFFORT_FRONTMATTER\}\}\n/m, '');
  text = text.replaceAll('mcp__plugin_engram_engram__', engramPrefix);
  text = text.replace(/^tools: (.+)$/m, (line, list) => {
    if (lockTools) return line; // a containment allowlist (e.g. Read only) must reach the installed file untouched
    const trimmed = list.trim();
    if (trimmed === '[]' || trimmed.includes(CODEGRAPH_TOOL)) return line;
    return `tools: ${trimmed}, ${CODEGRAPH_TOOL}`;
  });
  if (!text.endsWith('\n')) text += '\n';
  if (!lockTools) for (const f of footers) text = injectSection(text, f.id, f.body);
  return text;
}
