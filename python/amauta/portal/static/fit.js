"use strict";
// Legibility of wide things (T15 W2): diagrams are never drawn with text under MIN_TEXT_PX (fit to the box down to a scale floor,
// then they scroll), and a box that really overflows says so (a visible hint) and is the only one that is a Tab stop.
// Shares the globals of app.js, loaded before boot.js; boot.js starts watchOverflow().

const MIN_TEXT_PX = 11, DIAGRAM_TEXT_PX = 13; // the theme's Mermaid font size (app.js mermaidTheme); the floor follows from both
const MIN_DIAGRAM_SCALE = MIN_TEXT_PX / DIAGRAM_TEXT_PX;
const BOX_PAD = 16; // the diagram card's own padding, both sides

// The scale a diagram of `viewWidth` (its natural width) is drawn at in `avail` px: fitted when that keeps the text readable,
// else the floor (the box scrolls sideways); never larger than natural. `natural` pins it at 1.
function diagramScale(viewWidth, avail, natural) {
  if (natural || !(viewWidth > 0) || !(avail > 0)) return 1;
  return Math.min(1, Math.max(MIN_DIAGRAM_SCALE, avail / viewWidth));
}
// Sizes the drawn svg of a diagram box. The box that scrolls is the Harness scroller when there is one, else the box itself.
function fitDiagram(box) {
  const svg = box.querySelector && box.querySelector("svg"), host = (box.closest && box.closest(".arch-scroll")) || box;
  if (!svg || !svg.viewBox || !svg.viewBox.baseVal || !svg.viewBox.baseVal.width) return;
  const width = svg.viewBox.baseVal.width, avail = (host.clientWidth || 0) - BOX_PAD;
  if (avail <= 0) return; // not on the page yet: the next sync fits it
  const natural = host.getAttribute && host.getAttribute("data-size") === "full";
  svg.style.maxWidth = "none";
  svg.style.width = `${Math.ceil(width * diagramScale(width, avail, natural))}px`;
}
// One box: a Tab stop and a sideways hint only while its content is wider than it is; both go away when it fits again.
function syncScroller(el) {
  if (!(el.scrollWidth >= 0) || !(el.clientWidth > 0)) return; // not measurable here (not laid out): leave it as built
  const over = el.scrollWidth > el.clientWidth + 1, next = el.nextElementSibling;
  const hint = next && /\bscroll-hint\b/.test(next.className || "");
  if (over) el.setAttribute("tabindex", "0"); else el.removeAttribute("tabindex");
  if (over && !hint && el.after) {
    const diagram = /\b(diagram|arch-scroll)\b/.test(el.className || "");
    el.after(h("p", { class: "muted scroll-hint" }, t(diagram ? "scroll.moreDiagram" : "scroll.moreColumns")));
  } else if (!over && hint && next.remove) next.remove();
}
function syncOverflow(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(".diagram").forEach(fitDiagram);
  root.querySelectorAll(".scroll, .arch-scroll").forEach(syncScroller);
}
// Re-measured when the page content changes or the window is resized; the sync is idempotent, so its own edits settle at once.
function watchOverflow(view) {
  let queued = false;
  const run = () => { queued = false; syncOverflow(view); };
  const later = () => { if (!queued) { queued = true; (globalThis.requestAnimationFrame || setTimeout)(run); } };
  try { new MutationObserver(later).observe(view, { childList: true, subtree: true }); } catch (_) { /* no MutationObserver */ }
  window.addEventListener("resize", later);
}
