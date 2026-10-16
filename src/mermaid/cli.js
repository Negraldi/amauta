import { readFile } from 'node:fs/promises';
import { checkMarkdown } from './check.js';

const USAGE = 'Usage: amauta mermaid check <file.md>...\n  Validates every ```mermaid fence with the vendored Mermaid parser (no browser). Exit 1 when any diagram is invalid.\n';

export function registerMermaidCommands(commands) {
  commands.set('mermaid', {
    summary: 'Validate mermaid fences in markdown files (mermaid check <file.md>...)',
    run: async (args, io) => {
      const [sub, ...files] = args;
      if (sub !== 'check' || files.length === 0) {
        io.stderr.write(USAGE);
        return 2;
      }
      let failed = 0;
      let total = 0;
      for (const file of files) {
        let text;
        try {
          text = await readFile(file, 'utf8');
        } catch (err) {
          io.stderr.write(`${file}: cannot read (${err.code ?? err.message})\n`);
          failed += 1;
          continue;
        }
        for (const r of await checkMarkdown(text)) {
          total += 1;
          if (r.ok) io.stdout.write(`${file}:${r.line}: ok (${r.type ?? 'diagram'})\n`);
          else {
            failed += 1;
            io.stderr.write(`${file}:${r.line}: ${r.error}\n`);
          }
        }
      }
      if (total === 0 && failed === 0) io.stdout.write('no mermaid fences found\n');
      return failed ? 1 : 0;
    },
  });
}
