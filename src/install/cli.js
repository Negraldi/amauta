import { parseArgs } from 'node:util';
import { install, uninstall, status } from './installer.js';

const OPTIONS = {
  'claude-home': { type: 'string' },
  'claude-json': { type: 'string' },
  'state-dir': { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  persona: { type: 'string' },
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
  io.stdout.write(`  claude home: ${s.state.claude_home}\n  rdd mode: ${s.state.rdd_mode}\n`);
  return s.ok ? 0 : 1;
}

export function registerInstallCommands(commands) {
  commands.set('install', { summary: 'Install gentle-lite into Claude Code (--claude-home --claude-json --state-dir --dry-run --force --persona)', run: guard(runInstall) });
  commands.set('uninstall', { summary: 'Remove everything gentle-lite installed, keeping your own content', run: guard(runUninstall) });
  commands.set('status', { summary: 'Show what is installed and what is missing', run: guard(runStatus) });
}
