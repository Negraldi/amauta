// Conservative TOML support for ~/.codex/config.toml: read and write only `[mcp_servers.<name>]` tables (plus their `.env`
// subtable; other dotted sub-tables such as `.tools.<tool>` are Codex-side config that is kept on rewrite and dropped
// on remove) and keep every other byte of the file. Quoted names equal bare ones. This is not a TOML parser: values it
// cannot read (dates, multi-line strings, nested arrays of tables) make an entry "foreign" (value null), which the installer never touches.
import { isDeepStrictEqual } from 'node:util';

const UNSUPPORTED = Symbol('unsupported');

const BARE = /^[A-Za-z0-9_-]+$/;
const quoteString = (s) => JSON.stringify(s).replaceAll('\u007f', '\\u007f');
const quoteKey = (k) => (BARE.test(k) ? k : quoteString(k));

function splitLines(text) {
  const nl = text.endsWith('\n');
  const lines = text.split('\n');
  if (nl) lines.pop();
  return { lines, nl };
}
const joinLines = (lines, nl) => (lines.length === 0 ? '' : lines.join('\n') + (nl ? '\n' : ''));

/** Lexical state across lines: inside a multi-line string, or inside an open array / inline table. */
function advance(line, st) {
  let { multi, depth } = st;
  let i = 0;
  while (i < line.length) {
    if (multi) {
      if (multi === '"""' && line[i] === '\\') i += 2;
      else if (line.startsWith(multi, i)) {
        multi = null;
        i += 3;
      } else i += 1;
      continue;
    }
    const c = line[i];
    if (c === '#') break;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      multi = line.slice(i, i + 3);
      i += 3;
    } else if (c === '"') {
      i += 1;
      while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      i = end === -1 ? line.length : end + 1;
    } else {
      if (c === '[' || c === '{') depth += 1;
      else if ((c === ']' || c === '}') && depth > 0) depth -= 1;
      i += 1;
    }
  }
  return { multi, depth };
}

/** Parse a dotted key (`a."b c".d`) into its parts, or null when the text is not one. */
function parseKeyPath(text) {
  const parts = [];
  let i = 0;
  const s = text.trim();
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i += 1;
    let key;
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      if (j >= s.length) return null;
      try {
        key = JSON.parse(s.slice(i, j + 1));
      } catch {
        return null;
      }
      i = j + 1;
    } else if (s[i] === "'") {
      const j = s.indexOf("'", i + 1);
      if (j === -1) return null;
      key = s.slice(i + 1, j);
      i = j + 1;
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(s.slice(i));
      if (!m) return null;
      key = m[0];
      i += key.length;
    }
    parts.push(key);
    while (s[i] === ' ' || s[i] === '\t') i += 1;
    if (i >= s.length) break;
    if (s[i] !== '.') return null;
    i += 1;
  }
  return parts.length > 0 ? parts : null;
}

const HEADER = /^\s*(\[\[?)(.*?)(\]\]?)\s*(#.*)?$/;

/** Table headers of a file: { path, array, line } for each `[a.b]` / `[[a.b]]` outside strings and arrays. */
function scanHeaders(lines) {
  const out = [];
  let st = { multi: null, depth: 0 };
  lines.forEach((line, i) => {
    if (st.multi === null && st.depth === 0) {
      const m = HEADER.exec(line);
      if (m && (m[1].length === 2) === (m[3].length === 2)) {
        const keys = parseKeyPath(m[2]);
        if (keys) {
          out.push({ path: keys, array: m[1].length === 2, line: i });
          return;
        }
      }
    }
    st = advance(line, st);
  });
  return out;
}

function parseString(s, i) {
  if (s[i] === '"') {
    if (s.startsWith('"""', i)) throw UNSUPPORTED;
    let j = i + 1;
    while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
    if (j >= s.length) throw UNSUPPORTED;
    try {
      return [JSON.parse(s.slice(i, j + 1)), j + 1];
    } catch {
      throw UNSUPPORTED;
    }
  }
  if (s.startsWith("'''", i)) throw UNSUPPORTED;
  const j = s.indexOf("'", i + 1);
  if (j === -1) throw UNSUPPORTED;
  return [s.slice(i + 1, j), j + 1];
}

function skipSpace(s, i) {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (s[i] === '#') while (i < s.length && s[i] !== '\n') i += 1;
    else return i;
  }
}

function parseValue(s, i) {
  i = skipSpace(s, i);
  const c = s[i];
  if (c === '"' || c === "'") return parseString(s, i);
  if (c === '[') {
    const arr = [];
    i = skipSpace(s, i + 1);
    while (s[i] !== ']') {
      let v;
      [v, i] = parseValue(s, i);
      arr.push(v);
      i = skipSpace(s, i);
      if (s[i] === ',') i = skipSpace(s, i + 1);
      else if (s[i] !== ']') throw UNSUPPORTED;
    }
    return [arr, i + 1];
  }
  if (c === '{') {
    const obj = {};
    i = skipSpace(s, i + 1);
    while (s[i] !== '}') {
      const eq = s.indexOf('=', i);
      if (eq === -1) throw UNSUPPORTED;
      const keys = parseKeyPath(s.slice(i, eq));
      if (!keys) throw UNSUPPORTED;
      let v;
      [v, i] = parseValue(s, eq + 1);
      assign(obj, keys, v);
      i = skipSpace(s, i);
      if (s[i] === ',') i = skipSpace(s, i + 1);
      else if (s[i] !== '}') throw UNSUPPORTED;
    }
    return [obj, i + 1];
  }
  const m = /^(true|false|[+-]?\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)(?![\w:.-])/.exec(s.slice(i));
  if (!m) throw UNSUPPORTED;
  const v = m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1].replaceAll('_', ''));
  return [v, i + m[0].length];
}

function assign(obj, keys, value) {
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] === undefined) cur[k] = {};
    if (typeof cur[k] !== 'object' || Array.isArray(cur[k])) throw UNSUPPORTED;
    cur = cur[k];
  }
  cur[keys.at(-1)] = value;
}

/** Key/value lines of one table body (header excluded) into `target`. Throws UNSUPPORTED on anything unreadable. */
function parseBody(lines, target) {
  let st = { multi: null, depth: 0 };
  let logical = '';
  for (const line of lines) {
    logical += `${line}\n`;
    st = advance(line, st);
    if (st.multi !== null || st.depth > 0) continue;
    const text = logical;
    logical = '';
    if (/^\s*(#.*)?$/.test(text.slice(0, -1))) continue;
    const eq = text.indexOf('=');
    const keys = eq === -1 ? null : parseKeyPath(text.slice(0, eq));
    if (!keys) throw UNSUPPORTED;
    const [v, end] = parseValue(text, eq + 1);
    if (skipSpace(text, end) !== text.length) throw UNSUPPORTED;
    assign(target, keys, v);
  }
  if (logical !== '') throw UNSUPPORTED;
}

/** Last line of a table that belongs to it: trailing blank and comment lines go with whatever follows. */
function trimmedEnd(lines, from, to) {
  let end = to;
  while (end > from && /^\s*(#.*)?$/.test(lines[end])) end -= 1;
  return end;
}

/**
 * Read `[mcp_servers.<name>]` (and `.env`). Result: `found` (the file has something under that name), `value`
 * ({command, args?, env?, ...}; null when foreign or unreadable), `ranges` (inclusive line ranges of our tables) and
 * `parent` (the name is defined through the `[mcp_servers]` parent table, which this module never rewrites).
 */
export function readMcpServer(text, name) {
  const { lines } = splitLines(text);
  const headers = scanHeaders(lines);
  const ranges = [];
  let value = {};
  let ok = true;
  let parent = false;
  headers.forEach((h, idx) => {
    const to = (headers[idx + 1]?.line ?? lines.length) - 1;
    const body = lines.slice(h.line + 1, to + 1);
    if (h.path.length === 1 && h.path[0] === 'mcp_servers' && !h.array) {
      try {
        const probe = {};
        parseBody(body, probe);
        if (name in probe) parent = true;
      } catch {
        if (body.some((l) => l.trim().startsWith(name) || l.includes(`"${name}"`))) parent = true;
      }
      return;
    }
    if (h.path[0] !== 'mcp_servers' || h.path[1] !== name) return;
    const owned = !h.array && (h.path.length === 2 || (h.path.length === 3 && h.path[2] === 'env'));
    ranges.push({ start: h.line, end: trimmedEnd(lines, h.line, to), owned, quoted: h.path.length === 2 && /["']/.test(lines[h.line]) });
    if (h.array) {
      ok = false;
      return;
    }
    if (!owned) return; // Codex-side sub-tables (`.tools.<tool>`, ...): kept as they are, not part of the value
    try {
      let target = value;
      if (h.path.length === 3) target = value.env ??= {};
      parseBody(body, target);
    } catch (err) {
      if (err !== UNSUPPORTED) throw err;
      ok = false;
    }
  });
  return { found: ranges.length > 0 || parent, value: ok && !parent && ranges.length > 0 ? value : null, ranges, parent };
}

/** The part of a server value amauta compares and owns: command, args and env (Codex-only keys are ignored). */
export const mcpCore = (v) => (v === null || typeof v !== 'object' ? v : { command: v.command, ...(v.args !== undefined ? { args: v.args } : {}), ...(v.env !== undefined ? { env: v.env } : {}) });

/** Names of the `[mcp_servers.<name>]` tables in a file (parent-table definitions excluded), in file order. */
export function listMcpServers(text) {
  const { lines } = splitLines(text);
  const names = [];
  for (const h of scanHeaders(lines)) if (h.path[0] === 'mcp_servers' && h.path.length >= 2 && !h.array && !names.includes(h.path[1])) names.push(h.path[1]);
  return names;
}

/** TOML for one server entry: `[mcp_servers.<name>]` plus `[mcp_servers.<name>.env]` when it has env. */
function renderScalar(v) {
  if (typeof v === 'string') return quoteString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const items = v.map(renderScalar);
    return items.includes(null) ? null : `[${items.join(', ')}]`;
  }
  if (v !== null && typeof v === 'object') {
    const items = Object.entries(v).map(([k, x]) => [k, renderScalar(x)]);
    return items.some(([, x]) => x === null) ? null : `{ ${items.map(([k, x]) => `${quoteKey(k)} = ${x}`).join(', ')} }`;
  }
  return null;
}

export function renderMcpServer(name, value, { quoted = false } = {}) {
  const key = quoted ? quoteString(name) : quoteKey(name);
  const { command, args, env, ...rest } = value;
  const unsupported = Object.keys(rest).filter((k) => renderScalar(rest[k]) === null);
  if (unsupported.length > 0) throw new Error(`cannot render unsupported MCP keys: ${unsupported.join(', ')}`);
  const out = [`[mcp_servers.${key}]`, `command = ${quoteString(command)}`];
  if (args !== undefined) out.push(`args = [${args.map(quoteString).join(', ')}]`);
  for (const [k, v] of Object.entries(rest)) out.push(`${quoteKey(k)} = ${renderScalar(v)}`); // keys amauta does not own, kept as they were
  if (env && Object.keys(env).length > 0) {
    out.push('', `[mcp_servers.${key}.env]`);
    for (const [k, v] of Object.entries(env)) out.push(`${quoteKey(k)} = ${quoteString(v)}`);
  }
  return `${out.join('\n')}\n`;
}

/** Remove a line range plus the blank separator after it (or, at the end of a section, the one before it). */
function removeRange(lines, { start, end }) {
  let from = start;
  let to = end + 1;
  if (lines[to] === '') to += 1;
  else if (from > 0 && lines[from - 1] === '') from -= 1;
  lines.splice(from, to - from);
}

/** Insert or refresh our tables for `name`: in place when present, appended at the end otherwise. */
export function setMcpServer(text, name, value) {
  const r = readMcpServer(text, name);
  if (r.parent) throw new Error(`mcp_servers.${name} is defined through the [mcp_servers] parent table; not touching it`);
  const own = r.ranges.filter((x) => x.owned);
  const { command: _c, args: _a, env: _e, ...kept } = r.value ?? {}; // unknown keys of the user's table survive
  const merged = { ...value, ...kept, ...Object.fromEntries(Object.entries(value).filter(([k]) => !['command', 'args', 'env'].includes(k))) };
  const block = renderMcpServer(name, merged, { quoted: own[0]?.quoted ?? r.ranges[0]?.quoted });
  let out;
  if (own.length === 0) {
    out = text === '' ? block : `${text.endsWith('\n') ? text : `${text}\n`}\n${block}`;
  } else {
    const { lines, nl } = splitLines(text);
    for (const range of own.slice(1).reverse()) removeRange(lines, range);
    const first = own[0];
    lines.splice(first.start, first.end - first.start + 1, ...block.slice(0, -1).split('\n'));
    out = joinLines(lines, nl);
  }
  if (!isDeepStrictEqual(readMcpServer(out, name).value, merged)) throw new Error(`could not write mcp_servers.${name} reliably; config left unchanged`);
  return out;
}

export function removeMcpServer(text, name) {
  const r = readMcpServer(text, name);
  if (r.ranges.length === 0) return text;
  const { lines, nl } = splitLines(text);
  for (const range of [...r.ranges].reverse()) removeRange(lines, range);
  return joinLines(lines, nl);
}
