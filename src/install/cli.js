import { parseArgs } from 'node:util';
import { install, uninstall, status, restore } from './installer.js';
import { runUpgrade } from './upgrade.js';

const OPTIONS = {
  'claude-home': { type: 'string' },
  'claude-json': { type: 'string' },
  'state-dir': { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  persona: { type: 'string' },
  'no-telemetry': { type: 'boolean', default: false },
  'with-sdd': { type: 'boolean', default: false },
  'with-rea': { type: 'boolean', default: false },
  'with-impeccable': { type: 'boolean', default: false },
  'with-archify': { type: 'boolean', default: false },
  'with-context7': { type: 'boolean', default: false },
  'without-sdd': { type: 'boolean', default: false },
  'without-rea': { type: 'boolean', default: false },
  'without-impeccable': { type: 'boolean', default: false },
  'without-archify': { type: 'boolean', default: false },
  'without-context7': { type: 'boolean', default: false },
  'review-mode': { type: 'string' },
  json: { type: 'boolean', default: false }, // install and restore: print the result as one JSON object
  backup: { type: 'string' }, // restore only: the backup id
  deep: { type: 'boolean', default: false }, // status only: also probe the graphify [sql] extractor
};

function parse(args) {
  const { values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true });
  // true = --with-x, false = --without-x, undefined = keep what a previous install chose
  const tri = (name) => {
    if (values[`with-${name}`] && values[`without-${name}`]) throw new Error(`--with-${name} and --without-${name} cannot be combined`);
    return values[`with-${name}`] ? true : values[`without-${name}`] ? false : undefined;
  };
  const reviewMode = values['review-mode'];
  if (reviewMode !== undefined && reviewMode !== 'on' && reviewMode !== 'off') throw new Error(`--review-mode must be on or off (got ${reviewMode})`);
  return {
    claudeHome: values['claude-home'],
    claudeJson: values['claude-json'],
    stateDir: values['state-dir'],
    dryRun: values['dry-run'],
    force: values.force,
    persona: values.persona,
    telemetry: !values['no-telemetry'],
    withSdd: tri('sdd'),
    withRea: tri('rea'),
    withImpeccable: tri('impeccable'),
    withArchify: tri('archify'),
    withContext7: tri('context7'),
    rddMode: reviewMode,
    json: values.json,
    backup: values.backup,
    deep: values.deep,
  };
}

const guard = (fn) => async (args, io) => {
  let opts;
  try {
    opts = parse(args);
  } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
  try {
    return await fn(opts, io);
  } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
};

async function runInstall(opts, io) {
  const r = await install(opts);
  if (opts.json) {
    io.stdout.write(`${JSON.stringify(r)}\n`);
    return r.impeccable?.engine === 'failed' ? 1 : 0;
  }
  if (r.dryRun) {
    io.stdout.write(`amauta: dry run, ${r.files.length} file(s) would be written\n`);
    for (const f of r.files) io.stdout.write(`  ${f}\n`);
    for (const f of r.removed) io.stdout.write(`  remove ${f}\n`);
  } else if (r.changed) {
    io.stdout.write(`amauta: installed (${r.files.length} file(s) written)\n`);
    if (r.backup) io.stdout.write(`  backup: ${r.backup}\n`);
  } else {
    io.stdout.write('amauta: already installed, nothing to change\n');
  }
  for (const s of r.skipped) io.stdout.write(`  kept your edited file (use --force to overwrite): ${s}\n`);
  const eng = r.impeccable;
  if (eng?.engine === 'failed') {
    io.stderr.write(`amauta: impeccable engine not installed: ${eng.detail}\n  the skill itself is installed (its bundled detector needs no npm); rerun \`amauta install\` to retry the engine\n`);
    return 1;
  }
  if (eng) io.stdout.write(`amauta: impeccable engine ${eng.version} ${eng.engine === 'would-install' ? 'would be installed with npm' : eng.engine}\n`);
  return 0;
}

async function runRestore(opts, io) {
  const r = await restore(opts);
  if (opts.json) io.stdout.write(`${JSON.stringify(r)}\n`);
  else {
    io.stdout.write(`amauta: restored backup ${r.backup} (${r.restored.length} file(s))\n`);
    for (const f of r.restored) io.stdout.write(`  ${f}\n`);
  }
  return 0;
}

async function runUninstall(opts, io) {
  const r = await uninstall(opts);
  io.stdout.write(r.changed ? `amauta: uninstalled\n${r.backup ? `  backup: ${r.backup}\n` : ''}` : 'amauta: nothing to uninstall\n');
  for (const k of r.kept) io.stdout.write(`  kept (modified by you): ${k}\n`);
  return 0;
}

async function runStatus(opts, io) {
  const s = await status(opts);
  if (!s.installed) {
    io.stdout.write('amauta: not installed\n');
    return 1;
  }
  const bad = s.items.filter((i) => !i.ok);
  io.stdout.write(`amauta ${s.state.version}: ${s.ok ? 'installed' : 'installed with problems'} (${s.items.length - bad.length}/${s.items.length} ok)\n`);
  for (const i of bad) io.stdout.write(`  [problem] ${i.name}: ${i.detail}\n`);
  for (const n of s.notes ?? []) io.stdout.write(`  [optional] ${n.name}: ${n.detail}\n`);
  io.stdout.write(`  CLAUDE.md: ${s.sizes.total} chars (budget ${s.sizes.budget})\n`);
  for (const b of s.sizes.blocks) io.stdout.write(`    ${b.id.padEnd(20)}${b.chars} chars, ${b.lines} lines\n`);
  const perm = s.permissions;
  io.stdout.write(`  permissions: ${perm.ask.length} ask, ${perm.deny.length} deny added by amauta\n`);
  for (const kind of ['ask', 'deny']) for (const r of perm[kind]) io.stdout.write(`    ${kind.padEnd(5)}${r.rule}${r.present ? '' : '  [missing]'}\n`);
  if (perm.legacy_deny.length > 0) io.stdout.write(`  kept from an older install (not managed): ${perm.legacy_deny.length} deny rule(s): ${perm.legacy_deny.join(', ')}\n`);
  for (const w of s.warnings) io.stdout.write(`  [warning] ${w}\n`);
  io.stdout.write(`  claude home: ${s.state.claude_home}\n  rdd mode: ${s.state.rdd_mode}\n`);
  return s.ok ? 0 : 1;
}

export function registerInstallCommands(commands) {
  commands.set('install', { summary: 'Install amauta into Claude Code (--claude-home --claude-json --state-dir --dry-run --force --persona --no-telemetry --with-sdd --with-rea --with-context7 --with-impeccable --with-archify, --without-<module> turns one off, --review-mode on|off, --json)', run: guard(runInstall) });
  commands.set('restore', { summary: 'Restore an installer backup by id (--backup <id> --claude-home --claude-json --state-dir --json)', run: guard(runRestore) });
  commands.set('upgrade', { summary: 'Update this install to the latest release tag (--to <tag> for another, --dry-run, --yes, --claude-home --claude-json --state-dir)', run: (args, io) => runUpgrade(args, io) });
  commands.set('uninstall', { summary: 'Remove everything amauta installed, keeping your own content', run: guard(runUninstall) });
  commands.set('status', { summary: 'Show what is installed and what is missing (--deep also probes the graphify SQL extractor)', run: guard(runStatus) });
}
