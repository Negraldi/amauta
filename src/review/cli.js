import path from 'node:path';
import { parseArgs } from 'node:util';
import { assess } from './assess.js';
import { modeStatus, setMode } from './mode.js';
import { checkNumbers } from './numbers.js';
import { buildPack } from './pack.js';
import { repoRoot } from '../util/git.js';
import { collectSkills, refreshRegistry } from '../registry/skill-registry.js';
import { resolveTargets } from '../install/paths.js';

const COMMON = {
  cwd: { type: 'string' },
  'state-dir': { type: 'string' },
  'claude-home': { type: 'string' },
};

const cwdOf = (v) => path.resolve(v.cwd ?? process.cwd());

function guard(spec, fn) {
  return async (args, io) => {
    try {
      const { values, positionals } = parseArgs({ args, options: { ...COMMON, ...spec }, allowPositionals: true, strict: true });
      return (await fn(values, positionals, io)) ?? 0;
    } catch (err) {
      io.stderr.write(`amauta: ${err.message}\n`);
      return 1;
    }
  };
}

const targetsOf = (v) => resolveTargets({ claudeHome: v['claude-home'], stateDir: v['state-dir'] });

const registry = guard(
  { quiet: { type: 'boolean' }, 'no-gitignore': { type: 'boolean' }, force: { type: 'boolean' } },
  async (v, [sub], io) => {
    const cwd = cwdOf(v);
    const { claudeHome } = targetsOf(v);
    if (sub === 'refresh') {
      const r = await refreshRegistry({ cwd, claudeHome, gitignore: !v['no-gitignore'], force: v.force });
      if (!v.quiet) {
        if (r.status === 'skipped') io.stdout.write(`Skill registry skipped: ${r.reason}\n`);
        else if (r.status === 'cache-hit') io.stdout.write(`Skill registry up to date (cache-hit): ${r.path}\n`);
        else io.stdout.write(`Skill registry refreshed (${r.count} skills): ${r.path}\n`);
      }
      return 0;
    }
    if (sub === 'list') {
      for (const s of (await collectSkills(cwd, claudeHome)).skills) io.stdout.write(`${s.name}\t${s.scope}\t${s.path}\n`);
      return 0;
    }
    throw new Error('usage: amauta skill-registry <refresh|list> [--cwd] [--quiet] [--no-gitignore] [--force]');
  },
);

const reviewAssess = async (v, io) => {
  const r = await assess({ cwd: cwdOf(v), baseRef: v['base-ref'], committedOnly: v['committed-only'] });
  if (v.json) io.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  else {
    io.stdout.write(`risk: ${r.risk}\nreview due: ${r.review_due} (${r.review_due_reason})\nchanged: ${r.changed_paths.length} path(s), ${r.changed_lines} line(s)\n`);
    for (const x of r.reasons) io.stdout.write(`  ${x.code}${x.path ? ` ${x.path}` : ''}${x.detail ? ` (${x.detail})` : ''}\n`);
  }
};

const reviewMode = async (v, [action], io) => {
  const t = targetsOf(v);
  const opts = { scope: v.scope ?? 'global', cwd: cwdOf(v), stateDir: t.stateDir };
  if (action === 'status') {
    const s = await modeStatus(opts);
    io.stdout.write(`receipt-driven development: ${s.effective} (decided by ${s.source})\n  global: ${s.global}\n  clone-local: ${s.clone}\n`);
    return;
  }
  if (action !== 'enable' && action !== 'disable') throw new Error('usage: amauta review mode <enable|disable|status> [--scope global|clone] [--cwd]');
  const s = await setMode(action === 'enable' ? 'on' : 'off', opts);
  io.stdout.write(`receipt-driven development: ${s.effective} (decided by ${s.source})\n`);
};

// The lenses (plan D11): a pack for a fresh reviewer, and the number-fidelity check on its own.
const reviewPack = async (v, io) => {
  const { file, outside, unmatched } = await buildPack({ cwd: cwdOf(v), feature: v.feature, kind: v.kind ?? 'analytical' });
  io.stdout.write(`${file}\n${unmatched.length} unmatched number${unmatched.length === 1 ? '' : 's'}`
    + (outside.length ? `, ${outside.length} changed path${outside.length === 1 ? '' : 's'} outside the deliverables folder` : '') + '\n');
};

const reviewNumbers = async (v, io) => {
  const root = await repoRoot(cwdOf(v));
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.feature ?? '') && !v.feature.includes('..');
  if (!root || !valid) throw new Error('usage: amauta review numbers --feature NAME [--cwd DIR]');
  const r = await checkNumbers(root, v.feature);
  for (const u of r.unmatched) io.stdout.write(`${u.file}:${u.line}: ${u.text} not in the approved results\n`);
  for (const f of r.skipped) io.stdout.write(`${f}: not checked (binary)\n`);
  io.stdout.write(`${r.checked} checked, ${r.unmatched.length} unmatched\n`);
  return r.unmatched.length ? 1 : 0;
};

const review = guard(
  { 'base-ref': { type: 'string' }, 'committed-only': { type: 'boolean' }, json: { type: 'boolean' }, scope: { type: 'string' },
    feature: { type: 'string' }, kind: { type: 'string' } },
  async (v, [sub, action], io) => {
    if (sub === 'assess') return reviewAssess(v, io);
    if (sub === 'mode') return reviewMode(v, [action], io);
    if (sub === 'pack') return reviewPack(v, io);
    if (sub === 'numbers') return reviewNumbers(v, io);
    throw new Error('usage: amauta review <assess|mode|pack|numbers>');
  },
);

export function registerReviewCommands(commands) {
  commands.set('skill-registry', { summary: 'Index available skills (refresh|list)', run: registry });
  commands.set('review', { summary: 'Assess review risk (assess) or switch receipt-driven development (mode)', run: review });
}
