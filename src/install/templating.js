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
  default: 'sonnet',
});

/** Assignment values are "model" or { model, effort }. */
export function resolveAssignment(assignments, key) {
  const raw = assignments[key] ?? assignments.default ?? 'sonnet';
  if (typeof raw === 'string') return { model: raw, effort: undefined };
  return { model: raw.model ?? 'sonnet', effort: raw.effort };
}

export function engramToolPrefix(settings) {
  return settings?.enabledPlugins?.['engram@engram'] === true ? 'mcp__plugin_engram_engram__' : 'mcp__engram__';
}

const SECTION_RE = /^<!-- odd-orchestrator-section:(.+):(start|end) -->$/;

/** Parse the shared ODD sections file into Map(name -> body). */
export function parseOddSections(text) {
  const map = new Map();
  let current = null;
  let lines = [];
  for (const line of text.split('\n')) {
    const m = SECTION_RE.exec(line.trim());
    if (m && m[2] === 'start') {
      current = m[1];
      lines = [];
    } else if (m && m[2] === 'end' && current === m[1]) {
      map.set(current, lines.join('\n').replace(/^\n+|\n+$/g, ''));
      current = null;
    } else if (current !== null) {
      lines.push(line);
    }
  }
  return map;
}

export const RUNTIME_AGENT_ID = 'claude-code';

export function renderOrchestrator(template, sections) {
  return template
    .replace(/\{\{GENTLE_AI_ODD_SECTION:(.+?)\}\}/g, (_m, name) => {
      if (!sections.has(name)) throw new Error(`unknown ODD section: ${name}`);
      return sections.get(name);
    })
    .replaceAll('{{GENTLE_AI_RUNTIME_AGENT_ID}}', RUNTIME_AGENT_ID);
}

const CODEGRAPH_TOOL = 'mcp__codegraph__codegraph_explore';

/**
 * Render one agent file: resolve model/effort placeholders, align Engram tool
 * names with the active MCP naming, grant the CodeGraph tool, append footers.
 */
export function renderAgent(template, { assignment, engramPrefix, footers = [] }) {
  let text = template.replace('{{CLAUDE_MODEL}}', assignment.model);
  text = assignment.effort
    ? text.replace('{{CLAUDE_EFFORT_FRONTMATTER}}', `effort: ${assignment.effort}`)
    : text.replace(/^\{\{CLAUDE_EFFORT_FRONTMATTER\}\}\n/m, '');
  text = text.replaceAll('mcp__plugin_engram_engram__', engramPrefix);
  text = text.replace(/^tools: (.+)$/m, (line, list) => {
    const trimmed = list.trim();
    if (trimmed === '[]' || trimmed.includes(CODEGRAPH_TOOL)) return line;
    return `tools: ${trimmed}, ${CODEGRAPH_TOOL}`;
  });
  if (!text.endsWith('\n')) text += '\n';
  for (const f of footers) text = injectSection(text, f.id, f.body);
  return text;
}
