/**
 * Number fidelity (plan D11, ADR 0008): every number a deliverable shows must exist in the approved results at the
 * precision shown. Approved results are the files under `odd/contracts/<feature>/`; deliverables are the text files
 * under `odd/deliverables/<feature>/` (binary files such as PPTX or PDF are listed as not checked). A share shown as a
 * percentage matches a fraction (41.2% matches 0.4123). Years, ISO dates, versions and list markers are not numbers.
 * Mechanical and read-only: it cannot tell whether a number is used for the right claim; the lens reads that.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const TEXT = new Set(['.md', '.markdown', '.txt', '.html', '.htm', '.csv', '.tsv', '.json', '.svg', '.mmd']);
const NUMBER = /(?<![\w.])(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%?)(?![\w])/g;

export async function listFiles(dir) {
  const out = [];
  const walk = async (d) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  await walk(dir);
  return out;
}

/** Numbers in a text: [{ text, value, decimals, percent, line }]. */
export function extractNumbers(text) {
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/^\s*\d+[.)]\s/, ' ').replace(/\bv\d+(?:\.\d+)+/gi, ' ');
    for (const m of line.matchAll(NUMBER)) {
      const [, sign, whole, frac = '', pct] = m;
      const plain = !sign && !frac && !pct && !whole.includes(',');
      if (plain && /^\d{4}$/.test(whole) && Number(whole) >= 1900 && Number(whole) <= 2100) continue; // a year
      const value = Number(`${sign}${whole.replaceAll(',', '')}${frac ? `.${frac}` : ''}`);
      out.push({ text: m[0], value, decimals: frac.length, percent: pct === '%', line: i + 1 });
    }
  });
  return out;
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

function matches(n, approved) {
  return approved.some((a) => round(a, n.decimals) === n.value || (n.percent && round(a * 100, n.decimals) === n.value));
}

/** A file's numbers; in CSV and TSV a comma or tab separates cells, never thousands. */
async function numbersIn(file) {
  const text = await readFile(file, 'utf8');
  return extractNumbers(/\.(csv|tsv)$/i.test(file) ? text.replace(/[,\t;]/g, ' ') : text);
}

export async function checkNumbers(root, feature) {
  const approved = [];
  for (const f of await listFiles(path.join(root, 'odd', 'contracts', feature))) {
    if (TEXT.has(path.extname(f).toLowerCase())) approved.push(...(await numbersIn(f)).map((n) => n.value));
  }
  const unmatched = [];
  const skipped = [];
  let checked = 0;
  for (const f of await listFiles(path.join(root, 'odd', 'deliverables', feature))) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    if (!TEXT.has(path.extname(f).toLowerCase())) { skipped.push(rel); continue; }
    for (const n of await numbersIn(f)) {
      checked++;
      if (!matches(n, approved)) unmatched.push({ file: rel, line: n.line, text: n.text });
    }
  }
  return { checked, unmatched, skipped };
}
