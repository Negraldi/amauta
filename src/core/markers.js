// Managed Markdown sections delimited by HTML comment markers:
//   <!-- amauta:ID -->
//   ...body...
//   <!-- /amauta:ID -->
// Everything outside a managed pair is never touched.

const OPEN_RE = /^<!-- amauta:(\S+) -->$/;

const openMarker = (id) => `<!-- amauta:${id} -->`;
const closeMarker = (id) => `<!-- /amauta:${id} -->`;

const trimTrailingNewlines = (s) => s.replace(/\n+$/, '');

/** Pair open/close markers of one id; report orphan marker line indexes. */
function scan(lines, id) {
  const open = openMarker(id);
  const close = closeMarker(id);
  const pairs = [];
  const orphans = [];
  let pending = null;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t === open) {
      if (pending !== null) orphans.push(pending);
      pending = i;
    } else if (t === close) {
      if (pending === null) orphans.push(i);
      else {
        pairs.push([pending, i]);
        pending = null;
      }
    }
  });
  if (pending !== null) orphans.push(pending);
  return { pairs, orphans };
}

/** Remove lines[from..to] plus one adjacent blank separator line. */
function removeRange(lines, s, e) {
  let from = s;
  let to = e + 1;
  if (from > 0 && lines[from - 1] === '') from -= 1;
  else if (from === 0 && lines[to] === '') to += 1;
  lines.splice(from, to - from);
}

function stripOrphans(lines, id) {
  const { orphans } = scan(lines, id);
  for (const i of [...orphans].sort((a, b) => b - a)) lines.splice(i, 1);
}

export function injectSection(text, id, body) {
  const lines = text.split('\n');
  stripOrphans(lines, id);
  const { pairs } = scan(lines, id);
  const content = trimTrailingNewlines(body);

  if (content === '') {
    for (const [s, e] of [...pairs].reverse()) removeRange(lines, s, e);
    return lines.join('\n');
  }

  const block = [openMarker(id), ...content.split('\n'), closeMarker(id)];
  if (pairs.length > 0) {
    for (const [s, e] of pairs.slice(1).reverse()) removeRange(lines, s, e);
    const [s, e] = pairs[0];
    lines.splice(s, e - s + 1, ...block);
    return lines.join('\n');
  }

  const base = lines.join('\n');
  if (base === '') return `${block.join('\n')}\n`;
  const withNewline = base.endsWith('\n') ? base : `${base}\n`;
  return `${withNewline}\n${block.join('\n')}\n`;
}

export function removeSection(text, id) {
  return injectSection(text, id, '');
}

export function listSections(text) {
  const lines = text.split('\n');
  const ids = [];
  for (const line of lines) {
    const m = OPEN_RE.exec(line.trim());
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  const found = [];
  for (const id of ids) {
    const { pairs } = scan(lines, id);
    if (pairs.length === 0) continue;
    const [s, e] = pairs[0];
    found.push({ start: s, id, body: lines.slice(s + 1, e).join('\n') });
  }
  return found.sort((a, b) => a.start - b.start).map(({ id, body }) => ({ id, body }));
}
