"use strict";
// Boot: wires the search palette, the filters, the theme and language pickers and the router, then renders the first page. Loaded last.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

// ---- search palette (native <dialog>) ---------------------------------------------------------------------------
const palette = { items: [], nodes: [], index: -1, seq: 0 };
function openPalette() {
  const dlg = $("palette");
  if (!dlg.open && $("palette-input").value) { $("palette-input").value = ""; resetSearch(); } // a closed palette starts empty
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
// Graph nodes: two nodes of one file with one title are one row; a node row names its file, its path cut from the left.
const baseName = (p) => String(p).split("/").pop();
const tailPath = (p, max = 36) => (p.length > max ? `\u2026${p.slice(1 - max)}` : p);
function nodeRows(groups) {
  return groups.map((g) => {
    if (g.kind !== "node") return g;
    const seen = new Set(), key = (it) => `${it.title}\n${it.snippet}`;
    const named = (it) => ({ ...it, snippet: tailPath(String(it.snippet)),
      title: baseName(it.snippet) === it.title ? it.title : `${it.title} · ${baseName(it.snippet)}` });
    const items = (g.items || []).filter((it) => !seen.has(key(it)) && seen.add(key(it))).map((it) => (it.snippet ? named(it) : it));
    return { ...g, items, count: g.count - ((g.items || []).length - items.length) };
  });
}
// A group that hit the server's search cap says so: "first 50 of 728" when the total is known, else "50+".
function groupCount(g) {
  if (!g.capped || (g.total != null && g.total <= g.count)) return fmt(g.count);
  return g.total != null ? t("palette.firstOf", { n: fmt(g.count), total: fmt(g.total) }) : `${fmt(g.count)}+`;
}
function paintResults(found, q) {
  const groups = R.rankResults(nodeRows(found)); // graph nodes last and capped (critique C6)
  const box = $("palette-results");
  palette.items = R.flattenResults(groups);
  palette.nodes = [];
  if (!palette.items.length) { box.replaceChildren(h("p", { class: "muted" }, t("palette.noResults", { q }))); return; }
  let flat = 0;
  const head = (g) => h("div", { class: "pal-head" }, `${groupLabel(g.kind)} (${groupCount(g)})`);
  box.replaceChildren(...groups.map((g) => h("div", { class: "pal-group", role: "group", "aria-label": groupLabel(g.kind) }, head(g),
    g.items.map((it) => {
      const i = flat++;
      const node = h("div", { role: "option", id: `pal-${i}`, class: "pal-item", "aria-selected": "false", onclick: () => goResult(i) },
        h("span", { class: "pal-title" }, codeSpans(itemTitle(it.kind, it.title))),
        it.snippet ? h("span", { class: "pal-snip muted" }, it.kind === "node" ? it.snippet : ts(it.snippet)) : null);
      palette.nodes.push(node);
      return node;
    }))));
  selectResult(0);
}
const paletteNote = (cls, text) => {
  palette.items = []; palette.nodes = [];
  $("palette-results").replaceChildren(h("p", { class: cls }, text));
};
// A pending search says so (T13): "Searching." with aria-busy from the keystroke until its answer, or a newer one, lands.
const searchBusy = (on) => (on ? $("palette-results").setAttribute("aria-busy", "true")
  : $("palette-results").removeAttribute("aria-busy"));
async function runSearch() {
  const q = $("palette-input").value.trim();
  const seq = ++palette.seq;
  if (!q) { searchBusy(false); paletteNote("muted", t("palette.hint")); return; }
  try {
    const r = await api("wiki/search", { q });
    if (seq === palette.seq) { searchBusy(false); paintResults([...pageResults(q), ...r.groups], q); }
  } catch (err) {
    if (seq !== palette.seq) return;
    searchBusy(false);
    const local = pageResults(q); // what needs no server stays; the note says the rest is missing
    if (!local.length) { paletteNote("warn", t("palette.failed", { reason: plainReason(err) })); return; }
    paintResults(local, q);
    $("palette-results").append(h("p", { class: "warn", role: "alert" }, `▲ ${t("palette.failedLocal")}`));
  }
}

let searchTimer = null;
// The empty state at once: a pending answer or timer is dropped (a newer seq), so nothing old is painted over it.
function resetSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  palette.seq++;
  searchBusy(false);
  paletteNote("muted", t("palette.hint"));
}
$("palette-input").addEventListener("input", () => {
  if (!$("palette-input").value.trim()) return resetSearch();
  if (searchTimer) clearTimeout(searchTimer);
  searchBusy(true); paletteNote("muted", t("palette.searching"));
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

// The phone menu: the Menu button toggles it; Esc and a tap on the scrim close it and give focus back to the button. While it
// is open, focus starts on its first link and the page behind it (content, filters, the rest of the top bar) is inert.
const BEHIND_MENU = ["view", "search-open", "topbar-end", "filters"];
const firstLink = (el) => (String(el.tagName).toLowerCase() === "a" ? el
  : Array.from(el.children || []).reduce((hit, c) => hit || firstLink(c), null));
function setNav(open, back) {
  $("shell").setAttribute("data-nav", open ? "open" : "closed");
  $("nav-toggle").setAttribute("aria-expanded", String(open));
  for (const id of BEHIND_MENU) if (open) $(id).setAttribute("inert", ""); else $(id).removeAttribute("inert");
  const first = open && firstLink($("nav"));
  if (first && first.focus) first.focus();
  if (back && $("nav-toggle").focus) $("nav-toggle").focus();
}
// Widening the window past the phone layout closes the menu, so nothing stays inert behind a sidebar that no longer overlays.
try {
  globalThis.matchMedia("(width >= 52rem)").addEventListener("change", (e) => { if (e.matches && navOpen()) setNav(false); });
} catch (_) { /* no matchMedia */ }
// The sticky Activity filter bar sits under the top bar, whatever its height (T11 k); measured on resize, never polled.
try {
  const bar = document.querySelector(".topbar");
  new ResizeObserver(() => $("shell").style.setProperty("--topbar-h", `${Math.ceil(bar.offsetHeight)}px`)).observe(bar);
} catch (_) { /* no ResizeObserver: the 3rem fallback */ }
watchOverflow($("view")); // scroll hints and diagram sizes follow the page content and the window (fit.js)
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
// Usage filters on a phone (T13): a native <details> folds Range, Project and Runtime under one summary line that names the
// choice ("30 days · All projects · All runtimes"); closed under 35rem, open (summary hidden, style.css) from there up.
function syncFilterFold() {
  const f = filters();
  $("filters-summary").textContent = [t(`filters.d${f.days}`), f.project || t("filters.allProjects"),
    f.runtime ? runtimeName(f.runtime) : t("filters.everyRuntime")].join(" · ");
}
try {
  const wide = globalThis.matchMedia("(width > 35rem)"), fold = () => { $("filters-fold").open = wide.matches; };
  fold();
  wide.addEventListener("change", fold);
} catch (_) { $("filters-fold").open = true; } // no matchMedia: the bar as it always was
for (const id of ["days", "project", "runtime"]) $(id).addEventListener("change", () => { syncFilterFold(); render(); });
$("theme-picker").addEventListener("change", (e) => chooseTheme(e.target.value));
$("lang-picker").addEventListener("change", (e) => setLanguage(e.target.value));
// A ?tab= that names no tab of this page is dropped, so the address always names the tab that is shown.
function knownTab(route) {
  const tab = route.query && route.query.tab;
  const shown = route.kind === "settings" ? R.settingsTab(route) : route.kind === "project" && route.id ? R.projectTab(route) : null;
  if (!tab || shown === tab) return route;
  const { tab: _dropped, ...query } = route.query;
  return { ...route, query };
}
// An old hash, or one with a query value the page does not know, is rewritten in place (no history entry, no second
// hashchange) and the route it stands for renders.
function readRoute() {
  const to = R.redirectOf(location.hash);
  const route = knownTab(R.parseHash(to || location.hash)), want = R.routeHash(route);
  const fix = (to || location.hash.includes("?")) && want !== location.hash;
  if (fix && globalThis.history && history.replaceState) history.replaceState(null, "", want);
  state.route = route;
}
// The Display button says whether its popover is open (the popover attribute alone does not set aria-expanded everywhere).
$("display-open").setAttribute("aria-expanded", "false");
$("prefs").addEventListener("toggle", (e) => $("display-open").setAttribute("aria-expanded", String(e.newState === "open")));
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
