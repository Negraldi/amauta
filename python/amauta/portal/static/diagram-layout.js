"use strict";
// Diagrams that pick a layout for the width they get (T17b). A Mermaid source has a few layout candidates (as written, tighter,
// flipped direction with wrapped labels; for a sequence, wrapped messages in less room). Each is measured by its rendered width and
// the first one that fits the box is drawn, else the narrowest (fit.js then scales it to the text floor and the box scrolls).
// A sequence that cannot fit even at the floor is shown as an ordered list of steps; a flowchart in that case in a narrow box
// (under NARROW_PX) is shown as an outline: its nodes with their outgoing edges, and a button to see the diagram. Pure parts first.
// Shares the globals of app.js and fit.js, loaded before; every page draws its diagrams with adaptiveDiagram (T18a).

const isSequence = (src) => /^\s*sequenceDiagram/m.test(src);
// The init directive is added by this code only, from numbers: user text never reaches it.
const initLine = (cfg) => `%%{init:${JSON.stringify(cfg)}}%%\n`;
// Layouts to try, widest first. The first is always the source untouched.
function diagramCandidates(src) {
  if (isSequence(src)) {
    const seq = (width, actorMargin) => initLine({ sequence: { wrap: true, width, actorMargin, messageMargin: 28 } }) + src;
    return [src, seq(150, 40), seq(120, 24), seq(90, 8)];
  }
  const dir = /^(\s*(?:flowchart|graph)\s+)(TD|TB|BT|LR|RL)\b/m.exec(src);
  if (!dir) return [src];
  // Flip across axes keeping the arrow sense: BT (up) <-> RL (leftwards), TD/TB <-> LR; LR reads back as TD.
  const FLIPPED = { TD: "LR", TB: "LR", LR: "TD", BT: "RL", RL: "BT" };
  const flip = src.replace(dir[0], dir[1] + FLIPPED[dir[2]]);
  const tight = (s, wrappingWidth) => initLine({ flowchart: { nodeSpacing: 18, rankSpacing: 36, wrappingWidth } }) + s;
  // A subgraph with its own horizontal direction defeats a top-level flip: turn it to TB (a long row becomes a column).
  const nested = /^\s*direction\s+(?:LR|RL)\b/m.test(src);
  const column = (s) => s.replace(/^(\s*direction\s+)(?:LR|RL)\b/gm, "$1TB");
  const base = [src, tight(src, 160), tight(flip, 160), tight(flip, 120), tight(src, 110)];
  const out = nested ? base.concat(tight(column(src), 160), tight(column(flip), 120), tight(column(src), 110)) : base;
  const top = /^T[DB]$/.test(dir[2]), links = top ? stackLinks(src) : "";
  // Stacked: Mermaid lays unconnected nodes and sibling subgraphs side by side; invisible links put them in a column. Last,
  // so a candidate that fits with more room as written still wins. Lighter stacks go first: they are wider and shorter.
  const stack = (extra) => [tight(column(src) + extra, 160), tight(column(src) + extra, 120)];
  const steps = links ? [...new Set([stackLinks(src, "light"), stackLinks(src, "inner"), links])].filter(Boolean) : [];
  return out.concat(steps.flatMap(stack));
}
// Invisible links (`a ~~~ b` lines to append) for a top-level TB flowchart: consecutive nodes of a subgraph that is (or turns) TB
// with no edge between them, and sibling subgraphs that hang off the same source node. "" when there is no such pair.
// mode "light" only chains the nodes of a subgraph that has no edge of its own: chains and sibling subgraphs stay side by side.
// mode "inner" chains the nodes of every subgraph and leaves the sibling subgraphs side by side.
function stackLinks(src, mode) {
  const edges = new Set(), seen = new Set(), subs = [], stack = [], parents = new Map();
  for (const raw of src.split("\n")) {
    const line = raw.trim(), sub = /^subgraph\s+([\w.-]+)/.exec(line);
    if (sub) { const g = { id: sub[1], nodes: [] }; subs.push(g); stack.push(g); continue; }
    if (line === "end") { stack.pop(); continue; }
    if (!line || SKIP.test(line)) continue;
    const first = new RegExp(`^${NODE}`).exec(line);
    if (!first) continue;
    let prev = first[1], rest = line.slice(first[0].length), m;
    const add = (id) => { if (!seen.has(id)) { seen.add(id); if (stack.length) stack[stack.length - 1].nodes.push(id); } };
    add(prev);
    while ((m = new RegExp(`^${EDGE}${NODE}`).exec(rest))) {
      edges.add(`${prev} ${m[4]}`); edges.add(`${m[4]} ${prev}`);
      if (stack.length) stack[stack.length - 1].edged = true;
      if (!stack.length) parents.set(prev, (parents.get(prev) || []).concat(m[4]));
      add(m[4]); prev = m[4]; rest = rest.slice(m[0].length);
    }
  }
  const chain = (ids, skipConnected) => ids.slice(1).map((id, i) => [ids[i], id])
    .filter(([a, b]) => !(skipConnected && edges.has(`${a} ${b}`))).map(([a, b]) => `\n  ${a} ~~~ ${b}`);
  const ids = new Set(subs.map((g) => g.id));
  const lines = subs.filter((g) => !(mode === "light" && g.edged)).flatMap((g) => chain(g.nodes, true));
  if (mode) return lines.join("");
  for (const targets of parents.values()) lines.push(...chain(targets.filter((x) => ids.has(x)), false));
  return lines.join("");
}
// measured: [{source, width}] in candidate order. The first that fits `avail`, else the narrowest; null when nothing was measured.
function pickLayout(measured, avail) {
  let best = null;
  for (const m of measured) {
    if (m.width <= avail) return { source: m.source, width: m.width, fits: true };
    if (!best || m.width < best.width) best = m;
  }
  return best && { source: best.source, width: best.width, fits: false };
}
// Only a sequence turns into steps (a flowchart scrolls): when even the floor scale leaves it wider than the box.
const needsSteps = (src, width, avail) => isSequence(src) && width * MIN_DIAGRAM_SCALE > avail;
// The messages of a sequence diagram in order, with participants named by their alias. Notes, loops and directives are skipped.
function sequenceSteps(src) {
  const names = {};
  for (const m of src.matchAll(/^\s*(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/gm)) names[m[1]] = (m[2] || m[1]).trim();
  const arrow = /^\s*(\w+)\s*(--?>>|--?>|--?[x)])\s*[+-]?(\w+)\s*:\s*(.+)$/gm;
  return [...src.matchAll(arrow)].map((m) => ({ from: names[m[1]] || m[1], to: names[m[3]] || m[3], text: m[4].trim(),
    reply: m[2].startsWith("--"), self: m[1] === m[3] }));
}

// Even a flowchart scrolls unless the box is this narrow and the text would fall under the floor.
const NARROW_PX = 480;
const needsOutline = (src, width, avail) => !isSequence(src) && /^\s*(?:flowchart|graph)\b/m.test(src) && avail < NARROW_PX
  && width * MIN_DIAGRAM_SCALE > avail;
// The outline of a flowchart: [{title, edges, nodes: [{id, label, edges: [{to, label}]}]}], groups by first appearance ("" = no
// subgraph). A subgraph id is never an entry: an edge to it names its title, an edge out of it hangs on its group's `edges`.
const NODE = String.raw`([\w.-]+)(?:\s*(\[[^\]]*\]|\([^)]*\)|\{[^}]*\}))?`;
const EDGE = String.raw`\s*(?:--\s*([^->=|][^>|]*?)\s*[-=]{2,}[>xo]?|-\.\s*([^.]+?)\s*\.->|[-=.]{2,}[>xo]?(?:\s*\|([^|]*)\|)?)\s*`;
const decodeCodes = (s) => s.replace(/#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
const clean = (s) => decodeCodes((s || "").replace(/^[[({/\\>]+|[\])}/\\]+$/g, "").replace(/<br\s*\/?>/gi, " ")
  .replace(/^"|"$/g, "")).trim();
const SKIP = /^(?:flowchart|graph|direction|style|classDef|class|linkStyle|click|%%)\b/;
const SUBGRAPH = /^subgraph\s+(?:([\w.-]+)\s*\[(.*)\]|(.+))$/;
function flowOutline(src) {
  const nodes = new Map(), groups = [], stack = [], subs = new Map();
  for (const raw of src.split("\n")) { const m = SUBGRAPH.exec(raw.trim()); if (m) subs.set(m[1] || clean(m[3]), clean(m[2] || m[3])); }
  const groupOf = (title) => {
    let g = groups.find((x) => x.title === title);
    if (!g) groups.push((g = { title, edges: [], nodes: [] }));
    return g;
  };
  const touch = (id, shape) => {
    if (subs.has(id)) return { sub: subs.get(id), label: subs.get(id), edges: groupOf(subs.get(id)).edges };
    if (!nodes.has(id)) nodes.set(id, { id, label: id, edges: [], group: stack[stack.length - 1] || "" });
    if (shape) nodes.get(id).label = clean(shape) || id;
    return nodes.get(id);
  };
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const sub = SUBGRAPH.exec(line);
    if (sub) { stack.push(clean(sub[2] || sub[3])); continue; }
    if (line === "end") { stack.pop(); continue; }
    if (!line || SKIP.test(line)) continue;
    const re = new RegExp(`^${NODE}`), first = re.exec(line);
    if (!first) continue;
    let prev = touch(first[1], first[2]), rest = line.slice(first[0].length), m;
    while ((m = new RegExp(`^${EDGE}${NODE}`).exec(rest))) {
      const to = touch(m[4], m[5]);
      prev.edges.push({ to, label: clean(m[1] || m[2] || m[3]) });
      prev = to; rest = rest.slice(m[0].length);
    }
  }
  const named = (e) => ({ to: e.to.label, label: e.label });
  for (const g of groups) g.edges = g.edges.map(named);
  for (const n of nodes.values()) groupOf(n.group).nodes.push({ id: n.id, label: n.label, edges: n.edges.map(named) });
  return groups.filter((g) => g.nodes.length || g.edges.length);
}

// ---- the drawn box ----
let layoutSeq = 0;
async function layoutWidth(source) {
  const mermaid = await loadMermaid();
  syncMermaidTheme(mermaid);
  try {
    const { svg } = await mermaid.render(`lay-${++layoutSeq}`, localizedSource(themedSource(source)));
    const view = /viewBox="([^"]+)"/.exec(svg);
    return view ? Number(view[1].trim().split(/\s+/)[2]) : Infinity;
  } catch (_) { return Infinity; }
}
function stepList(src, caption) {
  const reply = ` (${t("diagram.reply")})`;
  return h("ol", { class: "seq-steps", "aria-label": caption }, sequenceSteps(src).map((s) =>
    h("li", null, h("span", { class: "who" }, s.self ? s.from : `${s.from} → ${s.to}${s.reply ? reply : ""}`), s.text)));
}
// The outline's words go through the same dictionary as the drawn diagram (localizedSource): ts() unless the portal is English.
const outlineText = (text) => (I.lang() === "en" ? text : ts(text));
function outlineList(src, caption) {
  const edge = (e) => h("li", null, `→ ${outlineText(e.to)}${e.label ? ` (${outlineText(e.label)})` : ""}`);
  const edges = (list) => (list.length ? h("ul", null, list.map(edge)) : null);
  const item = (n) => h("li", null, outlineText(n.label), edges(n.edges));
  return h("div", { class: "flow-list", role: "group", "aria-label": caption }, flowOutline(src).map((g) =>
    h("section", null, g.title ? h("h4", null, outlineText(g.title)) : null, edges(g.edges), h("ul", null, g.nodes.map(item)))));
}
// A flowchart in a narrow box that would not be legible: the outline first, the scrollable diagram on request, and back.
function showFlow(box, entry, src, caption, source, focus) {
  const toggle = (diagram) => { entry.wantDiagram = diagram; showFlow(box, entry, src, caption, source, true); };
  const button = (key, diagram) => h("button", { type: "button", class: "link", onclick: () => toggle(diagram) }, t(key));
  box.removeAttribute("role");
  box.className = box.className.replace(/\s*\boutline\b/, "") + (entry.wantDiagram ? "" : " outline");
  // (the list wraps, the diagram scrolls)
  entry.steps = !entry.wantDiagram; // the outline has nothing to redraw
  entry.target = null;
  // The button that was clicked is replaced by the other one: focus moves to it, or the keyboard falls back to the page.
  const next = button(entry.wantDiagram ? "diagram.showList" : "diagram.showDiagram", !entry.wantDiagram);
  const toDiagram = h("p", null, next);
  if (!entry.wantDiagram) box.replaceChildren(outlineList(src, caption), toDiagram);
  else {
    const inner = h("div", { role: "img", "aria-label": caption });
    entry.target = inner;
    box.replaceChildren(inner, toDiagram);
  }
  if (focus && next.focus) next.focus();
  return entry.wantDiagram ? drawMermaid(source, entry.target) : undefined;
}
// Measures candidates until one fits the box, then draws the pick; a stale pick (the box changed meanwhile) draws nothing.
async function chooseLayout(box, src, caption, entry, mine, avail) {
  const measured = [];
  let pick = null;
  for (const source of diagramCandidates(src)) {
    measured.push({ source, width: await layoutWidth(source) });
    pick = pickLayout(measured, avail);
    if (pick.fits) break;
  }
  if (mine !== box.layoutToken) return;
  box.className = ["diagram", "scroll", pick.fits && "fitted"].filter(Boolean).join(" ");
  entry.source = pick.source;
  entry.steps = needsSteps(src, pick.width, avail);
  if (entry.steps) {
    box.removeAttribute("role");
    box.replaceChildren(stepList(src, caption));
    return;
  }
  const outline = needsOutline(src, pick.width, avail);
  if (!outline) entry.wantDiagram = false; // a box that is wide enough again starts from the diagram next time
  entry.target = null;
  if (outline) return showFlow(box, entry, src, caption, pick.source);
  box.setAttribute("role", "img");
  await drawMermaid(pick.source, box);
}
let layoutBoxes = new Set(), layoutTimer = null;
function watchLayouts() {
  if (watchLayouts.on) return;
  watchLayouts.on = true;
  window.addEventListener("resize", () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => layoutBoxes.forEach((b) => (b.isConnected === false ? layoutBoxes.delete(b) : b.relayout())), 300);
  });
}
// onDrawn(box), when given, runs after every layout draw (the first one and each relayout).
function adaptiveDiagram(src, caption, onDrawn) {
  const label = caption || t("diagram.label");
  const box = h("div", { class: "diagram scroll", role: "img", "aria-label": label }, h("p", { class: "muted" }, t("common.rendering")));
  const entry = { box, source: src, drawn: false, steps: false, target: null };
  entry.redraw = () => { if (!entry.steps) drawMermaid(entry.source, entry.target || box); };
  let lastAvail = -1, waits = 0;
  box.layoutToken = 0;
  box.relayout = () => {
    if (!box.isConnected || !box.clientWidth) { if (++waits < 50) setTimeout(box.relayout, 60); return; } // not laid out yet
    const room = box.parentNode && box.parentNode.clientWidth; // a box that grows with its drawing: the parent gives the room
    const avail = Math.min(box.clientWidth, room || box.clientWidth) - BOX_PAD;
    if (Math.abs(avail - lastAvail) < 2) return;
    lastAvail = avail;
    chooseLayout(box, src, label, entry, ++box.layoutToken, avail).then(() => { entry.drawn = true; if (onDrawn) onDrawn(box); });
  };
  diagrams = diagrams.filter((d) => !gone(d)).concat(entry);
  layoutBoxes.add(box);
  watchLayouts();
  setTimeout(box.relayout, 0);
  return box;
}
