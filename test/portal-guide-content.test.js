// The guide's content (odd/tasks/portal-guide.md): the same pages in English and Spanish, each with the five sections
// the user asked for, in order, at least one diagram, every Mermaid fence accepted by the vendored parser, and links
// only to guide pages that exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMarkdown, extractFences } from '../src/mermaid/check.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'python', 'amauta', 'portal', 'guide');
const SECTIONS = {
  en: ['What it is made of', 'How the parts relate', 'How you use it', 'Scripts and commands', 'How it works'],
  es: ['De qué está hecho', 'Cómo se relacionan las partes', 'Flujo de uso y de trabajo', 'Scripts y comandos', 'Cómo trabaja'],
};

async function slugs() {
  const src = await readFile(path.join(root, 'python', 'amauta', 'portal', 'guide.py'), 'utf8');
  return [.../SLUGS = \(([^)]*)\)/s.exec(src)[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

test('both languages have exactly the guide pages', async () => {
  const want = (await slugs()).map((s) => `${s}.md`).sort();
  for (const lang of Object.keys(SECTIONS)) assert.deepEqual((await readdir(path.join(dir, lang))).sort(), want, lang);
});

test('every page has a title, the five sections in order and at least one diagram', async () => {
  for (const slug of await slugs()) {
    for (const [lang, names] of Object.entries(SECTIONS)) {
      const md = await readFile(path.join(dir, lang, `${slug}.md`), 'utf8');
      assert.match(md, /^# \S/, `${lang}/${slug}: title`);
      const h2 = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
      assert.deepEqual(h2.filter((x) => names.includes(x)), names, `${lang}/${slug}: sections`);
      assert.ok(extractFences(md).length >= 1, `${lang}/${slug}: a diagram`);
      assert.ok(md.length > 2500, `${lang}/${slug}: substance (${md.length} chars)`);
    }
  }
});

test('every diagram parses and every guide link points at a page', async () => {
  const known = new Set(await slugs());
  for (const lang of Object.keys(SECTIONS)) {
    for (const slug of known) {
      const md = await readFile(path.join(dir, lang, `${slug}.md`), 'utf8');
      const problems = (await checkMarkdown(md)).filter((r) => !r.ok);
      assert.deepEqual(problems, [], `${lang}/${slug}: ${JSON.stringify(problems).slice(0, 300)}`);
      for (const m of md.matchAll(/\[\[guide:([^|\]]+)/g)) assert.ok(known.has(m[1].trim()), `${lang}/${slug} links to ${m[1]}`);
    }
  }
});
