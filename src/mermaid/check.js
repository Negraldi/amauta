import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const VENDORED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'amauta', 'portal', 'static', 'mermaid.min.js');

/** Fenced ```mermaid / ~~~mermaid blocks of a markdown text: [{ line, source }] (line = 1-based line of the opening fence). */
export function extractFences(markdown) {
  const out = [];
  const lines = String(markdown).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^( {0,3})(`{3,}|~{3,})\s*mermaid\b.*$/i.exec(lines[i]);
    if (!open) continue;
    const fence = open[2];
    const body = [];
    let j = i + 1;
    while (j < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[j])) body.push(lines[j++]);
    out.push({ line: i + 1, source: body.join('\n'), closed: j < lines.length });
    i = j;
  }
  return out;
}

let loaded = null;
/**
 * The vendored Mermaid build run in a bare `node:vm` context. `mermaid.parse` needs no DOM, so no jsdom or browser is involved
 * (rendering does need one; this only validates syntax).
 */
export function loadMermaid(file = VENDORED) {
  loaded ||= readFile(file, 'utf8').then((code) => {
    const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, performance });
    ctx.globalThis = ctx;
    ctx.self = ctx;
    // Without a DOM the bundled DOMPurify is a bare function (isSupported = false) that lacks addHook/sanitize, which Mermaid calls
    // while parsing any quoted label. Parsing only checks syntax, so identity stand-ins on this throwaway context's Function.prototype
    // are enough; nothing here is ever used to sanitize output (the portal renders with securityLevel "strict" in a real browser).
    vm.runInContext('Function.prototype.addHook = function () {}; Function.prototype.removeHook = function () {}; Function.prototype.sanitize = function (s) { return s; };', ctx);
    vm.runInContext(code, ctx, { filename: 'mermaid.min.js' });
    const m = ctx.mermaid?.default ?? ctx.mermaid;
    if (typeof m?.parse !== 'function') throw new Error('vendored mermaid did not expose parse()');
    return m;
  });
  return loaded;
}

/** Validate every mermaid fence of a markdown text: [{ line, ok, type?, error? }]. */
export async function checkMarkdown(markdown) {
  const fences = extractFences(markdown);
  if (!fences.length) return [];
  const mermaid = await loadMermaid();
  const results = [];
  for (const f of fences) {
    if (!f.closed) { results.push({ line: f.line, ok: false, error: 'the fence is never closed' }); continue; }
    if (!f.source.trim()) { results.push({ line: f.line, ok: false, error: 'the diagram is empty' }); continue; }
    try {
      const r = await mermaid.parse(f.source);
      results.push({ line: f.line, ok: true, type: r?.diagramType });
    } catch (err) {
      results.push({ line: f.line, ok: false, error: String(err?.message ?? err).split('\n').slice(0, 3).join(' | ') });
    }
  }
  return results;
}
