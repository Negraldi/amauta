"use strict";
// Boot: wires the search palette, the filters, the theme and language pickers and the router, then renders the first page. Loaded last.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

let searchTimer = null;
$("palette-input").addEventListener("input", () => { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
$("palette-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (palette.items.length) selectResult(R.moveIndex(palette.index, e.key === "ArrowDown" ? 1 : -1, palette.items.length)); }
  else if (e.key === "Enter" && palette.index >= 0) { e.preventDefault(); goResult(palette.index); }
});
$("palette").addEventListener("click", (e) => { if (e.target === $("palette")) closePalette(); });
$("search-open").addEventListener("click", openPalette);
document.addEventListener("keydown", (e) => {
  const tag = String((e.target && e.target.tagName) || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select" || (e.target && e.target.isContentEditable);
  if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); openPalette(); }
  else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openPalette(); }
});

$("nav-toggle").addEventListener("click", () => {
  const open = $("shell").getAttribute("data-nav") !== "open";
  $("shell").setAttribute("data-nav", open ? "open" : "closed");
  $("nav-toggle").setAttribute("aria-expanded", String(open));
});
$("refresh").addEventListener("click", async () => {
  $("status").textContent = t("refresh.running");
  try {
    const r = await fetch("/api/refresh", { method: "POST", headers: { "X-Portal-Token": token } });
    const b = await r.json();
    $("status").textContent = r.ok ? t("refresh.done", { messages: fmt(b.messages), files: fmt(b.files) }) : t("refresh.failed", { reason: ts(b.error) });
    await loadProjects();
    loadRecent();
    render();
  } catch (err) { $("status").textContent = t("refresh.failed", { reason: err.message }); }
});
for (const id of ["days", "project", "runtime"]) $(id).addEventListener("change", render);
$("theme-picker").addEventListener("change", (e) => chooseTheme(e.target.value));
$("lang-picker").addEventListener("change", (e) => setLanguage(e.target.value));
window.addEventListener("hashchange", () => { state.route = R.parseHash(location.hash); render(); });
state.route = R.parseHash(location.hash);
// The dictionaries load first (plan N11b); a failed load still starts the page, in English keys at worst.
I.load(fetch).catch(() => {}).then(() => {
  applyLanguage(I.loadLang(I.storage()) || I.detect(I.browserLanguage())); // a stored choice wins over the browser language
  applyTheme();
  paintPicker();
  if (state.route.kind !== "themes") loadThemes(); // the editor page loads them itself
  loadRecent();
  loadProjects().then(render);
});
// Liveness signal: lets a launcher-started server exit once the window is gone. Failures are silent on purpose.
function heartbeat() { fetch("/api/heartbeat", { method: "POST", headers: { "X-Portal-Token": token } }).catch(() => {}); }
heartbeat();
setInterval(heartbeat, 10000);
