/**
 * Checks the portal guide pages of one language (odd/tasks/portal-guide.md): title, the five sections in order, at
 * least one Mermaid diagram, every diagram accepted by the vendored parser, and links only to existing guide pages.
 * Usage: node scripts/dev/check-guide.mjs en|es. Exit 1 on a problem. Used while writing; the test covers both.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMarkdown, extractFences } from '../../src/mermaid/check.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECTIONS = {
  en: ['What it is made of', 'How the parts relate', 'How you use it', 'Scripts and commands', 'How it works'],
  es: ['De qué está hecho', 'Cómo se relacionan las partes', 'Flujo de uso y de trabajo', 'Scripts y comandos', 'Cómo trabaja'],
};
const lang = process.argv[2];
const src = await readFile(path.join(root, 'python', 'amauta', 'portal', 'guide.py'), 'utf8');
const slugs = [.../SLUGS = \(([^)]*)\)/s.exec(src)[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
let bad = 0;
for (const slug of slugs) {
  const md = await readFile(path.join(root, 'python', 'amauta', 'portal', 'guide', lang, `${slug}.md`), 'utf8');
  const h2 = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()).filter((x) => SECTIONS[lang].includes(x));
  const problems = [];
  if (!/^# \S/.test(md)) problems.push('no title');
  if (JSON.stringify(h2) !== JSON.stringify(SECTIONS[lang])) problems.push(`sections ${JSON.stringify(h2)}`);
  if (!extractFences(md).length) problems.push('no diagram');
  if (md.length <= 2500) problems.push(`short (${md.length})`);
  for (const r of (await checkMarkdown(md)).filter((x) => !x.ok)) problems.push(`diagram line ${r.line}: ${r.error}`);
  for (const m of md.matchAll(/\[\[guide:([^|\]]+)/g)) if (!slugs.includes(m[1].trim())) problems.push(`link to ${m[1]}`);
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${lang}/${slug}${problems.length ? ': ' + problems.join('; ') : ''}`);
  bad += problems.length;
}
process.exitCode = bad ? 1 : 0;
