"use strict";
// All data reaches the DOM through text nodes only (never as HTML strings), so data can never become markup.
// Core of the portal UI: helpers, API access, charts, routing, navigation, language and the search palette. Pages live
// in page-*.js and boot.js starts everything (plan N11).
const token = document.querySelector('meta[name="portal-token"]').content;
const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const R = globalThis.AmautaRoute, MD = globalThis.AmautaMarkdown, TH = globalThis.AmautaTheme, I = globalThis.AmautaI18n; // i18n.js, theme.js, markdown.js and wikiroute.js load first (see index.html)
const { t, tn, ts } = I; // t(key, params): portal chrome; tn(key, n, params): plural; ts(text): English text sent by the server (see i18n.js)
// The sidebar, the tabs and the breadcrumb are built from the navigation model in wikiroute.js (R.NAV, R.crumbs).
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
// Counts the server wrote into its text ("1446 calls", "opus (1777)") grouped like every other number (session titles go
// through sessionTitle instead: they can quote the user's first prompt).
const groupDigits = (text) => String(text).replace(/(?<![\w.,:\/-])\d{4,}(?![\w.,:\/-])/g, (m) => fmt(Number(m)));
// Short counts; the units come from the dictionary: Spanish says "2,4 mil M", since "billón" (B) is 10^12 there.
const short = (n) => (n >= 1e9 ? t("num.billions", { n: R.fmtDecimal(n / 1e9, 1) }) : n >= 1e6 ? R.fmtDecimal(n / 1e6, 1) + "M"
  : n >= 1e3 ? R.fmtDecimal(n / 1e3, 1) + "k" : fmt(n || 0));
const bytes = (n) => (n == null ? "-" : n < 1024 ? `${fmt(n)} B` : n < 1048576 ? `${R.fmtDecimal(n / 1024, 1)} KB` : `${R.fmtDecimal(n / 1048576, 1)} MB`);
const pct = (r) => (r == null ? "-" : R.fmtPercent(r));
const words = () => ({ na: t("common.na"), tokens: t("unit.tokens"), pp: t("unit.pp") }); // unit words for R.fmtMetric / R.fmtDelta
// An enum value the server sends (a memory type, a redaction kind ...) shown with its label; a value without one is shown as sent.
const enumLabel = (prefix, v) => (`${prefix}.${v}` in I.dict.en ? t(`${prefix}.${v}`) : v);
const memType = (v) => (v ? enumLabel("memtype", v) : "-");
const plainReason = (e) => String((e && e.message) || e);
// A request that never reached the server, in words; the browser's own text rides along as the detail.
const netError = (err) => t("error.network", { reason: plainReason(err) });
// A part of a page that failed (a diagram, a list): one translated line, the raw reason as a muted detail.
const errorNote = (err) => h("p", { class: "warn", role: "alert" }, `▲ ${t("error.part")} `, h("span", { class: "muted tok" }, plainReason(err)));

async function api(path, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const r = await fetch(`/api/${path}${q.toString() ? "?" + q : ""}`, { headers: { Accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ? ts(body.error) : t("common.http", { status: r.status }));
  return body;
}


// Mermaid is vendored (/static/mermaid.min.js, no CDN) and loaded on first use. Source text is generated server-side with every label
// escaped, and mermaid itself runs with securityLevel "strict"; the SVG it returns is parsed into an inert document and adopted as nodes, never assigned as an HTML string.
let mermaidReady = null, mermaidKey = "";
const MERMAID_CONFIG = { startOnLoad: false, securityLevel: "strict", theme: "base", suppressErrorRendering: true };
// Diagram colors: the current theme's tokens as hex (Mermaid's theme engine reads hex only), so a dark page gets a dark diagram.
const rootStyle = () => (globalThis.getComputedStyle ? getComputedStyle(document.documentElement) : null);
const tokenHex = (css, name) => TH.toHex((css && css.getPropertyValue(`--${name}`).trim()) || "") || TH.toHex(TH.BASES.light[name]);
function mermaidTheme() {
  const css = rootStyle(), tok = (name) => tokenHex(css, name);
  const [bg, surface, ink, muted, line] = ["bg", "surface", "ink", "ink-muted", "line"].map(tok);
  return { darkMode: TH.luminance(bg) < 0.2, background: bg, primaryColor: surface, secondaryColor: surface, tertiaryColor: bg,
    primaryBorderColor: muted, primaryTextColor: ink, textColor: ink, nodeTextColor: ink, lineColor: muted, clusterBkg: bg,
    clusterBorder: line, edgeLabelBackground: bg, fontSize: "13px",
    fontFamily: (css && css.getPropertyValue("--sans").trim()) || "sans-serif" };
}
// (Re)initializes Mermaid when the theme's colors differ from the ones it was last given; true when they changed.
function syncMermaidTheme(mermaid) {
  const vars = mermaidTheme(), key = JSON.stringify(vars);
  if (key === mermaidKey) return false;
  mermaid.initialize({ ...MERMAID_CONFIG, themeVariables: vars });
  mermaidKey = key;
  return true;
}
// The server's classDef lines carry light hex colors: each known class is redrawn as fill / stroke / text tokens of the theme.
const CLASS_TOKENS = { root: ["surface", "ink"], group: ["surface", "line"], done: ["surface", "ok"], pending: ["surface", "warn"],
  blocked: ["surface", "warn"], start: ["surface", "c-input"] };
function themedSource(source) {
  const css = rootStyle();
  return String(source).replace(/^(\s*classDef (\w+) )(.*)$/gm, (line, head, name, props) => {
    if (!Object.prototype.hasOwnProperty.call(CLASS_TOKENS, name)) return line;
    const [fill, stroke] = CLASS_TOKENS[name], want = { fill, stroke, color: "ink" };
    const prop = (p) => { const k = p.split(":")[0]; return want[k] ? `${k}:${tokenHex(css, want[k])}` : p; };
    return head + props.split(",").map(prop).join(",");
  });
}
// The server writes its diagram labels in English: a quoted label the server catalog knows (ts) is swapped for its translation,
// decoded from and encoded back to the entity codes diagrams.py writes, so a translation never adds Mermaid syntax. Any other
// label (user text, a Markdown diagram) is left byte for byte.
function localizedSource(source) {
  if (I.lang() === "en") return source;
  const decode = (s) => s.replace(/#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
  const encode = (s) => s.replace(/[#"<>`[\](){}|;\\&%]/g, (c) => `#${c.charCodeAt(0)};`);
  return String(source).replace(/"([^"\n]*)"/g, (m, text) => { const out = ts(decode(text)); return out === decode(text) ? m : `"${encode(out)}"`; });
}
function loadMermaid() {
  mermaidReady ||= new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = "/static/mermaid.min.js";
    tag.onload = () => resolve(window.mermaid);
    tag.onerror = () => { mermaidReady = null; reject(new Error(t("diagram.loadFailed"))); };
    document.head.append(tag);
  });
  return mermaidReady;
}
let mermaidSeq = 0;
// natural: keep the drawing at its own width (the caller wraps it in a sideways scroller) instead of shrinking it to fit.
async function drawMermaid(source, into, natural) {
  try {
    const mermaid = await loadMermaid();
    syncMermaidTheme(mermaid);
    const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, localizedSource(themedSource(source)));
    // Parsed into an inert document (no script runs, no resource loads), then only the <svg> element is adopted. HTML parsing, not XML:
    // flowchart labels carry HTML inside <foreignObject>, which is not well-formed XML.
    const root = new DOMParser().parseFromString(svg, "text/html").body.querySelector("svg");
    if (!root) throw new Error(t("diagram.notSvg"));
    const drawn = document.importNode(root, true);
    const w = natural && drawn.viewBox && drawn.viewBox.baseVal ? drawn.viewBox.baseVal.width : 0;
    if (w) { drawn.style.maxWidth = "none"; drawn.style.setProperty("--natural-width", `${Math.ceil(w)}px`); } // CSS picks fit or natural
    into.replaceChildren(drawn);
  } catch (err) {
    into.replaceChildren(h("p", { class: "warn" }, t("diagram.error", { reason: plainReason(err).split("\n")[0] })), h("pre", { class: "text" }, source));
  }
}
// The diagrams drawn so far: a theme change draws them again in the new colors. A box is built before its page is shown, so
// only a drawn box that has left the page is dropped.
let diagrams = [];
const gone = (d) => d.drawn && d.box.isConnected === false;
function diagramBox(source, caption, natural) {
  const box = h("div", { class: "diagram scroll", role: "img", "aria-label": caption || t("diagram.label") }, h("p", { class: "muted" }, t("common.rendering")));
  const entry = { box, source, natural, drawn: false };
  diagrams = diagrams.filter((d) => !gone(d)).concat(entry);
  drawMermaid(source, box, natural).then(() => { entry.drawn = true; });
  return box;
}
async function redrawDiagrams() {
  if (!mermaidReady || !diagrams.length) return;
  const mermaid = await mermaidReady.catch(() => null);
  if (!mermaid || !syncMermaidTheme(mermaid)) return; // not loaded, or the same colors: nothing to draw again
  diagrams = diagrams.filter((d) => !gone(d));
  for (const d of diagrams) drawMermaid(d.source, d.box, d.natural);
}
try { globalThis.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawDiagrams); } catch (_) { /* no matchMedia */ }

const state = { route: { kind: "home", id: "" }, shown: null, memSource: "own", graphRepo: null, usageCache: false, sort: {}, projectNames: [], themes: [],
  themeChoice: TH.loadChoice(TH.storage()), themeDraft: null, preview: null };
// A session title the server composes ("repo · <model>, N messages · date"): the count part in the UI language, digits grouped.
const sessionTitle = (title) => String(title).split(" · ").map((part) => {
  const m = /^(.*), (\d+) messages?$/.exec(part);
  if (!m) return part;
  return `${m[1] === "unknown model" ? t("graph.unknownModel") : m[1]}, ${tn("usage.messagesN", Number(m[2]), { n: fmt(Number(m[2])) })}`;
}).join(" · ");
const itemTitle = (kind, title) => (kind === "session" && typeof title === "string" ? sessionTitle(title) : title);
const link = (kind, id, label, attrs, source) => h("a", { href: R.formatHash(kind, id, { source }), ...attrs }, itemTitle(kind, label));
const filters = () => ({ days: $("days").value, project: $("project").value, runtime: $("runtime").value });
const runtimeName = (v) => (v === "codex" ? t("filters.codex") : t("filters.claude")); // anything that is not Codex was written by Claude Code
const runtimeBadge = (v) => h("span", { class: `badge rt-${v === "codex" ? "codex" : "claude"}` }, runtimeName(v));

function card(label, value, extra) { return h("div", { class: "card" }, h("div", { class: "v" }, value), h("div", { class: "l" }, label), extra); }
function panel(title, ...kids) { return h("section", { class: "panel" }, title ? h("h2", null, title) : null, ...kids); }
function empty(text) { return h("p", { class: "muted" }, text); }
// Server notes mark commands with `backticks`: show those parts as code, as text nodes like everything else (plan N12h).
const codeSpans = (text) => String(text).split("`").map((part, i) => (i % 2 ? h("code", null, part) : part));

// A wide element (a table) scrolls sideways in its own keyboard-reachable box; the page keeps the vertical scroll.
const scrollBox = (el, label) => h("div", { class: "scroll", tabindex: 0, role: "region", "aria-label": label || t("table.label") }, el);
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

// A session's model: the one with the most messages, "+N" when others answered too (the session page lists them all).
const mainModel = (v, row) => (row.models > 1 ? `${v} +${row.models - 1}` : v ?? "-");
// The session table's columns (#/session and a project's Sessions tab, which drops Project): the id links to its page.
function sessionColumns({ project = true } = {}) {
  const nums = [["messages", t("col.msgs")], ["input", t("tok.input")], ["output", t("tok.output")], ["cache_read", t("tok.cache_read")],
    ["cache_write", t("tok.cache_write")]].map(([key, label]) => ({ key, label, num: true }));
  return [{ key: "session_id", label: t("kind.session"), render: (v) => link("session", v, String(v).slice(0, 8)) },
    { key: "runtime", label: t("col.runtime"), render: runtimeBadge }, project ? { key: "project", label: t("kind.project") } : null,
    { key: "last_ts", label: t("col.lastActivity") }, { key: "model", label: t("col.model"), render: mainModel }, ...nums].filter(Boolean);
}

const VIEWS = () => ({ home: viewHome, project: viewProjects, usage: viewOverview, skill: viewCatalog, tool: viewTools, mcp: viewTools,
  component: viewCatalog, session: viewSessions,
  memory: viewMemories, memfile: viewMemoryFiles, feature: viewFeatures, node: viewGraph, harness: viewHarness, settings: viewSettings,
  lint: viewLint, security: viewSecurity, pipelines: viewPipelines, guide: viewGuide });
async function renderRoute(route) {
  const { kind, id } = route;
  if (kind === "unknown") return [teach(t("route.notPage"), t("route.noMatch", { id }))];
  if (id && kind === "project") return viewProjectHub(route); // one project = one place, its views in ?tab=
  if (id && WIKI_KINDS.includes(kind)) return viewWikiPage(kind, id, route.source);
  const out = await VIEWS()[kind](route); // a view that needs the item (the guide's page) or its ?seg= reads it from the route
  const tabs = tabBar(route);
  const head = pageHead(t(PAGE_TITLES[kind] ?? `nav.${kind}`)); // the Activity filter bar itself says the range, project and runtime
  const page = out.some(hasTitle) ? out : [head, ...out];
  if (!tabs) return page;
  // One page-head pattern: title (with its lead), then the tabs, then the content.
  const at = page.findIndex((n) => /\bpage-head\b/.test(String((n && n.className) || "")));
  const after = at < 0 ? 0 : at + 1 + (page[at + 1] && /\blead\b/.test(String(page[at + 1].className || "")) ? 1 : 0);
  return [...page.slice(0, after), tabs, ...page.slice(after)];
}
// Every page opens with exactly one title (impeccable critique, plan N12b); views that build their own h1 keep it.
const PAGE_TITLES = { harness: "nav.harnessPage", tool: "nav.toolsSkills", mcp: "nav.toolsSkills", component: "nav.catalog" };
const isH1 = (n) => String(n.tagName).toLowerCase() === "h1";
const hasTitle = (n) => Boolean(n && n.tagName) && (isH1(n) || Array.from(n.children || []).some(hasTitle));
// The first h1 of the rendered page: the browser tab title follows it.
function firstH1(nodes) {
  for (const n of nodes) {
    if (!n || !n.tagName) continue;
    const hit = isH1(n) ? n : firstH1(Array.from(n.children || []));
    if (hit) return hit;
  }
  return null;
}
function pageHead(title, intro) {
  return h("header", { class: "page-head" }, h("h1", null, title), intro ? h("p", { class: "lead" }, intro) : null);
}

// The sidebar: one block per job group (R.NAV) with its label; the foot group (Guide, Settings) sits apart at the bottom.
function renderNav(route) {
  const hub = R.hubOf(route);
  const item = (i) => h("li", null, h("a", { href: i.hash, "aria-current": i.hub === hub ? "page" : false }, t(i.key)));
  const bare = (g) => g.items.length === 1 && t(g.key) === t(g.items[0].key); // "Today" needs no title above "Today"
  const group = (g) => (g.foot || bare(g)
    ? h("div", { class: `nav-group${g.foot ? " nav-foot" : ""}`, role: "group", "aria-label": t(g.key) }, h("ul", null, g.items.map(item)))
    : h("div", { class: "nav-group", role: "group", "aria-labelledby": `nav-g-${g.id}` },
      h("p", { class: "nav-title muted", id: `nav-g-${g.id}` }, t(g.key)), h("ul", null, g.items.map(item))));
  $("nav").replaceChildren(...R.NAV.map(group));
}
// The tabs of a sidebar page, on its list routes only (an item page has the breadcrumb instead).
function tabBar(route) {
  const hub = R.NAV.flatMap((g) => g.items).find((i) => i.hub === R.hubOf(route.kind));
  const tabs = (hub && hub.tabs) || [];
  if (route.id || tabs.length < 2 || !tabs.some((x) => x.kind === route.kind)) return null;
  const tab = (x) => link(x.kind, "", t(x.key), { "aria-current": x.kind === route.kind ? "page" : false });
  return h("nav", { class: "tabs", "aria-label": t("nav.tabs") }, tabs.map(tab));
}
// The breadcrumb above the page title: group, hub (or tab), item; the last crumb is the current page. Text nodes only.
function crumbBar(route) {
  const full = R.crumbs(route), end = full.length - 1;
  if (!full.length) return null;
  const name = (c, i) => (c.key ? t(c.key) : i === end && state.pageTitle ? state.pageTitle : c.text); // an item says its own title
  const labels = full.map(name);
  const trail = full.filter((c, i) => i === end || labels[i] !== labels[i + 1]); // a group named like its only page is said once
  const last = trail.length - 1;
  const crumb = (c, i) => {
    const label = labels[full.indexOf(c)];
    const here = i === last ? "page" : false;
    return h("li", null, c.hash && !here ? h("a", { href: c.hash }, label) : h("span", { "aria-current": here }, label));
  };
  return h("nav", { class: "crumbs", "aria-label": t("nav.breadcrumb") }, h("ol", null, trail.map(crumb)));
}
// A page that failed to load: what happened, where, and two ways on (try again, or go to Today).
function errorPanel(route, err) {
  const retry = h("button", { type: "button", onclick: () => { state.shown = null; render(); } }, t("error.retry"));
  return h("section", { class: "panel error-panel", role: "alert" }, h("h2", null, t("common.error")),
    h("p", { class: "warn" }, t("error.lead")),
    h("p", { class: "muted" }, t("error.route", { route: R.routeHash(route) }), " ", h("span", { class: "tok" }, plainReason(err))),
    h("div", { class: "controls" }, retry, h("a", { href: "#/", class: "button" }, t("error.home"))));
}

// "Data as of": how fresh the imported usage on an Activity page is (T11 i), from the newest timestamp its API returned.
function dataAsOf(stamps) {
  const at = stamps.filter(Boolean).sort().at(-1);
  $("data-at").textContent = at ? t("data.asOf", { at: R.fmtDateTime(at) }) : "";
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const route = state.route;
  const key = `${route.kind}/${route.id}/${route.source || ""}`;
  const changed = state.shown !== key;
  renderNav(route);
  if (!onAppearance(route)) { state.preview = null; state.themeDraft = null; applyTheme(); } // leaving the editor ends its preview
  $("filters").hidden = !R.showsFilters(route);
  if (typeof syncFilterFold === "function") syncFilterFold(); // boot.js; also re-says the summary after a language change
  $("data-at").textContent = "";
  setNav(false); // navigating closes the phone menu (boot.js)
  document.title = `${R.KINDS[route.kind] ? t(`kind.${route.kind}`) : "amauta"} - amauta`;
  if (changed) { $("view").setAttribute("aria-busy", "true"); $("view").replaceChildren(skeleton()); }
  state.pageTitle = null;
  try {
    const nodes = await renderRoute(route);
    if (seq !== renderSeq) return;
    $("view").replaceChildren(...[crumbBar(route), ...nodes].filter(Boolean));
    const title = firstH1(nodes);
    const name = title && title.textContent;
    if (name) document.title = `${name === "amauta" ? `${kindLabel(route.kind)} ${name}` : name} - amauta`; // never "amauta - amauta"
    state.shown = key;
    if (changed && $("view").focus) $("view").focus({ preventScroll: true });
  } catch (err) {
    if (seq !== renderSeq) return;
    $("view").replaceChildren(...[crumbBar(route), tabBar(route), errorPanel(route, err)].filter(Boolean)); // the tabs stay usable
    state.shown = key;
  } finally {
    if (seq === renderSeq) $("view").setAttribute("aria-busy", "false");
  }
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
const STATIC_TEXT = [["skip", "chrome.skip"], ["view-loading", "chrome.loading"], ["display-open", "chrome.display"], ["nav-toggle", "chrome.menu"], ["search-text", "chrome.search"],
  ["range-label", "filters.range"], ["opt-7", "filters.d7"], ["opt-30", "filters.d30"], ["opt-90", "filters.d90"], ["opt-365", "filters.d365"], ["opt-3650", "filters.d3650"], ["opt-all-projects", "filters.allProjects"], ["project-label", "filters.project"],
  ["runtime-label", "filters.runtime"], ["opt-all-runtimes", "filters.allRuntimes"], ["opt-claude", "filters.claude"], ["opt-codex", "filters.codex"],
  ["refresh", "chrome.refresh"], ["theme-label", "chrome.theme"], ["theme-edit", "chrome.editThemes"], ["lang-label", "chrome.language"], ["palette-hint", "palette.hint"]];
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
