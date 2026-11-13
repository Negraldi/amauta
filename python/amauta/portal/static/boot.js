"use strict";
// Boot: wires the search palette, the filters, the theme and language pickers and the router, then renders the first page. Loaded last.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

// ---- search palette (native <dialog>) ---------------------------------------------------------------------------
const palette = { items: [], nodes: [], index: -1, seq: 0 };
function openPalette() {
  const dlg = $("palette");
  if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
  const input = $("palette-input");
  if (input.focus) input.focus();
  if (input.select) input.select();
}
// back: return focus to the trigger (Esc, backdrop); a route change or a chosen result leaves focus to the new page.
function closePalette(back) {
  const dlg = $("palette");
  if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
  if (back && $("search-open").focus) $("search-open").focus();
}
function selectResult(index) {
  palette.index = index;
  palette.nodes.forEach((n, i) => n.setAttribute("aria-selected", String(i === index)));
  const node = palette.nodes[index];
  if (node) {
    $("palette-input").setAttribute("aria-activedescendant", node.getAttribute("id"));
    if (node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
  }
}
function goResult(index) {
  const item = palette.items[index];
  if (!item) return;
  closePalette();
  location.hash = R.formatHash(item.kind, item.id);
}
// Search groups arrive named after their kind (memory, skill, ...): shown with the same labels as the pages.
const groupLabel = (kind) => (`palette.group.${kind}` in I.dict.en ? t(`palette.group.${kind}`) : kind);
// The pages of the sidebar (and their tabs) whose label matches: Ctrl+K also jumps to Guide, Settings, Usage ...
function pageResults(q) {
  const seen = new Set(), items = [];
  for (const it of R.NAV.flatMap((g) => g.items.flatMap((i) => [i, ...(i.tabs || [])]))) {
    const title = t(it.key);
    if (seen.has(it.kind) || !title.toLowerCase().includes(q.toLowerCase())) continue;
    seen.add(it.kind);
    items.push({ kind: it.kind, id: "", title });
  }
  return items.length ? [{ kind: "page", count: items.length, items }] : [];
}
function paintResults(found, q) {
  const groups = R.rankResults(found); // graph nodes last and capped (critique C6)
  const box = $("palette-results");
  palette.items = R.flattenResults(groups);
  palette.nodes = [];
  if (!palette.items.length) { box.replaceChildren(h("p", { class: "muted" }, t("palette.noResults", { q }))); return; }
  let flat = 0;
  const head = (g) => h("div", { class: "pal-head" }, `${groupLabel(g.kind)} (${fmt(g.count)})`);
  box.replaceChildren(...groups.map((g) => h("div", { class: "pal-group", role: "group", "aria-label": groupLabel(g.kind) }, head(g),
    g.items.map((it) => {
      const i = flat++;
      const node = h("div", { role: "option", id: `pal-${i}`, class: "pal-item", "aria-selected": "false", onclick: () => goResult(i) },
        h("span", { class: "pal-title" }, it.title), it.snippet ? h("span", { class: "pal-snip muted" }, it.snippet) : null);
      palette.nodes.push(node);
      return node;
    }))));
  selectResult(0);
}
async function runSearch() {
  const q = $("palette-input").value.trim();
  const seq = ++palette.seq;
  const note = (cls, text) => { palette.items = []; palette.nodes = []; $("palette-results").replaceChildren(h("p", { class: cls }, text)); };
  if (!q) { note("muted", t("palette.hint")); return; }
  try {
    const r = await api("wiki/search", { q });
    if (seq === palette.seq) paintResults([...pageResults(q), ...r.groups], q);
  } catch (err) {
    if (seq === palette.seq) note("warn", t("palette.failed", { reason: plainReason(err) }));
  }
}

let searchTimer = null;
$("palette-input").addEventListener("input", () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 120);
});
$("palette-input").addEventListener("keydown", (e) => {
  const step = e.key === "ArrowDown" ? 1 : -1;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (palette.items.length) selectResult(R.moveIndex(palette.index, step, palette.items.length)); }
  else if (e.key === "Enter" && palette.index >= 0) { e.preventDefault(); goResult(palette.index); }
  else if (e.key === "Escape") { e.preventDefault(); closePalette(true); } // type=search clears on Esc; one press closes instead
});
$("palette").addEventListener("click", (e) => { if (e.target === $("palette")) closePalette(true); });
$("search-open").addEventListener("click", openPalette);
document.addEventListener("keydown", (e) => {
  const tag = String((e.target && e.target.tagName) || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select" || (e.target && e.target.isContentEditable);
  if (e.key === "Escape" && navOpen()) setNav(false, true);
  else if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); openPalette(); }
  else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openPalette(); }
});

// The phone menu: the Menu button toggles it; Esc and a tap on the scrim close it and give focus back to the button.
function setNav(open, back) {
  $("shell").setAttribute("data-nav", open ? "open" : "closed");
  $("nav-toggle").setAttribute("aria-expanded", String(open));
  if (back && $("nav-toggle").focus) $("nav-toggle").focus();
}
const navOpen = () => $("shell").getAttribute("data-nav") === "open";
$("nav-toggle").addEventListener("click", () => setNav(!navOpen()));
$("nav-scrim").addEventListener("click", () => setNav(false, true));
// Refresh (top bar): imports new usage, then reloads the project list and the current route. Disabled while it runs.
$("refresh").addEventListener("click", async () => {
  $("status").textContent = t("refresh.running");
  $("refresh").setAttribute("disabled", "");
  try {
    const r = await fetch("/api/refresh", { method: "POST", headers: { "X-Portal-Token": token } });
    const b = await r.json();
    $("status").textContent = r.ok ? t("refresh.done", { messages: fmt(b.messages), files: fmt(b.files) })
      : t("refresh.failed", { reason: ts(b.error) });
    await loadProjects();
    render();
  } catch (err) { $("status").textContent = t("refresh.failed", { reason: netError(err) }); }
  finally { $("refresh").removeAttribute("disabled"); }
});
for (const id of ["days", "project", "runtime"]) $(id).addEventListener("change", render);
$("theme-picker").addEventListener("change", (e) => chooseTheme(e.target.value));
$("lang-picker").addEventListener("change", (e) => setLanguage(e.target.value));
// An old hash is rewritten in place (no history entry, no second hashchange) and the route it stands for renders.
function readRoute() {
  const to = R.redirectOf(location.hash);
  if (to && globalThis.history && history.replaceState) history.replaceState(null, "", to);
  state.route = R.parseHash(to || location.hash);
}
// A route change closes the search palette and the Display popover (its Edit themes link navigates).
function closeDisplay() { const p = $("prefs"); if (typeof p.hidePopover === "function" && p.matches(":popover-open")) p.hidePopover(); }
window.addEventListener("hashchange", () => { closePalette(); closeDisplay(); readRoute(); render(); });
readRoute();
// The dictionaries load first (plan N11b); a failed load still starts the page, in English keys at worst.
I.load(fetch).catch(() => {}).then(() => {
  applyLanguage(I.loadLang(I.storage()) || I.detect(I.browserLanguage())); // a stored choice wins over the browser language
  applyTheme();
  paintPicker();
  if (!onAppearance(state.route)) loadThemes(); // the editor page loads them itself
  loadProjects().then(render);
});
// Liveness signal: lets a launcher-started server exit once the window is gone. Failures are silent on purpose.
function heartbeat() { fetch("/api/heartbeat", { method: "POST", headers: { "X-Portal-Token": token } }).catch(() => {}); }
heartbeat();
setInterval(heartbeat, 10000);
