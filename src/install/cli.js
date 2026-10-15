import { parseArgs } from 'node:util';
import { install, uninstall, status } from './installer.js';

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
  'with-context7': { type: 'boolean', default: false },
};

function parse(args) {
  const { values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true });
  return {
    claudeHome: values['claude-home'],
    claudeJson: values['claude-json'],
    stateDir: values['state-dir'],
    dryRun: values['dry-run'],
    force: values.force,
    persona: values.persona,
    telemetry: !values['no-telemetry'],
    withSdd: values['with-sdd'] ? true : undefined, // absent keeps what a previous install chose
    withRea: values['with-rea'] ? true : undefined,
    withContext7: values['with-context7'] ? true : undefined,
  };
}

const guard = (fn) => async (args, io) => {
  let opts;
  try {
    opts = parse(args);
  } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
  try {
    return await fn(opts, io);
  } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
};

async function runInstall(opts, io) {
  const r = await install(opts);
  if (r.dryRun) {
    io.stdout.write(`gentle-lite: dry run, ${r.files.length} file(s) would be written\n`);
    for (const f of r.files) io.stdout.write(`  ${f}\n`);
  } else if (r.changed) {
    io.stdout.write(`gentle-lite: installed (${r.files.length} file(s) written)\n`);
    if (r.backup) io.stdout.write(`  backup: ${r.backup}\n`);
  } else {
    io.stdout.write('gentle-lite: already installed, nothing to change\n');
  }
  for (const s of r.skipped) io.stdout.write(`  kept your edited file (use --force to overwrite): ${s}\n`);
  return 0;
}

async function runUninstall(opts, io) {
  const r = await uninstall(opts);
  io.stdout.write(r.changed ? `gentle-lite: uninstalled\n${r.backup ? `  backup: ${r.backup}\n` : ''}` : 'gentle-lite: nothing to uninstall\n');
  for (const k of r.kept) io.stdout.write(`  kept (modified by you): ${k}\n`);
  return 0;
}

async function runStatus(opts, io) {
  const s = await status(opts);
  if (!s.installed) {
    io.stdout.write('gentle-lite: not installed\n');
    return 1;
  }
  const bad = s.items.filter((i) => !i.ok);
  io.stdout.write(`gentle-lite ${s.state.version}: ${s.ok ? 'installed' : 'installed with problems'} (${s.items.length - bad.length}/${s.items.length} ok)\n`);
  for (const i of bad) io.stdout.write(`  [problem] ${i.name}: ${i.detail}\n`);
  for (const n of s.notes ?? []) io.stdout.write(`  [optional] ${n.name}: ${n.detail}\n`);
  io.stdout.write(`  CLAUDE.md: ${s.sizes.total} chars (budget ${s.sizes.budget})\n`);
  for (const b of s.sizes.blocks) io.stdout.write(`    ${b.id.padEnd(20)}${b.chars} chars, ${b.lines} lines\n`);
  const perm = s.permissions;
  io.stdout.write(`  permissions: ${perm.ask.length} ask, ${perm.deny.length} deny added by gentle-lite\n`);
  for (const kind of ['ask', 'deny']) for (const r of perm[kind]) io.stdout.write(`    ${kind.padEnd(5)}${r.rule}${r.present ? '' : '  [missing]'}\n`);
  if (perm.legacy_deny.length > 0) io.stdout.write(`  kept from an older install (not managed): ${perm.legacy_deny.length} deny rule(s): ${perm.legacy_deny.join(', ')}\n`);
  for (const w of s.warnings) io.stdout.write(`  [warning] ${w}\n`);
  io.stdout.write(`  claude home: ${s.state.claude_home}\n  rdd mode: ${s.state.rdd_mode}\n`);
  return s.ok ? 0 : 1;
}

export function registerInstallCommands(commands) {
  commands.set('install', { summary: 'Install gentle-lite into Claude Code (--claude-home --claude-json --state-dir --dry-run --force --persona --no-telemetry --with-sdd --with-rea --with-context7)', run: guard(runInstall) });
  commands.set('uninstall', { summary: 'Remove everything gentle-lite installed, keeping your own content', run: guard(runUninstall) });
  commands.set('status', { summary: 'Show what is installed and what is missing', run: guard(runStatus) });
}
