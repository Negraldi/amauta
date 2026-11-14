"use strict";
// Diagrams that pick a layout for the width they get (T17b). A Mermaid source has a few layout candidates (as written, tighter,
// flipped direction with wrapped labels; for a sequence, wrapped messages in less room). Each is measured by its rendered width and
// the first one that fits the box is drawn, else the narrowest (fit.js then scales it to the text floor and the box scrolls).
// A sequence that cannot fit even at the floor is shown as an ordered list of steps. The pure parts come first.
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
  return nested ? base.concat(tight(column(src), 160), tight(column(flip), 120), tight(column(src), 110)) : base;
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
  const entry = { box, source: src, drawn: false, steps: false, redraw: () => { if (!entry.steps) drawMermaid(entry.source, box); } };
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
