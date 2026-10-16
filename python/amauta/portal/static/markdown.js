"use strict";
// Safe Markdown subset for the wiki. parse() is pure (text in, plain node tree out); toDom() is the thin adapter that builds DOM
// nodes with createElement/createTextNode only. No HTML is ever parsed or assigned: markup in the source stays literal text, and a
// link survives only when safeHref() accepts its target (http, https, mailto, or a wiki route "#/...").
// Supported: headings, paragraphs, emphasis, strong, inline code, fenced code, ```mermaid fences, bullet/ordered lists (one nested level),
// tables, blockquotes, horizontal rules, links, and wikilinks [[slug]] and [[kind:id|label]].
(function () {
  const MAX_SOURCE = 200000;   // characters parsed at all
  const MAX_INLINE = 20000;    // longer inline runs are shown as plain text (keeps the scanner cheap)
  const MAX_ROWS = 1000;
  const MAX_DEPTH = 4;         // nested quotes and inline nesting
  const KINDS = ["memory", "skill", "tool", "mcp", "session", "feature", "node", "harness", "usage", "settings", "home"];

  function safeHref(raw) {
    const url = String(raw == null ? "" : raw).trim();
    if (!url || /[\s<>"\\\u0000-\u001f\u007f]/.test(url)) return null;
    if (/^https?:\/\/[^\s/?#]+/i.test(url) || /^mailto:[^\s@]+@[^\s@]+$/i.test(url) || /^#\/[^\s]*$/.test(url)) return url;
    return null;
  }

  function wikilinkTarget(inner) {
    const [target, ...rest] = inner.split("|");
    const label = rest.join("|").trim();
    const m = /^([a-z]+):(.+)$/.exec(target.trim());
    if (m && KINDS.includes(m[1])) return { kind: m[1], id: m[2].trim(), label: label || m[2].trim() };
    return { kind: "memory", id: target.trim(), label: label || target.trim() };
  }

  // ---- inline ------------------------------------------------------------------------------------------------
  function findClose(s, from, delim, state) {
    if (state[delim] === false) return -1;
    for (let j = s.indexOf(delim, from); j !== -1; j = s.indexOf(delim, j + 1)) {
      if (s[j - 1] !== "\\" && !/\s/.test(s[j - 1] || " ") && s[j + delim.length] !== delim[0]) return j;
    }
    state[delim] = false; // nothing later can close either: do not rescan for every following delimiter
    return -1;
  }
  function matchBracket(s, open, state) {
    if (state.noBracket) return -1;
    let depth = 0;
    for (let j = open; j < s.length; j++) {
      if (s[j] === "\\") { j++; continue; }
      if (s[j] === "[") depth++;
      else if (s[j] === "]" && --depth === 0) return j;
    }
    state.noBracket = true;
    return -1;
  }
  function matchParen(s, open, state) {
    if (state.noParen) return -1;
    let depth = 0;
    for (let j = open; j < s.length; j++) {
      if (/\s/.test(s[j]) && depth > 0 && j - open > 2000) break;
      if (s[j] === "(") depth++;
      else if (s[j] === ")" && --depth === 0) return j;
    }
    state.noParen = true;
    return -1;
  }

  function parseInline(s, depth = 0, state = {}) {
    const out = [];
    let buf = "";
    const flush = () => { if (buf) { out.push({ type: "text", text: buf }); buf = ""; } };
    if (s.length > MAX_INLINE || depth > MAX_DEPTH) return [{ type: "text", text: s }];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\\" && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!|>~<]/.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      if (ch === "`") {
        let n = 1;
        while (s[i + n] === "`") n++;
        const close = state["`" + n] === false ? -1 : s.indexOf("`".repeat(n), i + n);
        if (close !== -1 && s[close + n] !== "`") {
          flush();
          out.push({ type: "code", text: s.slice(i + n, close).replace(/^ (.*) $/, "$1") });
          i = close + n;
          continue;
        }
        if (close === -1) state["`" + n] = false;
        buf += "`".repeat(n); i += n; continue;
      }
      if (ch === "[" && s[i + 1] === "[") {
        const end = s.indexOf("]]", i + 2);
        const inner = end === -1 ? "" : s.slice(i + 2, end);
        if (end !== -1 && inner.trim() && !/[[\]\n]/.test(inner) && inner.length <= 200) {
          flush();
          out.push({ type: "wikilink", ...wikilinkTarget(inner) });
          i = end + 2;
          continue;
        }
      }
      if (ch === "[") {
        const close = matchBracket(s, i, state);
        if (close !== -1 && s[close + 1] === "(") {
          const end = matchParen(s, close + 1, state);
          if (end !== -1) {
            flush();
            const label = s.slice(i + 1, close);
            const target = s.slice(close + 2, end).trim().replace(/\s+"[^"]*"$/, "");
            const href = safeHref(target);
            out.push(href ? { type: "link", href, children: parseInline(label, depth + 1, {}) } : { type: "text", text: s.slice(i, end + 1) });
            i = end + 1;
            continue;
          }
        }
      }
      if (ch === "*" || ch === "_") {
        const strong = s[i + 1] === ch && s[i + 2] !== ch;
        const delim = strong ? ch + ch : ch;
        const wordBefore = /\w/.test(s[i - 1] || "");
        if (!(ch === "_" && wordBefore) && !/\s/.test(s[i + delim.length] || " ") && s[i + delim.length] !== ch) {
          const close = findClose(s, i + delim.length, delim, state);
          if (close !== -1 && !(ch === "_" && /\w/.test(s[close + delim.length] || ""))) {
            flush();
            out.push({ type: strong ? "strong" : "em", children: parseInline(s.slice(i + delim.length, close), depth + 1, {}) });
            i = close + delim.length;
            continue;
          }
        }
      }
      buf += ch;
      i++;
    }
    flush();
    return out;
  }

  // ---- blocks ------------------------------------------------------------------------------------------------
  const RE = {
    fence: /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)[^`\n]*$/,
    heading: /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/,
    hr: /^ {0,3}([-*_])(?: *\1){2,} *$/,
    quote: /^ {0,3}>/,
    item: /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/,
    delim: /^ *\|? *:?-{1,}:? *(?:\| *:?-{1,}:? *)*\|? *$/,
  };
  const isBlockStart = (line) => RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) || /^ {0,3}(?:[-*+]|1[.)])\s+\S/.test(line);

  function splitRow(line) {
    let t = line.trim();
    if (t.startsWith("|")) t = t.slice(1);
    if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
    const cells = [];
    let cur = "";
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i++; }
      else if (t[i] === "|") { cells.push(cur.trim()); cur = ""; }
      else cur += t[i];
    }
    cells.push(cur.trim());
    return cells.slice(0, 20);
  }
  const alignOf = (cell) => (/^:-+:$/.test(cell) ? "center" : /-:$/.test(cell) ? "right" : /^:-/.test(cell) ? "left" : null);

  function parseList(lines, i) {
    const first = RE.item.exec(lines[i]);
    const base = first[1].length;
    const list = { type: "list", ordered: /\d/.test(first[2]), items: [] };
    let item = null;
    while (i < lines.length) {
      const line = lines[i];
      const m = RE.item.exec(line);
      if (line.trim() === "") {
        const next = lines[i + 1];
        if (next !== undefined && (RE.item.test(next) || /^ {2,}\S/.test(next)) && !RE.hr.test(next)) { i++; continue; }
        break;
      }
      if (m && m[1].length < base + 2 && m[1].length >= base - 1) {
        if (m[1].length === base && list.ordered !== /\d/.test(m[2])) break;
        item = { text: m[3], sub: null };
        list.items.push(item);
      } else if (m && item && m[1].length >= base + 2) {
        item.sub ||= { type: "list", ordered: /\d/.test(m[2]), items: [] };
        item.sub.items.push({ text: m[3], sub: null });
      } else if (item && /^ /.test(line)) {
        const target = item.sub ? item.sub.items[item.sub.items.length - 1] : item;
        target.text += " " + line.trim();
      } else break;
      i++;
    }
    const inline = (it) => ({ children: parseInline(it.text), sub: it.sub ? { ...it.sub, items: it.sub.items.map(inline) } : null });
    return [{ ...list, items: list.items.map(inline) }, i];
  }

  function parseBlocks(lines, depth = 0) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") { i++; continue; }
      let m = RE.fence.exec(line);
      if (m) {
        const marker = m[1];
        const body = [];
        i++;
        while (i < lines.length && !(lines[i].trim().startsWith(marker[0].repeat(marker.length)) && /^[`~]+\s*$/.test(lines[i].trim()))) body.push(lines[i++]);
        i++; // closing fence (or end of input for an unclosed one)
        blocks.push(m[2].toLowerCase() === "mermaid" ? { type: "mermaid", text: body.join("\n") } : { type: "code", lang: m[2] || null, text: body.join("\n") });
        continue;
      }
      if ((m = RE.heading.exec(line))) { blocks.push({ type: "heading", level: m[1].length, children: parseInline(m[2]) }); i++; continue; }
      if (RE.hr.test(line)) { blocks.push({ type: "hr" }); i++; continue; }
      if (RE.quote.test(line)) {
        const inner = [];
        while (i < lines.length && RE.quote.test(lines[i])) inner.push(lines[i++].replace(/^ {0,3}> ?/, ""));
        blocks.push({ type: "quote", children: depth >= MAX_DEPTH ? [{ type: "paragraph", children: [{ type: "text", text: inner.join(" ") }] }] : parseBlocks(inner, depth + 1) });
        continue;
      }
      if (RE.item.test(line) && !RE.hr.test(line)) {
        const [list, next] = parseList(lines, i);
        blocks.push(list);
        i = next;
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && RE.delim.test(lines[i + 1]) && lines[i + 1].includes("-") && (lines[i + 1].includes("|") || splitRow(line).length > 1)) {
        const head = splitRow(line);
        const align = splitRow(lines[i + 1]).map(alignOf);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|") && rows.length < MAX_ROWS) rows.push(splitRow(lines[i++]));
        const cols = head.length;
        blocks.push({ type: "table", align, head: head.map((c) => parseInline(c)), rows: rows.map((r) => Array.from({ length: cols }, (_, k) => parseInline(r[k] || ""))) });
        continue;
      }
      const para = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) para.push(lines[i++].trim());
      blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
    }
    return blocks;
  }

  function parse(source) {
    const text = String(source == null ? "" : source).slice(0, MAX_SOURCE).replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
    return parseBlocks(text.split("\n"));
  }

  // ---- DOM adapter -----------------------------------------------------------------------------------------------
  // opts: known(kind, id) -> boolean (false marks a wikilink as missing), mermaid(source) -> Node, headingOffset (default 1: the page title is the h1).
  function toDom(tree, doc, opts = {}) {
    const el = (tag, attrs, ...kids) => {
      const node = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) node.setAttribute(k, v === true ? "" : String(v));
      for (const kid of kids.flat()) if (kid != null) node.append(kid);
      return node;
    };
    const text = (s) => doc.createTextNode(String(s));
    const inline = (nodes) => nodes.map((n) => {
      switch (n.type) {
        case "text": return text(n.text);
        case "code": return el("code", null, text(n.text));
        case "em": return el("em", null, inline(n.children));
        case "strong": return el("strong", null, inline(n.children));
        case "link": return el("a", { href: n.href, class: n.href.startsWith("#/") ? null : "external", rel: n.href.startsWith("#/") ? null : "noopener noreferrer", target: n.href.startsWith("#/") ? null : "_blank" }, inline(n.children));
        case "wikilink": {
          if (opts.known && opts.known(n.kind, n.id) === false) return el("span", { class: "wikilink missing", title: `No page yet for ${n.kind}: ${n.id}` }, text(n.label));
          return el("a", { class: "wikilink", href: `#/${n.kind}/${encodeURIComponent(n.id)}` }, text(n.label));
        }
        default: return text("");
      }
    });
    const list = (l) => el(l.ordered ? "ol" : "ul", null, l.items.map((it) => el("li", null, inline(it.children), it.sub ? list(it.sub) : null)));
    const offset = opts.headingOffset == null ? 1 : opts.headingOffset;
    const block = (b) => {
      switch (b.type) {
        case "heading": return el("h" + Math.min(6, b.level + offset), null, inline(b.children));
        case "paragraph": return el("p", null, inline(b.children));
        case "code": return el("pre", { class: "code" }, el("code", { class: b.lang ? "lang-" + b.lang.replace(/[^\w+-]/g, "") : null }, text(b.text)));
        case "mermaid": return opts.mermaid ? opts.mermaid(b.text) : el("pre", { class: "code" }, el("code", null, text(b.text)));
        case "list": return list(b);
        case "quote": return el("blockquote", null, b.children.map(block));
        case "hr": return el("hr");
        case "table": return el("div", { class: "scroll", tabindex: "0", role: "region", "aria-label": "Table, scrollable" }, el("table", null,
          el("thead", null, el("tr", null, b.head.map((c, k) => el("th", { class: b.align[k] ? "al-" + b.align[k] : null }, inline(c))))),
          el("tbody", null, b.rows.map((r) => el("tr", null, r.map((c, k) => el("td", { class: b.align[k] ? "al-" + b.align[k] : null }, inline(c))))))));
        default: return null;
      }
    };
    return tree.map(block).filter(Boolean);
  }

  // Wikilink targets in a tree, so a caller can ask the server which exist before rendering.
  function wikilinks(tree) {
    const found = [];
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      if (n.type === "wikilink") found.push({ kind: n.kind, id: n.id });
      for (const k of ["children", "sub", "items", "head", "rows"]) if (n[k]) walk(n[k]);
    };
    walk(tree);
    return found;
  }

  globalThis.AmautaMarkdown = { parse, parseInline, toDom, safeHref, wikilinks, wikilinkTarget };
})();
