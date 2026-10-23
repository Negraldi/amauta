import { parseArgs } from 'node:util';
import { install, uninstall, status, restore } from './installer.js';
import { runUpgrade } from './upgrade.js';
import { computeParity, parityLines } from './parity.js';
import { installCodex, parseRuntime, selectRuntimes, statusCodex, syncCodex, uninstallCodex } from './codex.js';

const OPTIONS = {
  'claude-home': { type: 'string' },
  'claude-json': { type: 'string' },
  'state-dir': { type: 'string' },
  'codex-home': { type: 'string' },
  'codex-skills-dir': { type: 'string' },
  runtime: { type: 'string' }, // claude | codex | both (default: both when a Codex home exists)
  'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  persona: { type: 'string' },
  'no-telemetry': { type: 'boolean', default: false },
  'no-mirror-mcp': { type: 'boolean', default: false }, // Codex: do not copy the other Claude MCP servers
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
    codexHome: values['codex-home'],
    codexSkillsDir: values['codex-skills-dir'],
    runtime: parseRuntime(values.runtime),
    dryRun: values['dry-run'],
    force: values.force,
    persona: values.persona,
    telemetry: !values['no-telemetry'],
    mirrorMcp: values['no-mirror-mcp'] ? false : undefined,
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

const header = (io, runtime, show) => {
  if (show) io.stdout.write(`runtime ${runtime}\n`);
};

export function printMcpSync(m, io) {
  if (!m) return;
  if (m.mirrored.length > 0) io.stdout.write(`  mcp synced Claude -> Codex: ${m.mirrored.join(', ')}\n`);
  if (m.toClaude.length > 0) io.stdout.write(`  mcp synced Codex -> Claude: ${m.toClaude.join(', ')}\n`);
  if (m.removed.length > 0) io.stdout.write(`  mcp removed: ${m.removed.join(', ')}\n`);
  for (const u of m.unsupported) io.stdout.write(`  mcp not synced: ${u.name} (${u.reason})\n`);
  for (const n of m.conflicts) io.stdout.write(`  mcp conflict, changed differently in both runtimes (left as is): ${n}\n`);
  if (m.unreadable) io.stdout.write(`  mcp sync skipped: could not read ${m.unreadable}\n`);
}

function printInstallSummary(r, io, subject) {
  if (r.dryRun) {
    io.stdout.write(`amauta: dry run, ${r.files.length} file(s) would be written${subject}\n`);
    for (const f of r.files) io.stdout.write(`  ${f}\n`);
    for (const f of r.removed) io.stdout.write(`  remove ${f}\n`);
  } else if (r.changed) {
    io.stdout.write(`amauta: installed${subject} (${r.files.length} file(s) written)\n`);
    if (r.backup) io.stdout.write(`  backup: ${r.backup}\n`);
  } else {
    io.stdout.write('amauta: already installed, nothing to change\n');
  }
  for (const l of r.legacy ?? []) io.stdout.write(`  replaced legacy amauta entry: ${l}\n`);
  for (const s of r.skipped) io.stdout.write(`  kept your edited file (use --force to overwrite): ${s}\n`);
}

function printEngine(eng, io) {
  if (eng?.engine === 'failed') {
    io.stderr.write(`amauta: impeccable engine not installed: ${eng.detail}\n  the skill itself is installed (its bundled detector needs no npm); rerun \`amauta install\` to retry the engine\n`);
  } else if (eng) io.stdout.write(`amauta: impeccable engine ${eng.version} ${eng.engine === 'would-install' ? 'would be installed with npm' : eng.engine}\n`);
}

async function runInstall(opts, io) {
  const { runtimes } = await selectRuntimes(opts);
  const multi = !(runtimes.length === 1 && runtimes[0] === 'claude');
  const r = runtimes.includes('claude') ? await install(opts) : null;
  const c = runtimes.includes('codex') ? await installCodex(opts) : null;
  const failed = (r?.impeccable ?? c?.impeccable)?.engine === 'failed' ? 1 : 0;
  if (opts.json) {
    io.stdout.write(`${JSON.stringify({ ...(r ?? {}), ...(c ? { codex: c } : {}) })}\n`);
    return failed;
  }
  if (r) {
    header(io, 'claude', multi);
    printInstallSummary(r, io, '');
    printEngine(r.impeccable, io);
  }
  if (c) {
    header(io, 'codex', multi);
    printInstallSummary(c, io, ' into Codex');
    printMcpSync(c.mirror, io);
    if (!r) printEngine(c.impeccable, io); // one shared engine: reported once, under the first runtime that prepared it
  }
  return failed;
}

async function runSync(opts, io) {
  const r = await syncCodex(opts);
  if (opts.json) io.stdout.write(`${JSON.stringify(r)}\n`);
  else if (!r.synced) io.stdout.write('amauta: no Codex install to sync (run: amauta install --runtime codex)\n');
  else {
    io.stdout.write(r.dryRun ? `amauta: dry run, ${r.files.length} file(s) would change\n` : r.changed ? `amauta: synced (${r.files.length} file(s) written)\n` : 'amauta: already in sync\n');
    for (const f of r.files) io.stdout.write(`  ${f}\n`);
    printMcpSync(r.mirror, io);
    for (const n of r.personal?.conflicts ?? []) io.stdout.write(`  skill conflict, a real directory of that name exists in both runtimes: ${n}\n`);
  }
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
  const { runtimes } = await selectRuntimes(opts);
  const multi = !(runtimes.length === 1 && runtimes[0] === 'claude');
  for (const runtime of runtimes) {
    header(io, runtime, multi);
    const r = runtime === 'claude' ? await uninstall(opts) : await uninstallCodex(opts);
    io.stdout.write(r.changed ? `amauta: uninstalled\n${r.backup ? `  backup: ${r.backup}\n` : ''}` : 'amauta: nothing to uninstall\n');
    for (const k of r.kept) io.stdout.write(`  kept (modified by you): ${k}\n`);
  }
  return 0;
}

async function printClaudeStatus(opts, io) {
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


async function printCodexStatus(opts, io) {
  const s = await statusCodex(opts);
  if (!s.installed) {
    io.stdout.write('amauta: not installed\n');
    return false;
  }
  const bad = s.items.filter((i) => !i.ok);
  io.stdout.write(`amauta ${s.state.version}: ${s.ok ? 'installed' : 'installed with problems'} (${s.items.length - bad.length}/${s.items.length} ok)\n`);
  for (const i of bad) io.stdout.write(`  [problem] ${i.name}: ${i.detail}\n`);
  for (const n of s.notes) io.stdout.write(`  [optional] ${n.name}: ${n.detail}\n`);
  io.stdout.write(`  codex home: ${s.state.codex_home}\n  skills dir: ${s.state.codex_skills_dir}\n`);
  return s.ok;
}

async function runStatus(opts, io) {
  const { runtimes, explicit } = await selectRuntimes(opts);
  const both = runtimes.length === 2;
  const parity = both ? await computeParity(opts) : { present: false };
  if (opts.json) {
    const claude = runtimes.includes('claude') ? await status(opts) : { installed: false };
    const codex = runtimes.includes('codex') ? await statusCodex(opts) : null;
    io.stdout.write(`${JSON.stringify({ ...claude, ...(codex ? { codex } : {}), parity })}\n`);
    return claude.installed && claude.ok ? 0 : runtimes.includes('claude') ? 1 : codex?.ok ? 0 : 1;
  }
  if (runtimes.length === 1 && runtimes[0] === 'claude') return printClaudeStatus(opts, io);
  let code = 0;
  for (const runtime of runtimes) {
    header(io, runtime, true);
    if (runtime === 'claude') {
      if ((await printClaudeStatus(opts, io)) !== 0) code = 1;
    } else if (!(await printCodexStatus(opts, io)) && explicit) code = 1; // by default a Codex that was never installed is informational
  }
  if (parity.present) {
    const lines = parityLines(parity);
    io.stdout.write(lines.length === 0 ? 'parity: Claude and Codex have the same MCP servers, skills and instruction blocks\n' : 'parity (informational, does not change the exit code):\n');
    for (const l of lines) io.stdout.write(`  ${l}\n`);
  }
  return code;
}

export function registerInstallCommands(commands) {
  commands.set('install', { summary: 'Install amauta into Claude Code and/or Codex (--runtime claude|codex|both, default both when ~/.codex exists; --claude-home --claude-json --codex-home --codex-skills-dir --state-dir --dry-run --force --persona --no-telemetry --no-mirror-mcp --with-sdd --with-rea --with-context7 --with-impeccable --with-archify, --without-<module> turns one off, --review-mode on|off, --json)', run: guard(runInstall) });
  commands.set('sync', { summary: 'Sync Claude Code and Codex now: MCP servers both ways (3-way merge), skill links, Codex copies (--dry-run, --json, --no-mirror-mcp, same dirs as install)', run: guard(runSync) });
  commands.set('restore', { summary: 'Restore an installer backup by id, Claude or Codex files (--backup <id> --claude-home --claude-json --codex-home --codex-skills-dir --state-dir --json)', run: guard(runRestore) });
  commands.set('upgrade', { summary: 'Update this install to the latest release tag (--to <tag> for another, --dry-run, --yes, --claude-home --claude-json --state-dir)', run: (args, io) => runUpgrade(args, io) });
  commands.set('uninstall', { summary: 'Remove everything amauta installed, keeping your own content (--runtime claude|codex|both)', run: guard(runUninstall) });
  commands.set('status', { summary: 'Show what is installed and what is missing, one section per runtime (--runtime claude|codex|both, --deep also probes the graphify SQL extractor)', run: guard(runStatus) });
}
