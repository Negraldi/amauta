import { git, gitOrNull, resolveCommit, EMPTY_TREE } from '../util/git.js';

const DOC_EXT = new Set(['.md', '.mdx', '.rst', '.adoc']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp']);
const CONFIG_EXT = new Set(['.json', '.yaml', '.yml', '.toml']);
const SENSITIVE_TOKENS = new Set(['auth', 'security', 'webhook', 'payments']);
const SINK_RE = /child_process|\bexec\(|\bspawn\(|subprocess|os\.system|exec\.Command|\beval\(/;
const SLICE_BUDGET = 400;

const ext = (p) => {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
};
const base = (p) => p.slice(p.lastIndexOf('/') + 1);

const isPassive = (p) => DOC_EXT.has(ext(p)) || IMAGE_EXT.has(ext(p));
const isShell = (p) => ['.sh', '.bash'].includes(ext(p));
const isCiWorkflow = (p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) || base(p) === '.gitlab-ci.yml';
const isConfig = (p) => {
  const b = base(p);
  return CONFIG_EXT.has(ext(p)) || b === 'Dockerfile' || b.startsWith('Dockerfile.') || b === '.env' || b.startsWith('.env.') ||
    b === 'package.json' || b === 'go.mod' || b === 'go.sum';
};
const sensitiveToken = (p) => p.toLowerCase().split(/[^a-z0-9]+/).find((t) => SENSITIVE_TOKENS.has(t));

const RANK = { passive: 0, medium: 1, high: 2 };

async function diffArgs(cwd, { baseRef: rawRef, committedOnly }) {
  const baseRef = rawRef === undefined ? undefined : await resolveCommit(cwd, rawRef);
  const hasHead = (await gitOrNull(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null;
  if (committedOnly) {
    if (!hasHead) return [EMPTY_TREE, EMPTY_TREE];
    const from = baseRef ?? ((await gitOrNull(cwd, ['rev-parse', '--verify', '-q', 'HEAD~1'])) ? 'HEAD~1' : EMPTY_TREE);
    return [from, 'HEAD'];
  }
  return [baseRef ?? (hasHead ? 'HEAD' : EMPTY_TREE)];
}

/**
 * Classify a change set as passive / medium / high review risk.
 * Candidate: tracked changes (committed range with committedOnly, else base..working tree).
 * Untracked files are not part of the candidate.
 */
export async function assess({ cwd, baseRef, committedOnly = false } = {}) {
  const range = await diffArgs(cwd, { baseRef, committedOnly });
  const common = ['diff', '--no-renames', '--no-color', ...range];
  const tail = ['--']; // end of revisions: nothing after this is a ref or option
  const [numstat, summary, patch] = await Promise.all([
    git(cwd, [...common, '--numstat', ...tail]),
    git(cwd, [...common, '--summary', ...tail]),
    git(cwd, [...common, '-U0', ...tail]),
  ]);

  const paths = [];
  let changedLines = 0;
  for (const line of numstat.split('\n')) {
    const m = /^(\S+)\t(\S+)\t(.+)$/.exec(line);
    if (!m) continue;
    paths.push(m[3]);
    if (m[1] !== '-') changedLines += Number(m[1]) + Number(m[2]);
  }

  const reasons = [];
  const add = (code, path, detail) => reasons.push({ code, path, detail });

  const modeRe = /^(?: create mode (\d+) (.+)| mode change (\d+) => (\d+) (.+))$/;
  for (const line of summary.split('\n')) {
    const m = modeRe.exec(line);
    if (!m) continue;
    if (m[1] !== undefined && m[1] === '100755') add('executable_mode', m[2], 'new executable file');
    else if (m[3] !== undefined && (m[3] === '100755') !== (m[4] === '100755')) add('executable_mode', m[5], `mode ${m[3]} => ${m[4]}`);
  }

  // Added lines with process-boundary sinks, in non-passive files only.
  let current = null;
  const sinkSeen = new Set();
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) {
      current = line.startsWith('+++ b/') ? line.slice(6) : null;
    } else if (current && line.startsWith('+') && !isPassive(current) && !sinkSeen.has(current)) {
      const m = SINK_RE.exec(line.slice(1));
      if (m) {
        sinkSeen.add(current);
        add('process_boundary', current, m[0]);
      }
    }
  }

  for (const p of paths) {
    if (isPassive(p)) continue;
    const token = sensitiveToken(p);
    if (token) add('sensitive_path', p, token);
    if (isShell(p)) add('shell_source', p, 'shell script');
    if (isCiWorkflow(p)) add('ci_workflow', p, 'CI workflow');
  }

  let risk = reasons.length > 0 ? 'high' : 'medium';
  if (reasons.length === 0) {
    const active = paths.filter((p) => !isPassive(p));
    if (active.length === 0) {
      risk = 'passive';
      add('passive_content', undefined, paths.length === 0 ? 'no changes' : 'documentation and images only');
    } else {
      for (const p of active) add(isConfig(p) ? 'configuration_change' : 'executable_change', p, undefined);
    }
  }
  if (RANK[risk] === undefined) risk = 'high';

  let reviewDue = false;
  let reviewDueReason;
  if (risk === 'high') {
    reviewDue = true;
    reviewDueReason = 'high_risk';
  } else if (risk === 'medium' && changedLines >= SLICE_BUDGET) {
    reviewDue = true;
    reviewDueReason = 'slice_budget_reached';
  } else {
    reviewDueReason = risk === 'passive' ? 'passive' : 'under_budget';
  }

  return {
    risk,
    reasons: reasons.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))),
    changed_paths: paths,
    changed_lines: changedLines,
    review_due: reviewDue,
    review_due_reason: reviewDueReason,
  };
}
