import { packageVersion } from './version.js';
import { runHook } from './hooks/index.js';
import { runPythonModule } from './install/python.js';
import { registerInstallCommands } from './install/cli.js';
import { registerReviewCommands } from './review/cli.js';
import { registerPortalCommands } from './portal/cli.js';
import { registerCodegraphCommands } from './codegraph/index.js';
import { registerGraphifyCommands } from './graphify/hook.js';
import { registerMermaidCommands } from './mermaid/cli.js';
import { registerCheckCommands } from './checks/cli.js';

/**
 * Subcommand registry. Each entry: { summary, run(args, io) -> exit code | Promise }.
 * Later work units register their commands here.
 */
export const commands = new Map();

commands.set('version', {
  summary: 'Print the amauta version',
  run: (_args, io) => {
    io.stdout.write(`${packageVersion()}\n`);
    return 0;
  },
});

export function helpText() {
  const rows = [...commands.entries()]
    .map(([name, c]) => `  ${name.padEnd(16)}${c.summary}`)
    .join('\n');
  return `Usage: amauta <command> [options]\n\nCommands:\n${rows}\n\nRun \`amauta --help\` to show this text.\n`;
}

commands.set('hook', {
  summary: 'Hook entrypoint used by Claude Code and Codex (skill-registry, review-stop, graphify-connect)',
  run: (args, io) => runHook(args[0], io, args.slice(1)),
});

commands.set('py', {
  summary: 'Run one of amauta\'s Python modules (amauta.*) with the interpreter install chose; used by skills',
  run: (args, io) => {
    if (!/^amauta(\.[A-Za-z_][\w]*)+$/.test(args[0] ?? '')) {
      io.stderr.write('amauta py: only amauta.* modules can be run this way\n');
      return 2;
    }
    return runPythonModule(args[0], args.slice(1), io);
  },
});

commands.set('privacy', {
  summary: 'Local privacy tools: scan, redact or pseudonymize files (counts and columns, never values)',
  run: (args, io) => runPythonModule('amauta.privacy', args, io),
});

commands.set('sdd', {
  summary: 'Run the SDD status module (status [change] --cwd DIR --json, continue [change]); used by the SDD skills',
  run: (args, io) => runPythonModule('amauta.sdd', args, io),
});

registerInstallCommands(commands);
registerReviewCommands(commands);
registerPortalCommands(commands);
registerCodegraphCommands(commands);
registerGraphifyCommands(commands);
registerMermaidCommands(commands);
registerCheckCommands(commands);

export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    io.stdout.write(helpText());
    return 0;
  }
  if (name === '--version' || name === '-v') {
    io.stdout.write(`${packageVersion()}\n`);
    return 0;
  }
  const cmd = commands.get(name);
  if (!cmd) {
    io.stderr.write(`amauta: unknown command: ${name}\nRun \`amauta --help\` for usage.\n`);
    return 1;
  }
  return (await cmd.run(rest, io)) ?? 0;
}
