import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function packageVersion() {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

/**
 * Subcommand registry. Each entry: { summary, run(args, io) -> exit code | Promise }.
 * Later work units register their commands here.
 */
export const commands = new Map();

commands.set('version', {
  summary: 'Print the gentle-lite version',
  run: (_args, io) => {
    io.stdout.write(`${packageVersion()}\n`);
    return 0;
  },
});

export function helpText() {
  const rows = [...commands.entries()]
    .map(([name, c]) => `  ${name.padEnd(14)}${c.summary}`)
    .join('\n');
  return `Usage: gentle-lite <command> [options]\n\nCommands:\n${rows}\n\nRun \`gentle-lite --help\` to show this text.\n`;
}

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
    io.stderr.write(`gentle-lite: unknown command: ${name}\nRun \`gentle-lite --help\` for usage.\n`);
    return 1;
  }
  return (await cmd.run(rest, io)) ?? 0;
}
