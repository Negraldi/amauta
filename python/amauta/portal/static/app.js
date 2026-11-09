"use strict";
// All data reaches the DOM through text nodes only (never as HTML strings), so data can never become markup.
// Core of the portal UI: helpers, API access, charts, routing, navigation, language and the search palette. Pages live
// in page-*.js and boot.js starts everything (plan N11).
const token = document.querySelector('meta[name="portal-token"]').content;
const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const R = globalThis.AmautaRoute, MD = globalThis.AmautaMarkdown, TH = globalThis.AmautaTheme, I = globalThis.AmautaI18n; // i18n.js, theme.js, markdown.js and wikiroute.js load first (see index.html)
const { t, tn, ts } = I; // t(key, params): portal chrome; tn(key, n, params): plural; ts(text): English text sent by the server (see i18n.js)
// The sidebar: six pages (ADR 0005); each links to its hub route, and the page's other routes show as tabs.
const SECTIONS = [["home", "#/home", "nav.home"], ["project", "#/project", "nav.project"], ["memory", "#/memory", "nav.memory"],
  ["activity", "#/activity", "nav.activity"], ["harness", "#/harness", "nav.harnessPage"], ["security", "#/security", "nav.security"],
  ["settings", "#/settings", "nav.settings"]];
const TAB_LABELS = { usage: "nav.usage", session: "nav.session", tool: "nav.tool", mcp: "nav.mcp", project: "nav.project",
  feature: "nav.feature", node: "nav.node", memory: "nav.memory", lint: "nav.lint", harness: "nav.harnessPage", skill: "nav.skill",
  component: "nav.component", settings: "nav.settings", themes: "nav.themes", pipelines: "nav.pipelines", guide: "nav.guide" };
const KINDS = [["input", "tok.input"], ["output", "tok.output"], ["cache_read", "tok.cache_read"], ["cache_write", "tok.cache_write"]];
const kindLabel = (kind) => (Object.prototype.hasOwnProperty.call(R.KINDS, kind) ? t(`kind.${kind}`) : kind);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(...(kid instanceof Node ? [kid] : textNodes(String(kid))));
  return el;
}
// Plain text, except that every formatted date or date-time sits in its own nowrap span so it never breaks inside the token.
function textNodes(text) {
  return R.splitDates(text).map((p) => {
    if (!p.date) return document.createTextNode(p.text);
    const span = document.createElement("span");
    span.className = "date";
    span.append(document.createTextNode(p.text));
    return span;
  });
}
// A file path: mono text with a <wbr> after each slash; one very long segment may still break anywhere (.tok).
function pathNode(value) {
  const kids = [];
  for (const seg of R.pathSegments(value)) {
    if (seg === "/") kids.push(document.createTextNode("/"), document.createElement("wbr"));
    else kids.push(R.isLongToken(seg) ? h("span", { class: "tok" }, seg) : document.createTextNode(seg));
  }
  return h("span", { class: "path" }, kids);
}
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmt = (n) => R.fmtNumber(n);
const short = (n) => (n >= 1e9 ? R.fmtDecimal(n / 1e9, 1) + "B" : n >= 1e6 ? R.fmtDecimal(n / 1e6, 1) + "M" : n >= 1e3 ? R.fmtDecimal(n / 1e3, 1) + "k" : fmt(n || 0));
const pct = (r) => (r == null ? "-" : R.fmtPercent(r));
const words = () => ({ na: t("common.na"), tokens: t("unit.tokens"), pp: t("unit.pp") }); // unit words for R.fmtMetric / R.fmtDelta
const plainReason = (e) => String((e && e.message) || e);

async function api(path, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const r = await fetch(`/api/${path}${q.toString() ? "?" + q : ""}`, { headers: { Accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ? ts(body.error) : t("common.http", { status: r.status }));
  return body;
}


// Mermaid is vendored (/static/mermaid.min.js, no CDN) and loaded on first use. Source text is generated server-side with every label
// escaped, and mermaid itself runs with securityLevel "strict"; the SVG it returns is parsed into an inert document and adopted as nodes, never assigned as an HTML string.
let mermaidReady = null;
// Diagram colors: the sRGB of style.css's light OKLCH tokens (Mermaid's theme engine reads hex only); the font follows --sans.
const mermaidTheme = () => ({
  background: "#ffffff", primaryColor: "#ffffff", primaryBorderColor: "#4e5758", primaryTextColor: "#161f1f", lineColor: "#4e5758",
  clusterBkg: "#eff5f5", clusterBorder: "#d5dcdd", edgeLabelBackground: "#ffffff", tertiaryColor: "#dcf4f5", fontSize: "13px",
  fontFamily: (globalThis.getComputedStyle && getComputedStyle(document.documentElement).getPropertyValue("--sans").trim()) || "sans-serif",
});
function loadMermaid() {
  mermaidReady ||= new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = "/static/mermaid.min.js";
    tag.onload = () => {
      try {
        // The diagram always sits on a white card (see .diagram), so it uses the light portal tokens in both page themes.
        const config = { startOnLoad: false, securityLevel: "strict", theme: "base", suppressErrorRendering: true };
        window.mermaid.initialize({ ...config, themeVariables: mermaidTheme() });
        resolve(window.mermaid);
      } catch (err) { reject(err); }
    };
    tag.onerror = () => { mermaidReady = null; reject(new Error(t("diagram.loadFailed"))); };
    document.head.append(tag);
  });
  return mermaidReady;
}
let mermaidSeq = 0;
async function drawMermaid(source, into) {
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, source);
    // Parsed into an inert document (no script runs, no resource loads), then only the <svg> element is adopted. HTML parsing, not XML:
    // flowchart labels carry HTML inside <foreignObject>, which is not well-formed XML.
    const root = new DOMParser().parseFromString(svg, "text/html").body.querySelector("svg");
    if (!root) throw new Error(t("diagram.notSvg"));
    into.replaceChildren(document.importNode(root, true));
  } catch (err) {
    into.replaceChildren(h("p", { class: "warn" }, t("diagram.error", { reason: String(err.message || err).split("\n")[0] })), h("pre", { class: "text" }, source));
  }
}
function diagramBox(source, caption) {
  const box = h("div", { class: "diagram scroll", role: "img", "aria-label": caption || t("diagram.label") }, h("p", { class: "muted" }, t("common.rendering")));
  drawMermaid(source, box);
  return box;
}

const state = { route: { kind: "home", id: "" }, shown: null, usageKind: "skills", memSource: "own", sort: {}, projectNames: [], themes: [], themeChoice: TH.loadChoice(TH.storage()), themeDraft: null, preview: null };
const link = (kind, id, label, attrs, source) => h("a", { href: R.formatHash(kind, id, { source }), ...attrs }, label);
const filters = () => ({ days: $("days").value, project: $("project").value, runtime: $("runtime").value });
const runtimeName = (v) => (v === "codex" ? t("filters.codex") : t("filters.claude")); // anything that is not Codex was written by Claude Code
const runtimeBadge = (v) => h("span", { class: `badge rt-${v === "codex" ? "codex" : "claude"}` }, runtimeName(v));

function card(label, value, extra) { return h("div", { class: "card" }, h("div", { class: "v" }, value), h("div", { class: "l" }, label), extra); }
function panel(title, ...kids) { return h("section", { class: "panel" }, title ? h("h2", null, title) : null, ...kids); }
function empty(text) { return h("p", { class: "muted" }, text); }
// Server notes mark commands with `backticks`: show those parts as code, as text nodes like everything else (plan N12h).
const codeSpans = (text) => String(text).split("`").map((part, i) => (i % 2 ? h("code", null, part) : part));

// Sortable table: columns = [{key, label, num, render}], rows = array of objects.
function table(id, columns, rows, onRow) {
  const s = state.sort[id] || { key: columns.find((c) => c.num)?.key || columns[0].key, dir: -1 };
  const sorted = [...rows].sort((a, b) => {
    const x = a[s.key], y = b[s.key];
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
    return c * s.dir;
  });
  const head = h("tr", null, columns.map((c) => h("th", {
    class: c.num ? "n" : "", "data-key": c.key, tabindex: 0, "aria-sort": s.key === c.key ? (s.dir > 0 ? "ascending" : "descending") : "none",
    onclick: () => { state.sort[id] = { key: c.key, dir: s.key === c.key ? -s.dir : -1 }; render(); },
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.target.click(); } },
  }, c.label, s.key === c.key ? (s.dir > 0 ? " ▲" : " ▼") : "")));
  const body = sorted.map((r) => h("tr", null, columns.map((c) => h("td", { class: c.num ? "n" : "" },
    c.href ? h("a", { href: c.href(r) }, r[c.key]) : c.link && onRow ? h("button", { class: "row-link", type: "button", [c.attr || "data-row"]: "1", onclick: () => onRow(r) }, r[c.key]) : c.render ? c.render(r[c.key], r) : c.num ? fmt(r[c.key]) : R.fmtIso(r[c.key]) ?? "-"))));
  if (!rows.length) return empty(t("table.empty")); // a bare header row reads as a broken table (plan N12g)
  return h("div", { class: "scroll", tabindex: 0, role: "region", "aria-label": t("table.label") }, h("table", null, h("thead", null, head), h("tbody", null, body)));
}

function legend() { return h("div", { class: "legend" }, KINDS.map(([k, l]) => h("span", null, h("span", { class: `sw f-${k}` }), t(l)))); }

function stackedChart(daily) {
  if (!daily.length) return empty(t("usage.noneRange"));
  const W = 720, H = 220, L = 44, B = 22, T = 8, PR = 6;
  const totals = daily.map((d) => KINDS.reduce((a, [k]) => a + (d[k] || 0), 0));
  const max = Math.max(...totals, 1);
  const bw = (W - L - PR) / daily.length;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": t("usage.tokensPerDay") });
  for (const f of [0, 0.5, 1]) {
    const y = T + (H - T - B) * (1 - f);
    root.append(svg("line", { x1: L, x2: W - PR, y1: y, y2: y, class: "axis" }), svg("text", { x: L - 4, y: y + 4, "text-anchor": "end" }, short(max * f)));
  }
  daily.forEach((d, i) => {
    let y = H - B;
    const g = svg("g", null, svg("title", null, `${R.fmtDate(d.day)}: ` + KINDS.map(([k, l]) => `${t(l)} ${fmt(d[k])}`).join(", ")));
    for (const [k] of KINDS) {
      const hgt = ((d[k] || 0) / max) * (H - T - B);
      y -= hgt;
      if (hgt > 0) g.append(svg("rect", { x: L + i * bw + 1, y, width: Math.max(bw - 2, 1), height: hgt, class: `f-${k}` }));
    }
    root.append(g);
    if (daily.length <= 12 || i % Math.ceil(daily.length / 8) === 0) root.append(svg("text", { x: L + i * bw + bw / 2, y: H - 6, "text-anchor": "middle" }, R.fmtDate(d.day)));
  });
  return h("div", null, legend(), root);
}

function modelBars(models) {
  const total = models.reduce((a, m) => a + KINDS.reduce((s, [k]) => s + (m[k] || 0), 0), 0) || 1;
  return table("models", [
    { key: "model", label: t("col.model") }, { key: "messages", label: t("col.messages"), num: true },
    { key: "input", label: t("tok.input"), num: true }, { key: "output", label: t("tok.output"), num: true },
    { key: "cache_read", label: t("tok.cache_read"), num: true }, { key: "cache_write", label: t("tok.cache_write"), num: true },
    { key: "share", label: t("col.share"), num: true, render: (v) => pct(v) },
  ], models.map((m) => ({ ...m, share: KINDS.reduce((s, [k]) => s + (m[k] || 0), 0) / total })));
}

async function renderRoute(route, changed) {
  const { kind, id } = route;
  if (kind === "unknown") return [teach(t("route.notPage"), t("route.noMatch", { id }))];
  if (id && WIKI_KINDS.includes(kind)) return viewWikiPage(kind, id, route.source);
  if (changed && ["skill", "tool", "mcp"].includes(kind)) state.usageKind = { skill: "skills", tool: "tools", mcp: "mcp_servers" }[kind];
  const views = { home: viewHome, project: viewProjects, usage: viewUsagePage, skill: viewSkillCatalog, component: viewComponents, tool: viewUsage, mcp: viewUsage, session: viewSessions, memory: viewMemories, memfile: viewMemories, feature: viewFeatures, node: viewGraph, harness: viewHarness, settings: viewSettings, lint: viewLint, themes: viewThemes, security: viewSecurity, pipelines: viewPipelines, guide: viewGuide };
  const out = await views[kind](route); // a view that needs the item (the guide's page) reads it from the route
  const tabs = tabBar(route);
  const page = out.some(hasTitle) ? out : [pageHead(t(PAGE_TITLES[kind] ?? `nav.${kind}`)), ...out];
  return tabs ? [tabs, ...page] : page;
}
// Every page opens with exactly one title (impeccable critique, plan N12b); views that build their own h1 keep it.
const PAGE_TITLES = { harness: "nav.harnessPage" };
const isH1 = (n) => String(n.tagName).toLowerCase() === "h1";
const hasTitle = (n) => Boolean(n && n.tagName) && (isH1(n) || Array.from(n.children || []).some(hasTitle));
function pageHead(title, intro) {
  return h("header", { class: "page-head" }, h("h1", null, title), intro ? h("p", { class: "lead" }, intro) : null);
}

function renderNav(route) {
  const hub = R.hubOf(route.kind);
  const item = ([k, href, label]) => h("li", null, h("a", { href, "aria-current": k === hub ? "page" : false }, t(label)));
  $("nav").replaceChildren(h("ul", null, SECTIONS.map(item)));
}
// The tabs of a sidebar page, on its list routes only (an item page keeps its own breadcrumb).
function tabBar(route) {
  const tabs = R.HUBS[R.hubOf(route.kind)] || [];
  if (route.id || tabs.length < 2 || !tabs.includes(route.kind)) return null;
  const tab = (k) => link(k, "", t(TAB_LABELS[k]), { "aria-current": k === route.kind ? "page" : false });
  return h("nav", { class: "tabs", "aria-label": t("nav.tabs") }, tabs.map(tab));
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const route = state.route;
  const key = `${route.kind}/${route.id}/${route.source || ""}`;
  const changed = state.shown !== key;
  renderNav(route);
  if (route.kind !== "themes") { state.preview = null; state.themeDraft = null; applyTheme(); } // leaving the editor ends its preview
  $("filters").hidden = !R.showsFilters(route);
  $("shell").setAttribute("data-nav", "closed");
  $("nav-toggle").setAttribute("aria-expanded", "false");
  document.title = `${R.KINDS[route.kind] ? t(`kind.${route.kind}`) : "amauta"} - amauta`;
  if (changed) { $("view").setAttribute("aria-busy", "true"); $("view").replaceChildren(skeleton()); }
  try {
    const nodes = await renderRoute(route, changed);
    if (seq !== renderSeq) return;
    $("view").replaceChildren(...nodes);
    state.shown = key;
    if (changed && $("view").focus) $("view").focus({ preventScroll: true });
  } catch (err) {
    if (seq !== renderSeq) return;
    const error = panel(t("common.error"), h("p", { class: "warn" }, String(err.message || err)));
    $("view").replaceChildren(...[tabBar(route), error].filter(Boolean)); // the tabs stay usable
    state.shown = key;
  } finally {
    if (seq === renderSeq) $("view").setAttribute("aria-busy", "false");
  }
}

async function loadRecent() {
  const box = $("recent");
  try {
    const r = await api("wiki/recent", { limit: 12 });
    box.replaceChildren(r.items.length
      ? h("ul", { class: "refs" }, r.items.map((i) => h("li", null, link(i.kind, i.id, i.title), h("span", { class: "muted" }, ` ${ts(i.what)}, ${R.fmtDateTime(i.ts)}`))))
      : h("p", { class: "muted" }, t("recent.empty")));
  } catch (_) { box.replaceChildren(h("p", { class: "muted" }, t("recent.unavailable"))); }
}

function paintProjectSelect() {
  const cur = $("project").value;
  $("project").replaceChildren(h("option", { value: "" }, t("filters.allProjects")), ...state.projectNames.map((name) => h("option", { value: name }, name)));
  $("project").value = cur;
}
async function loadProjects() {
  try {
    const s = await api("sessions", { days: 3650, limit: 1 });
    state.projectNames = s.projects.map((p) => p.project);
    paintProjectSelect();
  } catch (_) { /* optional */ }
}

// ---- language: the static text of index.html is filled from the dictionary by id; everything else is built with t() when a route renders ----
const STATIC_TEXT = [["skip", "chrome.skip"], ["recent-title", "chrome.recent"], ["recent-loading", "chrome.loading"], ["view-loading", "chrome.loading"], ["nav-toggle", "chrome.menu"], ["search-text", "chrome.search"],
  ["range-label", "filters.range"], ["opt-7", "filters.d7"], ["opt-30", "filters.d30"], ["opt-90", "filters.d90"], ["opt-365", "filters.d365"], ["opt-3650", "filters.d3650"], ["opt-all-projects", "filters.allProjects"], ["project-label", "filters.project"],
  ["runtime-label", "filters.runtime"], ["opt-all-runtimes", "filters.allRuntimes"], ["opt-claude", "filters.claude"], ["opt-codex", "filters.codex"],
  ["refresh", "filters.refresh"], ["theme-label", "chrome.theme"], ["theme-edit", "chrome.editThemes"], ["lang-label", "chrome.language"], ["palette-hint", "palette.hint"]];
const STATIC_ATTR = [["sidebar", "aria-label", "chrome.wiki"], ["filters", "aria-label", "chrome.filters"], ["prefs", "aria-label", "chrome.appearance"], ["palette", "aria-label", "chrome.search"],
  ["palette-input", "placeholder", "palette.placeholder"], ["palette-input", "aria-label", "palette.label"], ["palette-results", "aria-label", "palette.results"]];
function applyStatic() {
  for (const [id, key] of STATIC_TEXT) { const el = $(id); if (el) el.textContent = t(key); }
  for (const [id, attr, key] of STATIC_ATTR) { const el = $(id); if (el) el.setAttribute(attr, t(key)); }
  $("lang-picker").value = I.lang();
}
// Everything a language change touches except the route itself: html lang, number locale, static text, pickers, the idle palette hint.
function applyLanguage(lang) {
  const chosen = I.setLang(lang);
  R.setLocale(I.locale(chosen, I.browserLanguage()));
  document.documentElement.setAttribute("lang", chosen);
  applyStatic();
  paintPicker();
  paintProjectSelect();
  if (!$("palette-input").value) $("palette-results").replaceChildren(h("p", { class: "muted" }, t("palette.hint")));
}
function setLanguage(lang) {
  I.saveLang(I.storage(), I.setLang(lang));
  applyLanguage(lang);
  render(); // the current route is built again in the new language; no reload, no navigation
}

// ---- search palette (native <dialog>) ---------------------------------------------------------------------------
const palette = { items: [], nodes: [], index: -1, seq: 0 };
function openPalette() {
  const dlg = $("palette");
  if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
  const input = $("palette-input");
  if (input.focus) input.focus();
  if (input.select) input.select();
}
function closePalette() {
  const dlg = $("palette");
  if (dlg.close) dlg.close(); else dlg.setAttribute("open", "false");
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
function paintResults(groups, q) {
  const box = $("palette-results");
  palette.items = R.flattenResults(groups);
  palette.nodes = [];
  if (!palette.items.length) { box.replaceChildren(h("p", { class: "muted" }, t("palette.noResults", { q }))); return; }
  let flat = 0;
  box.replaceChildren(...groups.map((g) => h("div", { class: "pal-group", role: "group", "aria-label": groupLabel(g.kind) }, h("div", { class: "pal-head" }, `${groupLabel(g.kind)} (${fmt(g.count)})`),
    g.items.map((it) => {
      const i = flat++;
      const node = h("div", { role: "option", id: `pal-${i}`, class: "pal-item", "aria-selected": "false", onclick: () => goResult(i) },
        h("span", { class: "pal-kind" }, groupLabel(g.kind)), h("span", { class: "pal-title" }, it.title), it.snippet ? h("span", { class: "pal-snip muted" }, it.snippet) : null);
      palette.nodes.push(node);
      return node;
    }))));
  selectResult(0);
}
async function runSearch() {
  const q = $("palette-input").value.trim();
  const seq = ++palette.seq;
  if (!q) { palette.items = []; palette.nodes = []; $("palette-results").replaceChildren(h("p", { class: "muted" }, t("palette.hint"))); return; }
  try {
    const r = await api("wiki/search", { q });
    if (seq === palette.seq) paintResults(r.groups, q);
  } catch (err) {
    if (seq === palette.seq) { palette.items = []; palette.nodes = []; $("palette-results").replaceChildren(h("p", { class: "warn" }, t("palette.failed", { reason: String(err.message || err) }))); }
  }
}
