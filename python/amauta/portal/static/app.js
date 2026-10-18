"use strict";
// All data reaches the DOM through text nodes only (never as HTML strings), so data can never become markup.
const token = document.querySelector('meta[name="portal-token"]').content;
const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const R = globalThis.AmautaRoute, MD = globalThis.AmautaMarkdown, TH = globalThis.AmautaTheme, I = globalThis.AmautaI18n; // i18n.js, theme.js, markdown.js and wikiroute.js load first (see index.html)
const { t, tn, ts } = I; // t(key, params): portal chrome; tn(key, n, params): plural; ts(text): English text sent by the server (see i18n.js)
const SECTIONS = [
  ["nav.knowledge", [["home", "nav.home"], ["project", "nav.project"], ["memory", "nav.memory"], ["feature", "nav.feature"], ["node", "nav.node"]]],
  ["nav.harness", [["skill", "nav.skill"], ["tool", "nav.tool"], ["mcp", "nav.mcp"], ["component", "nav.component"], ["session", "nav.session"], ["harness", "nav.harnessPage"]]],
  ["nav.spending", [["usage", "nav.usage"]]],
  ["nav.manage", [["lint", "nav.lint"], ["themes", "nav.themes"], ["settings", "nav.settings"]]],
];
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
function loadMermaid() {
  mermaidReady ||= new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = "/static/mermaid.min.js";
    tag.onload = () => {
      try {
        // Always the light theme: the diagram sits on a white card (see .diagram), so label colors stay readable in a dark page too.
        window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default", suppressErrorRendering: true });
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
const filters = () => ({ days: $("days").value, project: $("project").value });

function card(label, value, extra) { return h("div", { class: "card" }, h("div", { class: "v" }, value), h("div", { class: "l" }, label), extra); }
function panel(title, ...kids) { return h("section", { class: "panel" }, title ? h("h2", null, title) : null, ...kids); }
function empty(text) { return h("p", { class: "muted" }, text); }

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

async function viewOverview() {
  const [o, c] = await Promise.all([api("overview", filters()), api("costs", filters())]);
  if (!o.available) return [panel(t("nav.usage"), empty(t("usage.nodata.refresh")))];
  const tot = o.totals;
  const out = [
    h("div", { class: "grid" },
      card(t("usage.inputTokens"), short(tot.input)), card(t("usage.outputTokens"), short(tot.output)), card(t("tok.cache_read"), short(tot.cache_read)), card(t("tok.cache_write"), short(tot.cache_write)),
      card(t("usage.cacheHit"), pct(o.cache_hit_ratio), h("div", { class: "l" }, t("usage.cacheHitHelp"))),
      card(t("col.messages"), fmt(tot.messages)), card(t("nav.session"), fmt(tot.sessions)),
      card(t("usage.events"), fmt(o.events), o.dropped_events ? h("div", { class: "l warn" }, t("usage.dropped", { n: fmt(o.dropped_events) })) : h("div", { class: "l" }, t("usage.droppedNone")))),
    panel(t("usage.tokensPerDay"), stackedChart(o.daily)),
    panel(t("usage.sessionsPerDay"), o.daily.length ? table("sessday", [{ key: "day", label: t("col.day") }, { key: "sessions", label: t("nav.session"), num: true }, { key: "messages", label: t("col.messages"), num: true }], o.daily) : empty(t("usage.noSessionsRange"))),
    panel(t("usage.modelSplit"), modelBars(o.models)),
  ];
  if (c.error) out.push(panel(t("cost.title"), h("p", { class: "warn" }, ts(c.error))));
  if (c.enabled) {
    out.push(panel(t("cost.title"), h("p", { class: "warn" }, ts(c.label)),
      c.invalid_prices && c.invalid_prices.length ? h("p", { class: "warn" }, t("cost.invalid", { models: c.invalid_prices.join(", ") })) : null,
      table("cost", [{ key: "model", label: t("col.model") }, { key: "cost", label: t("cost.estimated"), num: true, render: (v) => (v == null ? t("cost.noPrice") : R.fmtDecimal(v, 2)) }], c.models),
      h("p", null, t("cost.total"), " ", h("strong", null, R.fmtDecimal(c.total || 0, 2)))));
  }
  return out;
}

async function viewUsage() {
  const tl = await api("tools", filters());
  if (!tl.available) return [panel(t("nav.usage"), empty(t("usage.nodata")))];
  const kinds = [["skills", t("nav.skill")], ["tools", t("nav.tool")], ["mcp_servers", t("nav.mcp")], ["mcp_tools", t("usage.mcpTools")], ["subagents", t("usage.subagents")]];
  const linkKind = { skills: "skill", tools: "tool", mcp_servers: "mcp", mcp_tools: "tool" }[state.usageKind];
  const cols = [{ key: "name", label: t("col.name"), render: linkKind ? (v) => link(linkKind, v, v) : undefined }, { key: "count", label: t("col.calls"), num: true }, { key: "sessions", label: t("nav.session"), num: true }, { key: "last_used", label: t("col.lastUsed") }];
  return [
    h("div", { class: "tabs" }, kinds.map(([k, l]) => h("button", { type: "button", "aria-pressed": state.usageKind === k, onclick: () => { state.usageKind = k; render(); } }, `${l} (${fmt(tl[k].length)})`))),
    panel(kinds.find(([k]) => k === state.usageKind)[1], tl[state.usageKind].length ? table("usage-" + state.usageKind, cols, tl[state.usageKind]) : empty(t("usage.nothingRange"))),
  ];
}

async function viewSessions() {
  const s = await api("sessions", filters());
  if (!s.available) return [panel(t("nav.session"), empty(t("usage.nodata")))];
  const nums = [["messages", t("col.msgs")], ["input", t("tok.input")], ["output", t("tok.output")], ["cache_read", t("tok.cache_read")], ["cache_write", t("tok.cache_write")]].map(([key, label]) => ({ key, label, num: true }));
  return [
    panel(t("nav.project"), table("projects", [{ key: "project", label: t("kind.project"), link: true }, { key: "sessions", label: t("nav.session"), num: true }, ...nums], s.projects, (r) => { $("project").value = r.project; render(); })),
    panel(t("nav.session"), table("sessions", [{ key: "session_id", label: t("kind.session"), render: (v) => link("session", v, String(v).slice(0, 8)) }, { key: "project", label: t("kind.project") }, { key: "last_ts", label: t("col.lastActivity") }, { key: "model", label: t("col.model") }, ...nums], s.sessions)),
  ];
}

// Event handlers run outside render()'s try/catch: show the failure where the result would have gone.
function guarded(fn, into) {
  return async (...args) => {
    try { await fn(...args); } catch (err) { into.hidden = false; into.replaceChildren(h("p", { class: "warn" }, String(err.message || err))); }
  };
}

async function viewMemories() {
  const q = h("input", { type: "search", placeholder: t("mem.search"), "aria-label": t("mem.search"), value: state.memQuery || "" });
  const type = h("select", { "aria-label": t("col.type") }, h("option", { value: "" }, t("mem.allTypes")));
  const mine = h("div", null);
  const source = state.memSource;
  const load = guarded(async () => {
    state.memQuery = q.value;
    const r = await api("memories", { source, q: q.value, project: $("project").value, type: type.value });
    if (r.available && !type.dataset.ready) { r.facets.types.forEach((t) => type.append(h("option", { value: t }, t))); type.dataset.ready = "1"; }
    // A title is a link to the memory's wiki page (keyboard and middle-click work); the source rides along for other stores.
    mine.replaceChildren(r.available ? (r.items.length ? table("mem", [{ key: "title", label: t("col.title"), href: (row) => R.formatHash("memory", String(row.id), { source }) }, { key: "type", label: t("col.type") }, { key: "project", label: t("kind.project") }, { key: "topic_key", label: t("col.topic") }, { key: "revision", label: t("col.rev"), num: true }, { key: "updated_at", label: t("col.updated") }], r.items) : empty(t("mem.noMatch"))) : empty(source === "engram" ? t("mem.noEngram") : t("mem.noDb")));
  }, mine);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  type.addEventListener("change", load);
  await load();
  const files = await api("memory-files");
  return [
    h("div", { class: "tabs" }, [["own", t("mem.own")], ["engram", t("mem.engram")]].map(([k, l]) => h("button", { type: "button", "aria-pressed": state.memSource === k, onclick: () => { state.memSource = k; state.memQuery = ""; render(); } }, l))),
    panel(t("mem.searchPanel"), h("div", { class: "filters" }, q, type, h("button", { type: "button", onclick: load }, t("common.search"))), mine),
    panel(t("mem.files", { n: fmt(files.items.length) }), files.items.length ? table("mfiles", [{ key: "name", label: t("col.file"), href: (f) => R.formatHash("memfile", f.id) }, { key: "project", label: t("kind.project") }, { key: "size", label: t("col.bytes"), num: true }, { key: "mtime", label: t("col.modified") }], files.items) : empty(t("mem.noFiles"))),
    await graphifyPanel(),
  ];
}

function graphDiagram(repo, node, depth) {
  const box = h("div", null, h("p", { class: "muted" }, t("common.rendering")));
  api("graph/diagram", { repo, node, depth }).then((d) => {
    if (!d.source) box.replaceChildren(empty(t("graph.nothing")));
    else box.replaceChildren(diagramBox(d.source, t("graph.neighborsOfSelected")), d.truncated || d.nodes > 30 ? empty(t("graph.nearest", { shown: 30, total: fmt(d.nodes) })) : null);
  }).catch((err) => box.replaceChildren(h("p", { class: "warn" }, String(err.message || err))));
  return box;
}

// One block per --repo: stats, searchable node list, neighbors of the selected node. Data only ever becomes text.
function graphRepo(r) {
  if (!r.available) return { ready: null, el: h("div", null, h("h3", null, r.name), empty(r.reason ? ts(r.reason) : t("graph.notAvailable"))) };
  const q = h("input", { type: "search", placeholder: t("graph.searchNodes"), "aria-label": t("graph.searchNodesLabel") });
  const depth = h("select", { "aria-label": t("graph.depth") }, [1, 2, 3].map((d) => h("option", { value: String(d) }, t("graph.depthN", { n: d }))));
  const list = h("div", null);
  const near = h("div", null);
  const show = guarded(async (node) => {
    const g = await api("graph/neighbors", { repo: r.path, node: node.id, depth: depth.value });
    near.replaceChildren(h("h3", null, t("graph.neighborsOf", { name: node.label || node.id })), h("p", null, link("node", `${r.name}::${node.id}`, t("graph.openPage"))),
      table("gn-" + r.path, [{ key: "depth", label: t("graph.depth"), num: true }, { key: "label", label: t("col.label") }, { key: "kind", label: t("col.kind") }, { key: "file", label: t("col.file") }], g.nodes),
      h("h3", null, t("graph.diagramTitle")), graphDiagram(r.path, node.id, depth.value),
      g.edges.length ? table("ge-" + r.path, [{ key: "src", label: t("col.from") }, { key: "relation", label: t("col.relation") }, { key: "dst", label: t("col.to") }], g.edges) : empty(t("graph.noEdges")));
  }, near);
  const load = guarded(async () => {
    const g = await api("graph/nodes", { repo: r.path, q: q.value });
    list.replaceChildren(g.items.length ? table("gnodes-" + r.path, [{ key: "label", label: t("col.node"), link: true, attr: "data-graph" }, { key: "kind", label: t("col.kind") }, { key: "file", label: t("col.file") }], g.items, show) : empty(t("graph.noMatch")));
  }, list);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  const ready = load();
  return { ready, el: h("div", null, h("h3", null, r.name), h("p", { class: "muted" }, t("graph.stats", { nodes: fmt(r.nodes), edges: fmt(r.edges), mirrored: R.fmtDateTime(r.synced_at), file: R.fmtDateTime(r.graph_mtime), sql: fmt(r.sql_tables || 0) })),
    h("p", { class: "muted" }, t("graph.semantic", { pending: r.semantic_pending ? t("common.yes") : t("common.no"), last: r.semantic_at ? t("graph.lastRun", { at: R.fmtDateTime(r.semantic_at), model: r.semantic_model || t("graph.unknownModel") }) : t("common.never") })),
    h("div", { class: "filters" }, q, depth, h("button", { type: "button", onclick: load }, t("graph.searchGraph"))), list, near) };
}

// Graph memory is filled per project by graphify; when nothing is mirrored yet, say how, and list the projects that already have a graph.
function graphEmptyState(projects) {
  const mirrored = (projects || []).filter((p) => p.graph && p.graph.mirrored);
  return h("div", { class: "teach" },
    h("p", null, t("graph.how1"), " ", h("code", null, "amauta graphify hook install"), " ", t("graph.how2"), " ",
      h("code", null, "graphify update ."), " ", t("graph.how3"), " ", h("code", null, "graphify update ."), " ", t("graph.how4"), " ", h("code", null, "python3 -P -m amauta.graph sync --repo ."), "."),
    mirrored.length ? h("div", null, h("h3", null, t("graph.mirroredProjects")), h("ul", { class: "refs" }, mirrored.map((p) => h("li", null, link("project", p.name, p.name), h("span", { class: "muted" }, " " + t("graph.nodesEdges", { nodes: fmt(p.graph.nodes), edges: fmt(p.graph.edges) }))))))
      : h("p", { class: "muted" }, t("graph.noneMirrored")));
}

async function graphifyPanel() {
  const [g, pr] = await Promise.all([api("graphify"), api("projects").catch(() => null)]);
  const blocks = g.repos.map(graphRepo);
  await Promise.all(blocks.map((b) => b.ready));
  const anyReady = g.repos.some((r) => r.available);
  return panel(t("graph.panel"), ...(anyReady ? [] : [graphEmptyState(pr && pr.projects)]), ...blocks.map((b) => b.el));
}

// Harness architecture: the archify page lives on its own route with its own sandboxing CSP and is shown in a sandboxed iframe (scripts only, no
// same-origin), so the portal's script-src 'self' is untouched. Without node/archify the server sends the Mermaid text diagram instead.
function archifyBlock(d) {
  if (!d.installed) return null;
  if (d.available && /^\/archify\/[0-9a-f]{64}\.html$/.test(d.url)) {
    return panel(t("harness.architecture"), h("iframe", { class: "archify-frame", src: d.url, sandbox: "allow-scripts", title: t("harness.archifyTitle"), referrerpolicy: "no-referrer" }),
      h("p", { class: "muted" }, t("harness.drawn", { n: fmt(d.components) })));
  }
  return panel(t("harness.architecture"), d.fallback ? diagramBox(d.fallback, t("harness.installArch")) : null,
    h("p", { class: "muted" }, d.reason ? t("harness.fallbackReason", { reason: ts(d.reason) }) : t("harness.fallback")));
}

async function viewHarness() {
  const [hs, arch, comps] = await Promise.all([api("harness"), api("archify").catch(() => ({ installed: false })), api("harness/components").catch(() => null)]);
  const out = [];
  if (!hs.installed) out.push(panel(t("nav.harnessPage"), empty(t("harness.notInstalled"))));
  else {
    out.push(h("div", { class: "grid" }, card(t("harness.version"), hs.version || "-"), card(t("harness.rdd"), hs.rdd_mode || "-"), card(t("harness.telemetry"), hs.telemetry ? t("common.on") : t("common.off")), card(t("harness.managed"), fmt(hs.managed_files)), card(t("harness.persona"), hs.persona || "-")),
      archifyBlock(arch),
      ...(comps ? [panel(t("harness.wiki"), h("p", null, t("harness.wikiIntro", { n: fmt(comps.total) }) + " ", link("component", "", t("harness.openComponents")), "."),
        comps.pending ? h("p", null, tn("harness.pending", comps.pending, { n: fmt(comps.pending) })) : null)] : []),
      panel(t("harness.components"), empty((hs.components || []).join(", ") || t("common.none"))),
      panel(t("harness.hooks"), hs.hooks.length ? table("hooks", [{ key: "event", label: t("col.event") }, { key: "kind", label: t("col.kind") }], hs.hooks) : empty(t("harness.noHooks"))),
      panel(t("nav.mcp"), hs.mcp_servers.length ? table("mcp", [{ key: "name", label: t("col.name") }, { key: "type", label: t("col.type") }, { key: "command", label: t("col.command") }], hs.mcp_servers) : empty(t("common.noneDot"))));
  }
  return out.filter(Boolean); // archifyBlock is null when the install state is missing
}

// ---- wiki pages ---------------------------------------------------------------------------------------------
const WIKI_KINDS = ["project", "memory", "memfile", "skill", "tool", "mcp", "session", "feature", "node", "hook", "mcptool", "connector", "agent", "command", "plugin", "outputstyle"];
const HINTS = ["memory", "skill", "tool", "mcp", "session", "feature", "project", "node", "hook", "mcptool", "connector", "agent", "command", "plugin", "outputstyle"]; // each has a hint.<kind> text
const statusChip = (value) => h("span", { class: `chip chip-${value}` }, (value === "done" ? "● " : value === "pending" ? "○ " : "▲ ") + t(`status.${value}`));
const isStatus = (v) => v === "done" || v === "pending" || v === "warning";
// How a project was found (--repo flag, the Settings list, or discovery from sessions): the server sends the identifiers.
const originLabel = (o) => (`origin.${o}` in I.dict.en ? t(`origin.${o}`) : o);
const CHROME_ITEMS = ["Tokens in the sessions that used it"]; // server section whose item labels are fixed text

function skeleton() {
  return h("div", { class: "skeleton", "aria-hidden": "true" }, h("div", { class: "sk sk-title" }), h("div", { class: "sk" }), h("div", { class: "sk" }), h("div", { class: "sk sk-short" }));
}
function teach(title, ...paras) {
  return h("div", { class: "teach" }, h("h1", null, title), ...paras.map((p) => h("p", null, p)), h("p", null, link("home", "", t("common.backHome"))));
}
function refList(refs) {
  return h("ul", { class: "refs" }, refs.map((r) => h("li", null, link(r.kind, r.id, r.title, null, r.source), h("span", { class: "muted" }, ` ${kindLabel(r.kind)}`))));
}
function railBlock(title, body) { return body ? h("section", { class: "rail-block" }, h("h2", null, title), body) : null; }

function sectionBlock(s) {
  // Item labels that link to a page, or are user content (ODD task titles), stay as written; only the fixed token-row labels are translated.
  const label = (it) => (CHROME_ITEMS.includes(s.heading) ? ts(it.label) : it.label);
  return h("section", { class: "page-section" }, h("h2", null, ts(s.heading)), h("ul", { class: "items" }, s.items.map((it) => h("li", null,
    it.kind && it.id ? link(it.kind, it.id, it.label, null, it.source) : h("span", null, label(it)),
    it.value == null ? null : isStatus(it.value) ? statusChip(it.value) : h("span", { class: "muted" }, ` ${ts(R.fmtMeta(it))}`)))));
}

function historyBlock(hist) {
  if (!hist) return null;
  if (!hist.available) return h("section", { class: "page-section" }, h("h2", null, t("hist.title")), h("p", { class: "muted" }, ts(hist.note)));
  const revs = hist.revisions.map((r) => h("li", null, t("hist.revision", { n: r.revision }), r.title ? ` ${r.title}` : null, r.updated_at ? h("span", { class: "muted" }, ` ${R.fmtIso(r.updated_at)}`) : null));
  const diffs = hist.diffs.map((d) => h("details", null, h("summary", null, t("hist.fromTo", { from: d.from, to: d.to })),
    h("div", { class: "diff", role: "group", "aria-label": t("hist.changes", { from: d.from, to: d.to }) }, d.lines.map((ln) => { const r = R.diffRow(ln); return h("div", { class: `diff-line diff-${r.name}` }, r.mark + r.text); }))));
  return h("section", { class: "page-section" }, h("h2", null, t("hist.title")), h("p", { class: "muted" }, ts(hist.note)), h("ul", { class: "items" }, revs), ...diffs);
}

// Calls per day as small bars; the title text and a sentence carry the numbers, so color and shape are never the only signal.
function usageBlock(usage) {
  if (!usage) return null;
  const total = usage.daily.reduce((a, d) => a + d.value, 0);
  const last = usage.daily.length ? usage.daily[usage.daily.length - 1].day : "";
  if (!total) return h("section", { class: "page-section" }, h("h2", null, t("uot.title")), h("p", { class: "muted" }, t("uot.none")));
  const W = 360, H = 60;
  const bars = R.dailyBars(usage.daily, W, H);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H + 14}`, role: "img", "aria-label": t("uot.aria", { days: fmt(usage.days), last: R.fmtDate(last) }) },
    ...bars.map((b) => svg("g", null, svg("title", null, t("uot.bar", { day: R.fmtDate(b.day), n: fmt(b.value) })), svg("rect", { x: b.x, y: b.y, width: b.width, height: b.height, class: "f-input" }))),
    svg("line", { x1: 0, x2: W, y1: H, y2: H, class: "axis" }), svg("text", { x: 0, y: H + 11 }, R.fmtDate(bars[0].day)), svg("text", { x: W, y: H + 11, "text-anchor": "end" }, R.fmtDate(last)));
  return h("section", { class: "page-section" }, h("h2", null, t("uot.title")), h("p", { class: "muted" }, t("uot.summary", { n: fmt(total), days: fmt(usage.days), last: R.fmtDate(last) })), h("div", { class: "spark" }, root));
}

// ODD feature: a progress bar with its number, state chips (shape plus label) and the commits the document mentions that git could resolve.
function progressBlock(pg) {
  if (!pg.progress) return null;
  const p = R.progress(pg.progress.done, pg.progress.total);
  const pending = pg.progress.total - pg.progress.done;
  const label = t("progress.label", { done: fmt(pg.progress.done), total: fmt(pg.progress.total) });
  return h("section", { class: "progress-block", "aria-label": t("progress.aria") },
    h("progress", { max: Math.max(pg.progress.total, 1), value: pg.progress.done, "aria-label": label }),
    h("p", null, h("strong", null, label), ` (${fmt(p.percent)}%)`, statusChip("done"), ` ${fmt(pg.progress.done)}`, statusChip("pending"), ` ${fmt(pending)}`));
}

function commitsBlock(commits) {
  if (!commits || !commits.length) return null;
  return h("section", { class: "page-section" }, h("h2", null, t("commits.title")), h("ul", { class: "items" }, commits.map((c) => h("li", null, h("code", null, c.hash), ` ${c.subject}`, h("span", { class: "muted" }, ` ${R.fmtDate(c.date)}`)))));
}

// Graph node: the neighborhood diagram is drawn lazily (mermaid loads on first use) from source the server generated with every label escaped.
function nodeDiagramBlock(diagram) {
  if (!diagram || !diagram.source) return null;
  return h("section", { class: "page-section" }, h("h2", null, t("node.neighborhood")), diagramBox(diagram.source, t("node.neighborsOfThis")),
    diagram.truncated ? h("p", { class: "muted" }, t("graph.nearest", { shown: R.NODE_CAP, total: fmt(diagram.nodes) })) : null);
}

// ODD feature: tasks grouped by phase in a grid (shape + word + class carry the status); long documents are capped server-side.
function taskDiagramBlock(pg) {
  const d = pg.diagram;
  if (pg.kind !== "feature" || !d || !d.source) return null;
  return h("section", { class: "page-section" }, h("h2", null, t("grid.title")), diagramBox(d.source, t("grid.aria")),
    d.tasks > d.shown ? h("p", { class: "muted" }, t("grid.first", { shown: fmt(d.shown), total: fmt(d.tasks) })) : null);
}

// Skill impact (comparative): the metrics with their sample sizes, then the change log with before/after deltas. Direction is a shape plus words.
function markSpan(m) {
  const d = R.deltaMark(m);
  return h("span", { class: `mark mark-${d.name}` }, `${d.mark} ${t(`delta.${d.name}`)}`);
}
function impactRow(name, m) {
  const reason = m.suppressed ? h("div", { class: "muted" }, m.reason ? ts(m.reason) : t("impact.tooFew")) : null;
  return h("tr", null, h("td", null, ts(m.label), reason), h("td", { class: "n" }, R.fmtMetric(name, m.exposed.value, words())), h("td", { class: "n" }, R.fmtMetric(name, m.baseline.value, words())),
    h("td", null, markSpan(m), m.delta == null ? null : h("span", { class: "muted" }, ` ${R.fmtDelta(name, m.delta, words())}`)),
    h("td", { class: "n" }, `${fmt(m.exposed.n)} / ${fmt(m.baseline.n)}`));
}
function changeItem(c) {
  const head = c.kind === "installed" ? t("impact.installedVersion", { label: c.label }) : t("impact.commit", { label: c.label });
  const when = R.fmtDate(c.when || c.ts);
  const lines = c.suppressed ? [h("p", { class: "muted" }, c.reason ? ts(c.reason) : t("impact.tooFew"))] : Object.entries(c.metrics).filter(([, m]) => m.delta != null).map(([name, m]) =>
    h("li", null, t("impact.beforeAfter", { label: ts(m.label), before: R.fmtMetric(name, m.before, words()), after: R.fmtMetric(name, m.after, words()) }) + " ", markSpan(m), h("span", { class: "muted" }, " " + t("impact.n", { before: fmt(m.n_before), after: fmt(m.n_after) }))));
  return h("li", null, h("strong", null, head), h("span", { class: "muted" }, ", " + t("impact.sessionsAround", { when, before: fmt(c.before_sessions), after: fmt(c.after_sessions) })), c.suppressed ? lines[0] : h("ul", { class: "items" }, lines));
}
function impactBlock(im) {
  if (!im) return null;
  const title = h("h2", null, t("impact.title"));
  const note = h("p", { class: "note" }, ts(im.note));
  if (!im.available) return h("section", { class: "page-section impact" }, title, note, h("p", { class: "muted" }, im.reason ? ts(im.reason) : t("impact.noData")));
  if (!im.exposed_sessions) return h("section", { class: "page-section impact" }, title, note, h("p", { class: "muted" }, t("impact.notLoaded", { days: fmt(im.days) })));
  const scope = im.control_scope === "same-project" ? t("impact.sameProject") : t("impact.allProjects");
  const m = im.metrics, u = m.unused_after_load;
  const rows = ["error_rate", "retry_rate", "tokens_per_turn", "test_failure_rate"].map((k) => impactRow(k, m[k]));
  const ch = im.changes || { versions: [], commits: [], changes: [] };
  return h("section", { class: "page-section impact" }, title, note,
    h("p", null, t("impact.summary", { exposed: fmt(im.exposed_sessions), days: fmt(im.days), control: fmt(im.control_sessions), scope, min: fmt(im.min_sessions) })),
    im.outcomes_recorded ? null : h("p", { class: "muted" }, t("impact.noOutcomes")),
    h("table", { class: "compact" }, h("thead", null, h("tr", null, h("th", null, t("impact.metric")), h("th", { class: "n" }, t("impact.afterLoad")), h("th", { class: "n" }, t("impact.baseline")), h("th", null, t("impact.difference")), h("th", { class: "n" }, t("impact.nCalls")))), h("tbody", null, rows)),
    h("p", null, u.suppressed ? t("impact.unusedSuppressed", { n: fmt(u.n), reason: u.reason ? ts(u.reason) : t("impact.tooFewShare") }) : t("impact.unused", { unused: fmt(u.unused), n: fmt(u.n), rate: R.fmtMetric("rate", u.value, words()) })),
    h("h3", null, t("impact.changeLog")),
    ch.versions.length ? h("p", { class: "muted" }, t("impact.versions", { list: ch.versions.map((v) => `${v.hash}${v.current ? ` (${t("impact.current")})` : ""} ${R.fmtDate(v.first_seen)}`).join(", ") })) : null,
    ch.changes.length ? h("ul", { class: "items" }, ch.changes.map(changeItem)) : h("p", { class: "muted" }, t("impact.noChange")));
}

function pageExtras(pg) {
  return [usageBlock(pg.usage), pg.kind === "skill" ? impactBlock(pg.impact) : null, historyBlock(pg.history), commitsBlock(pg.commits), taskDiagramBlock(pg), pg.kind === "node" ? nodeDiagramBlock(pg.diagram) : null, oddDiagramsBlock(pg), projectGraphBlock(pg)];
}

function bodyNodes(pg, text = pg.body_md) {
  const known = (kind, id) => !(pg.missing || []).some((m) => m.kind === kind && m.id === id);
  let diagrams = 0;
  const mermaid = (src) => (++diagrams <= 5 ? diagramBox(src, t("diagram.mermaid")) : h("pre", { class: "code" }, h("code", null, src)));
  return MD.toDom(MD.parse(text), document, { known, mermaid, headingOffset: 1, labels: { missing: (kind, id) => t("md.missing", { kind, id }), table: t("table.label") } });
}

async function viewWikiPage(kind, id, source) {
  let pg;
  try { pg = await api("wiki/page", { kind, id, source }); } catch (err) {
    if (/not found|no encontrad/i.test(String(err.message))) return [teach(t("page.none", { kind: kindLabel(kind).toLowerCase() }), t("page.nothingStored", { id }), HINTS.includes(kind) ? t(`hint.${kind}`) : "")];
    throw err;
  }
  document.title = `${pg.title} - amauta`;
  const meta = pg.meta.length ? h("dl", { class: "meta" }, pg.meta.flatMap((m) => { const v = m.label === "Found by" ? String(m.value).split(", ").map(originLabel).join(", ") : ts(R.fmtMeta(m)); return [h("dt", null, ts(m.label)), R.isPathLike(v) ? h("dd", null, pathNode(v)) : h("dd", { class: R.isLongToken(v) ? "tok" : false }, v)]; })) : null;
  return [h("div", { class: "page" },
    h("article", { class: "doc" },
      h("p", { class: "kind" }, kindLabel(pg.kind)), h("h1", null, pg.title), progressBlock(pg), summaryBlock(pg.summary), pg.refresh ? refreshControl(pg.refresh.server) : null,
      pg.body_md ? h("div", { class: "prose" }, bodyNodes(pg)) : null,
      ...pg.sections.map(sectionBlock), explainBlock(pg), ...pageExtras(pg)),
    h("aside", { class: "rail", "aria-label": t("page.details") }, railBlock(t("page.detailsTitle"), meta), railBlock(t("page.links"), pg.links.length ? refList(pg.links) : null), railBlock(t("page.linkedFrom"), pg.backlinks.length ? refList(pg.backlinks) : null)))];
}

// Skill catalog: every skill the portal can describe, grouped by source; the filter works on what is already loaded.
async function viewSkillCatalog() {
  const cat = await api("skills");
  const list = h("div", null);
  const box = h("input", { type: "search", placeholder: t("skills.filter"), "aria-label": t("skills.filter"), value: state.skillQuery || "" });
  const paint = () => {
    state.skillQuery = box.value;
    const groups = R.filterSkills(cat.groups, box.value);
    list.replaceChildren(...(groups.length ? groups.map((g) => h("section", { class: "page-section" }, h("h2", null, `${ts(g.label)} (${fmt(g.items.length)})`),
      g.source === "builtin" ? h("p", { class: "muted" }, t("skills.builtinNote")) : null,
      h("ul", { class: "items" }, g.items.map((i) => h("li", null, link("skill", i.id, i.id), i.disabled ? h("span", { class: "muted" }, ` ${t("components.disabled")}`) : null,
        i.description ? h("div", null, i.description) : null,
        i.trigger ? h("div", { class: "muted" }, t("skills.triggers", { trigger: i.trigger })) : null,
        h("div", { class: "muted" }, i.uses ? t("skills.usage", { calls: fmt(i.uses), sessions: fmt(i.sessions), last: R.fmtDate(i.last_used) }) : t("skills.notUsed")))))))
      : [h("p", { class: "muted" }, cat.total ? t("skills.noMatch") : t("skills.none"))]));
  };
  box.addEventListener("input", paint);
  paint();
  return [h("h1", null, t("nav.skill")), h("p", { class: "muted" }, t("skills.intro", { n: fmt(cat.total) })),
    h("div", { class: "filters" }, box), list, ...(cat.total ? [] : [h("p", { class: "muted" }, t("skills.where"))])];
}

// A curated component carries its own Spanish text in `i18n.es`; every other text is the server's English (or the user's own words) run through ts().
const localized = (obj, field) => {
  const es = I.lang() === "es" && obj && obj.i18n && obj.i18n.es && obj.i18n.es[field];
  return es || ts(obj[field]);
};
// Refresh descriptions: a guarded POST asks the local command-based MCP servers for their tool lists; one line per server, then the page reloads
// in place. The result lines are remembered per page so they survive that reload.
const refreshLines = (res) => h("ul", { class: "plain-list" }, res.map((r) => h("li", null,
  r.ok ? t("refresh.ok", { server: r.server, n: fmt(r.tools) }) : r.skipped ? t("refresh.skipped", { server: r.server }) : t("refresh.serverFailed", { server: r.server, error: ts(r.error) }))));
function refreshControl(server) {
  const key = `${state.route.kind}/${state.route.id}`;
  const out = h("div", { class: "refresh-results", role: "status", "aria-live": "polite" });
  if (state.refreshLast && state.refreshLast.key === key) out.append(refreshLines(state.refreshLast.results));
  const btn = h("button", { type: "button" }, t("refresh.button"));
  btn.addEventListener("click", async () => {
    setDisabled(btn, true);
    out.replaceChildren(h("p", { class: "muted" }, t("refresh.busy")));
    try {
      const res = await postJson("/api/harness/refresh", server ? { server } : {});
      if (!res.ok) { out.replaceChildren(h("p", { class: "warn" }, t("refresh.refused", { reason: ts(res.data.error || t("common.http", { status: res.status })) }))); return; }
      state.refreshLast = { key, results: res.data.results };
      out.replaceChildren(refreshLines(res.data.results));
      render();
    } catch (err) {
      out.replaceChildren(h("p", { class: "warn" }, t("refresh.refused", { reason: plainReason(err) })));
    } finally { setDisabled(btn, false); }
  });
  return h("div", { class: "refresh" }, btn, " ", h("span", { class: "muted" }, t("refresh.help")), out);
}
// Request explanation: a guarded POST queues a request; Claude Code writes the note later (skill amauta-wiki-explain). The portal never calls a model.
function explainBlock(pg) {
  const ex = pg.explain;
  if (!ex) return null;
  const out = h("div", { class: "explain-status", role: "status", "aria-live": "polite" });
  const parts = [];
  if (ex.note) {
    parts.push(h("p", { class: "muted" }, t("explain.written", { at: R.fmtDateTime(ex.note.written_at) })), ex.note.stale ? h("p", { class: "warn" }, t("explain.stale")) : null,
      h("div", { class: "prose" }, bodyNodes(pg, ex.note.body_md)));
  } else if (!ex.pending) parts.push(h("p", { class: "muted" }, t("explain.none")));
  if (ex.pending) parts.push(h("p", null, t("explain.requested", { at: R.fmtDateTime(ex.pending.requested_at) })), h("p", { class: "muted" }, t("explain.pendingHelp")));
  else {
    const btn = h("button", { type: "button" }, t(ex.note ? "explain.requestNew" : "explain.request"));
    btn.addEventListener("click", async () => {
      setDisabled(btn, true);
      try {
        const res = await postJson("/api/harness/explain", { kind: pg.kind, id: pg.id });
        if (res.ok) { render(); return; }
        out.replaceChildren(h("p", { class: "warn" }, t("explain.refused", { reason: ts(res.data.error || t("common.http", { status: res.status })) })));
      } catch (err) {
        out.replaceChildren(h("p", { class: "warn" }, t("explain.refused", { reason: plainReason(err) })));
      }
      setDisabled(btn, false);
    });
    parts.push(btn);
  }
  return h("section", { class: "page-section explain" }, h("h2", null, t("explain.title")), ...parts, out);
}
const clip = (text) => (text.length > 220 ? `${text.slice(0, 217)}...` : text);
// Component catalog: every harness component grouped by kind; the filter works on what is already loaded.
async function viewComponents() {
  const cat = await api("harness/components");
  const list = h("div", null);
  const box = h("input", { type: "search", placeholder: t("components.filter"), "aria-label": t("components.filter"), value: state.componentQuery || "" });
  const paint = () => {
    state.componentQuery = box.value;
    const groups = R.filterComponents(cat.groups, box.value);
    list.replaceChildren(...(groups.length ? groups.map((g) => h("section", { class: "page-section" }, h("h2", null, `${ts(g.label)} (${fmt(g.items.length)})`),
      h("ul", { class: "items" }, g.items.map((i) => h("li", null, link(i.kind, i.id, i.title), h("span", { class: "muted" }, ` ${ts(i.source)}`), i.disabled ? h("span", { class: "muted" }, ` \u00b7 ${t("components.disabled")}`) : null,
        i.description ? h("div", null, clip(localized(i, "description"))) : null)))))
      : [h("p", { class: "muted" }, cat.total ? t("components.noMatch") : t("components.none"))]));
  };
  box.addEventListener("input", paint);
  paint();
  return [h("h1", null, t("nav.component")), h("p", { class: "muted" }, t("components.intro", { n: fmt(cat.total) })),
    ...(cat.refresh && cat.refresh.servers ? [refreshControl(null)] : []), h("div", { class: "filters" }, box), list, ...(cat.total ? [] : [h("p", { class: "muted" }, t("components.where"))])];
}

// "What it does": the skill's own description, when it triggers, where it comes from. Built-ins have no file and say so.
function summaryBlock(sm) {
  if (!sm) return null;
  return h("section", { class: "page-section summary" }, h("h2", null, t("summary.title")),
    sm.status ? h("p", { class: "muted" }, h("strong", null, ts(sm.status))) : null,
    sm.note ? h("p", null, ts(sm.note)) : null,
    sm.description ? h("p", null, localized(sm, "description")) : null,
    sm.trigger ? h("p", null, h("strong", null, t("summary.trigger") + " "), sm.trigger) : null,
    sm.when ? h("p", null, h("strong", null, t("summary.when") + " "), localized(sm, "when")) : null,
    h("p", { class: "muted" }, t("summary.source", { source: ts(sm.source) }), sm.path ? [" · ", h("code", { class: "tok" }, sm.path)] : null));
}

function projectOdd(o) {
  return o.features ? tn("project.odd", o.features, { done: fmt(o.done), total: fmt(o.total), percent: fmt(o.percent), n: fmt(o.features) }) : t("project.noOdd");
}
async function viewProjects() {
  const d = await api("projects");
  if (!d.projects.length) return [teach(t("nav.project"), t("project.noneKnown"), h("span", null, link("settings", "", t("project.openSettings"))))];
  return [h("h1", null, t("nav.project")), h("p", { class: "muted" }, t(d.auto_discover ? "project.countAuto" : "project.count", { n: fmt(d.projects.length) }) + " ", t("project.manage"), " ", link("settings", "", t("nav.settings")), "."),
    h("ul", { class: "items" }, d.projects.map((p) => h("li", null, link("project", p.name, p.name), h("span", { class: "muted" }, ` ${p.origin.map(originLabel).join(", ")}`),
      h("div", null, projectOdd(p.odd)),
      h("div", { class: "muted" }, t("project.summary", { sessions: fmt(p.sessions), memories: fmt(p.memories), graph: p.graph.mirrored ? t("project.graphMirrored", { at: R.fmtDate(p.graph.synced_at) }) : t("project.graphNot") })),
      h("div", { class: "muted tok" }, p.path))))];
}

// Project page extras: one collapsed task-progress diagram per feature (drawn when opened) and the graph memory status or how-to.
function oddDiagramsBlock(pg) {
  if (pg.kind !== "project" || !pg.odd_diagrams || !pg.odd_diagrams.length) return null;
  return h("section", { class: "page-section" }, h("h2", null, t("project.taskProgress")), pg.odd_diagrams.map((d, i) => {
    const body = h("div", null);
    let drawn = false;
    const draw = () => { if (!drawn) { drawn = true; body.replaceChildren(diagramBox(d.source, t("project.progressOf", { name: d.name }))); } };
    const det = h("details", { open: i === 0 }, h("summary", null, t("project.featureDone", { name: d.name, done: fmt(d.done), total: fmt(d.total) })), body);
    det.addEventListener("toggle", () => { if (det.open) draw(); });
    if (i === 0) draw();
    return det;
  }));
}
// Graph sync for one project: last sync, whether it is older than the last commit, and the two guarded actions (refresh now; install the git hooks).
// The refresh runs in a detached process, so after the 202 the page polls the project page until the sync time changes or the refresh is over.
const GRAPH_POLL_MS = 3000, GRAPH_POLL_MAX = 60;
function graphFreshness(g) {
  if (g.running) return h("p", { class: "muted" }, t("project.syncRunning"));
  if (!g.mirrored || !g.last_commit || g.stale === null || g.stale === undefined) return null;
  return g.stale ? h("p", { class: "warn" }, "▲ " + t("project.graphStale", { at: R.fmtDateTime(g.last_commit) })) : h("p", { class: "muted" }, t("project.graphFresh", { at: R.fmtDateTime(g.last_commit) }));
}
function graphActions(pg) {
  const g = pg.graph;
  if (g.is_git === undefined) return null; // an older server without the sync endpoints
  const out = h("div", { class: "settings-out", role: "status", "aria-live": "polite" });
  if (state.connectedNote === pg.id) { state.connectedNote = null; out.append(h("p", null, "✓ " + t("project.connected"))); }
  const sync = h("button", { type: "button" }, t("project.syncNow"));
  const connect = g.is_git && !g.hooks_installed ? h("button", { type: "button" }, t("project.connect")) : null;
  const buttons = [sync, connect].filter(Boolean);
  const busy = (on) => buttons.forEach((b) => setDisabled(b, on));
  const fail = (res) => out.replaceChildren(h("div", { class: "notice warn", role: "alert" }, "▲ " + (res.data && res.data.error ? ts(res.data.error) : t("common.requestFailed", { status: res.status }))));
  const still = () => state.route.kind === "project" && state.route.id === pg.id;
  const poll = (since, seenRunning = !!g.running, n = 0) => {
    const timer = setTimeout(async () => {
      if (!still()) return;
      let next;
      try { next = (await api("wiki/page", { kind: "project", id: pg.id })).graph; } catch (_) { next = null; }
      if (next && (next.synced_at !== since || (seenRunning && !next.running))) { render(); return; }
      if (n + 1 >= GRAPH_POLL_MAX) { busy(false); out.replaceChildren(h("p", { class: "muted" }, t("project.syncTimeout"))); return; }
      poll(since, seenRunning || !!(next && next.running), n + 1);
    }, GRAPH_POLL_MS);
    if (timer && timer.unref) timer.unref();
  };
  const act = async (path, started, then) => {
    busy(true);
    out.replaceChildren(h("p", { class: "muted" }, t("common.saving")));
    let res;
    try { res = await postJson(path, { project: pg.id }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) { busy(false); fail(res); return; }
    out.replaceChildren(h("p", null, "✓ " + t(started)));
    then();
  };
  sync.addEventListener("click", () => act("/api/projects/graph-sync", "project.syncStarted", () => poll(g.synced_at)));
  if (connect) connect.addEventListener("click", () => act("/api/projects/graph-connect", "project.connected", () => { busy(false); state.connectedNote = pg.id; render(); }));
  if (g.running) { busy(true); poll(g.synced_at); }
  return h("div", { class: "actions" }, ...buttons, h("p", { class: "muted" }, connect ? t("project.connectHelp") : t("project.syncHelp")), out);
}
function projectGraphBlock(pg) {
  if (pg.kind !== "project" || !pg.graph) return null;
  const g = pg.graph;
  return h("section", { class: "page-section" }, h("h2", null, t("project.graphMemory")),
    g.mirrored ? h("p", null, t("project.graphStats", { nodes: fmt(g.nodes), edges: fmt(g.edges), at: R.fmtDateTime(g.synced_at) }) + " ", link("node", "", t("project.browseNodes")))
      : h("p", { class: "muted" }, t("project.notMirrored") + " ", ts(g.howto)),
    graphFreshness(g), graphActions(pg));
}

async function viewFeatures() {
  const odd = await api("odd");
  const docs = odd.repos.flatMap((r) => r.documents.map((d) => ({ ...d, repo: r.repo })));
  if (!docs.length) return [teach(t("nav.feature"), t("feature.empty"))];
  return [h("h1", null, t("nav.feature")), h("ul", { class: "items" }, docs.map((d) => h("li", null, link("feature", d.id || `${d.repo}/${d.name.replace(/\.md$/, "")}`, d.name), h("span", { class: "muted" }, ` ${d.repo}`), " " + t("feature.tasksDone", { done: fmt(d.done), total: fmt(d.total) }))))];
}

async function viewGraph() { return [h("h1", null, t("nav.node")), await graphifyPanel()]; }

// ---- Settings editor: a closed list of options, always preview -> confirm -> apply, with undo ----------------------------------------
// Labels and help are i18n keys (resolved with t() when the page is built).
const SETTING_OPTIONS = [
  ["persona", "set.persona", [["gentleman", "set.gentleman"], ["neutral", "set.neutral"]], "set.persona.help"],
  ["review_mode", "set.review", [["off", "set.off"], ["on", "set.on"]], "set.review.help"],
  ["telemetry", "set.telemetry", [["on", "set.on"], ["off", "set.off"]], "set.telemetry.help"],
];
const SETTING_MODULES = [
  ["sdd", "set.mod.sdd", "set.mod.sdd.help"],
  ["rea", "set.mod.rea", "set.mod.rea.help"],
  ["context7", "set.mod.context7", "set.mod.context7.help"],
  ["impeccable", "set.mod.impeccable", "set.mod.impeccable.help"],
  ["archify", "set.mod.archify", "set.mod.archify.help"],
];
const valueLabel = (v) => (v === "on" ? t("common.on") : v === "off" ? t("common.off") : v);
const setDisabled = (el, on) => { if (on) el.setAttribute("disabled", ""); else el.removeAttribute("disabled"); };

async function postJson(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Portal-Token": token, Accept: "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function planBlock(res) {
  const p = res.plan || {}, files = p.files || [], removed = p.removed || [], skipped = p.skipped || [];
  const list = (title, items) => items.length ? h("details", null, h("summary", null, `${title} (${fmt(items.length)})`), h("ul", { class: "plain-list" }, items.slice(0, 40).map((f) => h("li", null, h("code", null, f))), items.length > 40 ? h("li", { class: "muted" }, t("plan.more", { n: fmt(items.length - 40) })) : null)) : null;
  return h("div", { class: "plan" },
    res.changes.length ? h("ul", { class: "plain-list" }, res.changes.map((c) => h("li", null, `${settingLabel(c.key)}: ${valueLabel(c.from)} → ${valueLabel(c.to)}`)))
      : h("p", null, res.repair ? t("plan.noChangesRepair") : t("plan.noChanges")),
    h("p", null, t("plan.counts", { written: fmt(files.length), removed: fmt(removed.length), kept: fmt(skipped.length) })),
    p.changed === false ? h("p", { class: "muted" }, t("plan.inPlace")) : null,
    p.impeccable && p.impeccable.engine === "would-install" ? h("p", null, t("plan.npm")) : null,
    list(t("plan.filesWritten"), files), list(t("plan.filesRemoved"), removed), list(t("plan.kept"), skipped));
}
function settingLabel(key) {
  if (key.startsWith("module:")) return t("set.moduleN", { name: key.slice(7) });
  return { persona: t("set.persona"), review_mode: t("set.review"), telemetry: t("set.telemetry") }[key] || key;
}

// Settings > Projects: the paths saved in portal.json and the auto-discover switch. Every change is one guarded POST; the server validates the paths.
async function projectsSection() {
  let data;
  try { data = await api("projects"); } catch (_) { return null; }
  const root = h("section", { class: "projects" }), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const send = async (body) => {
    out.replaceChildren(h("p", { role: "status", class: "muted" }, t("common.saving")));
    let res;
    try { res = await postJson("/api/projects/config", body); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) { out.replaceChildren(h("div", { class: "notice warn", role: "alert" }, `▲ ${res.data && res.data.error ? ts(res.data.error) : t("common.requestFailed", { status: res.status })}`, h("p", null, t(R.settingsAdvice(res.status).key)))); return; }
    data = res.data;
    paint();
    out.replaceChildren(h("p", { role: "status" }, "✓ " + t("common.saved")));
  };
  const paint = () => {
    const input = h("input", { type: "text", id: "project-path", placeholder: "/home/you/code/my-project", "aria-label": t("sp.pathLabel"), autocomplete: "off", spellcheck: "false" });
    const add = h("button", { type: "button" }, t("sp.add"));
    add.addEventListener("click", () => { const v = String(input.value || "").trim(); if (v) send({ repos: [...data.config_repos, v] }); });
    const box = h("input", { type: "checkbox", id: "project-auto", checked: data.auto_discover });
    box.addEventListener("change", (e) => send({ auto_discover: !!e.target.checked }));
    const found = data.projects.filter((p) => p.origin.includes("discovered") && !p.origin.includes("config") && !p.origin.includes("flag"));
    root.replaceChildren(h("h2", null, t("nav.project")),
      h("p", { class: "muted" }, t("sp.intro")),
      data.config_repos.length ? h("ul", { class: "plain-list" }, data.config_repos.map((p) => { const b = h("button", { type: "button" }, t("common.remove")); b.addEventListener("click", () => send({ repos: data.config_repos.filter((x) => x !== p) })); return h("li", null, h("code", { class: "tok" }, p), " ", b); })) : h("p", { class: "muted" }, t("sp.none")),
      h("div", { class: "actions" }, h("label", { for: "project-path" }, t("sp.addPath")), input, add),
      h("p", null, box, h("label", { for: "project-auto" }, " " + t("sp.auto"))),
      h("div", null, found.length ? h("p", { class: "muted" }, t("sp.found", { names: found.map((p) => p.name).join(", ") })) : null)); // replaceChildren(null) would write the text "null" in a browser
  };
  paint();
  return h("div", null, root, out);
}

async function viewSettings() {
  let info = await api("settings");
  let draft = null;
  const root = h("div", { class: "settings" });
  const formBox = h("div", null), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const marks = new Map();
  let previewBtn = null, repairBtn = null;
  const copy = (c) => ({ ...c, modules: { ...c.modules } });

  const refreshMarks = () => {
    const changes = R.settingsChanges(info.current, draft);
    for (const [key, el] of marks) { const c = changes.find((x) => x.key === key); el.textContent = c ? "◆ " + t("set.changed", { from: valueLabel(c.from) }) : ""; }
    if (previewBtn) setDisabled(previewBtn, changes.length === 0);
  };
  const option = (key, id, label, choices, value, help) => {
    const mark = h("span", { class: "changed" });
    marks.set(key, mark);
    const select = h("select", { id, "aria-describedby": `${id}-help` }, choices.map(([v, l]) => h("option", { value: v, selected: v === value }, t(l))));
    select.value = value;
    select.addEventListener("change", (e) => {
      const v = e.target.value;
      if (key.startsWith("module:")) draft.modules[key.slice(7)] = v; else draft[key] = v;
      refreshMarks();
    });
    return h("div", { class: "option" }, h("label", { for: id }, t(label)), select, h("span", { class: "current" }, t("set.now", { value: valueLabel(value) })), mark, h("p", { id: `${id}-help`, class: "option-help muted" }, t(help)));
  };
  const buildForm = () => {
    draft = copy(info.current);
    marks.clear();
    previewBtn = h("button", { type: "button", disabled: true }, t("set.preview"));
    previewBtn.addEventListener("click", () => runPreview(false));
    repairBtn = h("button", { type: "button" }, t("set.previewRepair"));
    repairBtn.addEventListener("click", () => runPreview(true));
    formBox.replaceChildren(...[
      info.installed ? null : h("p", { class: "notice" }, t("set.notInstalled")),
      h("div", { class: "options" },
        ...SETTING_OPTIONS.map(([key, label, choices, help]) => option(key, `set-${key.replace("_", "-")}`, label, choices, info.current[key], help)),
        h("h2", null, t("set.modules")),
        ...SETTING_MODULES.map(([name, label, help]) => option(`module:${name}`, `set-module-${name}`, label, [["off", "set.off"], ["on", "set.on"]], info.current.modules[name], help))),
      h("div", { class: "actions" }, previewBtn),
      h("section", { class: "repair" }, h("h2", null, t("set.repairTitle")),
        h("p", { class: "muted" }, t("set.repairHelp")), h("div", { class: "actions" }, repairBtn))].filter(Boolean));
    refreshMarks();
  };

  const busy = (key) => { out.replaceChildren(h("p", { role: "status", class: "muted" }, t(key))); };
  const fail = (res, retry) => {
    const adv = R.settingsAdvice(res.status);
    out.replaceChildren(h("div", { class: "notice warn", role: "alert" }, h("p", null, `▲ ${res.data && res.data.error ? ts(res.data.error) : t("common.requestFailed", { status: res.status })}`),
      res.data && res.data.detail ? h("p", { class: "muted" }, h("code", null, res.data.detail)) : null, h("p", null, t(adv.key)),
      adv.again ? (() => { const b = h("button", { type: "button" }, t("set.previewAgain")); b.addEventListener("click", () => retry()); return b; })() : null));
  };
  const askConfirm = (text, yes, onYes, onNo) => {
    const ok = h("button", { type: "button", class: "primary" }, yes), no = h("button", { type: "button" }, t("common.goBack"));
    ok.addEventListener("click", onYes); no.addEventListener("click", onNo);
    return h("div", { class: "confirm", role: "group", "aria-label": t("common.confirm") }, h("p", null, text), h("div", { class: "actions" }, ok, no));
  };

  async function runPreview(repair) {
    const body = R.settingsBody(info.current, draft, repair);
    setDisabled(previewBtn, true); setDisabled(repairBtn, true);
    busy("set.checking");
    let res;
    try { res = await postJson("/api/settings/preview", body); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    setDisabled(repairBtn, false); refreshMarks();
    if (!res.ok) return fail(res, () => runPreview(repair));
    showPlan(res.data, repair);
  }
  function showPlan(plan, repair) {
    const confirmBox = h("div", null);
    const apply = h("button", { type: "button", class: "primary" }, t("set.apply"));
    apply.addEventListener("click", () => {
      setDisabled(apply, true);
      confirmBox.replaceChildren(askConfirm(t("set.applyConfirm"), t("set.applyYes"), () => runApply(plan), () => { setDisabled(apply, false); confirmBox.replaceChildren(); }));
    });
    const cancel = h("button", { type: "button" }, t("set.discard"));
    cancel.addEventListener("click", () => out.replaceChildren());
    out.replaceChildren(h("section", { class: "panel" }, h("h2", null, t("set.previewTitle")), planBlock(plan), h("p", { class: "muted" }, t("set.validFor", { n: fmt(Math.round((plan.expires_in || 300) / 60)) })), h("div", { class: "actions" }, apply, cancel), confirmBox));
  }
  async function runApply(plan) {
    busy("set.applying");
    let res;
    try { res = await postJson("/api/settings/apply", { apply_token: plan.apply_token, confirm: true }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runPreview(false));
    const d = res.data;
    const undo = d.undo_available ? h("button", { type: "button" }, t("set.undo")) : null;
    if (undo) undo.addEventListener("click", () => { setDisabled(undo, true); runUndoPreview(); });
    out.replaceChildren(h("section", { class: "panel", role: "status" }, h("h2", null, t("set.applied")),
      h("p", null, "✓ " + t("set.written", { files: fmt(d.files.length), removed: fmt(d.removed.length) })), d.backup ? h("p", null, t("set.backup", { id: d.backup })) : h("p", { class: "muted" }, t("set.noBackup")),
      d.skipped.length ? h("p", { class: "muted" }, t("set.keptEdited", { n: fmt(d.skipped.length) })) : null,
      d.impeccable && d.impeccable.engine === "failed" ? h("p", { class: "warn" }, "▲ " + t("set.engineFailed", { detail: d.impeccable.detail || t("set.npmFailed") })) : null,
      h("div", { class: "actions" }, undo)));
    await reload();
  }
  async function runUndoPreview() {
    busy("set.checkingUndo");
    let res;
    try { res = await postJson("/api/settings/undo/preview", {}); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runUndoPreview());
    const plan = res.data, confirmBox = h("div", null);
    const revert = h("button", { type: "button", class: "primary" }, t("set.revert"));
    revert.addEventListener("click", () => {
      setDisabled(revert, true);
      confirmBox.replaceChildren(askConfirm(t("set.undoConfirm"), t("set.undoYes"), () => runUndo(plan), () => { setDisabled(revert, false); confirmBox.replaceChildren(); }));
    });
    const cancel = h("button", { type: "button" }, t("set.discard"));
    cancel.addEventListener("click", () => out.replaceChildren());
    out.replaceChildren(h("section", { class: "panel" }, h("h2", null, t("set.undoPreviewTitle")), planBlock(plan),
      h("p", { class: "muted" }, t("set.undoValid", { n: fmt(Math.round((plan.expires_in || 300) / 60)) })),
      h("div", { class: "actions" }, revert, cancel), confirmBox));
  }
  async function runUndo(plan) {
    busy("set.undoing");
    let res;
    try { res = await postJson("/api/settings/undo", { apply_token: plan.apply_token, confirm: true }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runUndoPreview());
    const d = res.data;
    out.replaceChildren(h("section", { class: "panel", role: "status" }, h("h2", null, t("set.undone")), h("p", null, "✓ " + t("set.written", { files: fmt(d.files.length), removed: fmt(d.removed.length) })),
      d.backup ? h("p", null, t("set.backup", { id: d.backup })) : h("p", { class: "muted" }, t("set.noBackup")),
      h("p", { class: "muted" }, t("set.undoneNote"))));
    await reload();
  }
  async function reload() {
    try { info = await api("settings"); buildForm(); } catch (_) { /* the page keeps what it shows */ }
  }

  buildForm();
  const projectsBox = await projectsSection();
  root.append(h("h1", null, t("nav.settings")),
    h("p", { class: "muted" }, t("set.intro")),
    formBox, out, ...(projectsBox ? [projectsBox] : []));
  return [root];
}

// ---- Themes: picker in the top bar, and the editor page (list, live preview, save, import, export) ----------------------------------
// A theme reaches the page only through TH.applyChoice / TH.previewTheme (CSSOM custom properties and data-theme). The viewer's choice lives in
// browser storage through TH.storage() (try/catch: the page works without it); the theme files themselves are stored by the server through guarded writes.
const usableThemes = () => state.themes.filter((th) => !th.error && TH.validateTheme({ name: th.name, base: th.base, tokens: th.tokens }).ok);
const effectiveChoice = () => (state.themeChoice.startsWith("custom:") && !usableThemes().some((th) => `custom:${th.slug}` === state.themeChoice) ? "system" : state.themeChoice);
function applyTheme() { TH.applyChoice(document.documentElement, state.themeChoice, state.themes); }
function paintPicker() {
  const pick = $("theme-picker");
  pick.replaceChildren(...[["system", t("theme.system")], ["light", t("theme.light")], ["dark", t("theme.dark")], ...usableThemes().map((th) => [`custom:${th.slug}`, th.name])].map(([v, l]) => h("option", { value: v }, l)));
  pick.value = effectiveChoice();
}
async function loadThemes() {
  try { state.themes = (await api("themes")).themes || []; } catch (_) { state.themes = []; }
  paintPicker();
  applyTheme();
}
function chooseTheme(choice) {
  state.themeChoice = choice;
  TH.saveChoice(TH.storage(), choice);
  applyTheme();
  if (state.preview) state.preview(); // the editor keeps showing its draft
  paintPicker();
}

const THEME_CODES = ["shape", "name", "base", "token", "value", "slug", "limit", "dir", "symlink", "toolarge", "json", "unreadable", "notfound", "write"]; // the server sends "theme.<code>"; each has a themeErr.<code> text
// A known code gives the plain-language text; an unknown code, or a token-specific one without its token, shows the server's own message.
function themeMsg(e) {
  const code = String((e && e.code) || "").replace(/^theme\./, "");
  const known = THEME_CODES.includes(code);
  return known && (e.token || !/^(token|value)$/.test(code)) ? t(`themeErr.${code}`, { token: e.token || "" }) : e && e.error ? ts(e.error) : t("themeErr.invalid");
}
const MAX_THEME_FILE = 16384;

async function viewThemes() {
  await loadThemes();
  const draft = () => state.themeDraft;
  const rows = {};
  const root = h("div", { class: "theme-editor" });
  const listBox = h("div", null), formBox = h("div", null), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const say = (...kids) => out.replaceChildren(...kids);
  const warn = (head, extra) => say(h("div", { class: "notice warn", role: "alert" }, h("p", null, `▲ ${head}`), extra));
  const badTokens = () => Object.entries(draft().tokens).filter(([, v]) => !TH.isValidValue(v)).map(([k]) => k);
  const validTokens = () => Object.fromEntries(Object.entries(draft().tokens).filter(([, v]) => TH.isValidValue(v)).map(([k, v]) => [k, TH.normalizeValue(v)]));
  const warnBox = h("div", { class: "notice warn", "aria-live": "polite", "data-contrast": "1", hidden: true });

  const refresh = () => {
    if (!draft()) return;
    TH.previewTheme(document.documentElement, draft().base, draft().tokens);
    const w = TH.contrastWarnings(draft().base, draft().tokens);
    warnBox.hidden = !w.length;
    warnBox.replaceChildren(...w.map((x) => h("p", null, "▲ " + t("theme.lowContrast", { fg: x.fg, bg: x.bg, ratio: R.fmtDecimal(x.ratio, 1), min: R.fmtDecimal(x.min, x.min % 1 ? 1 : 0) }))));
  };
  state.preview = refresh;
  const paintRow = (tok) => {
    const r = rows[tok], v = draft().tokens[tok] || "";
    const ok = !v || TH.isValidValue(v);
    r.msg.textContent = ok ? "" : "▲ " + t("theme.invalidValue");
    if (ok) r.text.removeAttribute("aria-invalid"); else r.text.setAttribute("aria-invalid", "true");
    r.text.setAttribute("placeholder", TH.BASES[draft().base][tok]);
    r.color.value = TH.toHex(ok && v ? v : TH.BASES[draft().base][tok]) || "#000000";
  };
  const tokenRow = (tok) => {
    const text = h("input", { type: "text", id: `tok-${tok}`, value: draft().tokens[tok] || "", "aria-describedby": `tok-${tok}-msg`, autocomplete: "off", spellcheck: "false" });
    const color = h("input", { type: "color", id: `tok-${tok}-color`, "aria-label": t("theme.picker", { token: tok }) });
    const msg = h("span", { class: "tok-msg", id: `tok-${tok}-msg` });
    rows[tok] = { text, color, msg };
    text.addEventListener("input", () => { const v = text.value.trim(); if (v) draft().tokens[tok] = v; else delete draft().tokens[tok]; paintRow(tok); refresh(); });
    color.addEventListener("input", (e) => { text.value = e.target.value; draft().tokens[tok] = String(e.target.value).toLowerCase(); paintRow(tok); refresh(); });
    return h("div", { class: "token-row" }, h("label", { for: `tok-${tok}` }, tok), color, text, msg);
  };

  const askConfirm = (text, yes, onYes) => {
    const ok = h("button", { type: "button", class: "primary" }, yes), no = h("button", { type: "button" }, t("common.goBack"));
    ok.addEventListener("click", onYes);
    no.addEventListener("click", () => paintForm());
    return h("div", { class: "confirm", role: "group", "aria-label": t("common.confirm") }, h("p", null, text), h("div", { class: "actions" }, ok, no));
  };
  const freeSlug = (base) => {
    const taken = new Set(state.themes.map((th) => th.slug));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) { const s = `${base.slice(0, 40 - String(n).length - 1).replace(/-+$/, "")}-${n}`; if (!taken.has(s)) return s; }
  };
  const saved = (data, note) => { state.themes = data.themes || []; paintPicker(); paintList(); say(h("p", { role: "status" }, note)); };
  const failed = (res) => warn(res.data && (res.data.code || res.data.error) ? themeMsg(res.data) : t("common.requestFailed", { status: res.status }), h("p", null, t(R.settingsAdvice(res.status).key)));

  async function save() {
    const d = draft();
    if (badTokens().length) return warn(t("theme.fixValues"));
    const v = TH.validateTheme({ name: d.name, base: d.base, tokens: d.tokens });
    if (!v.ok) return warn(t("theme.cannotSave"), h("ul", { class: "plain-list" }, v.errors.map((e) => h("li", null, themeMsg(e)))));
    const slug = d.isNew ? freeSlug(TH.slugify(d.name)) : d.slug;
    say(h("p", { role: "status", class: "muted" }, t("common.saving")));
    let res;
    try { res = await postJson("/api/themes", { slug, ...v.theme }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return failed(res);
    d.slug = slug; d.isNew = false;
    saved(res.data, "✓ " + t("common.saved"));
    paintForm();
  }
  async function remove() {
    const d = draft();
    say(h("p", { role: "status", class: "muted" }, t("theme.deleting")));
    let res;
    try { res = await postJson("/api/themes/delete", { slug: d.slug }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return failed(res);
    if (state.themeChoice === `custom:${d.slug}`) chooseTheme("system");
    state.themeDraft = null; state.preview = null;
    applyTheme();
    saved(res.data, "✓ " + t("theme.deleted"));
    paintForm();
  }
  function exportTheme() {
    const d = draft();
    const data = { name: d.name.trim() || t("theme.untitled"), base: d.base, tokens: validTokens() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
    const a = h("a", { href: url, download: `${d.slug || TH.slugify(d.name)}.json` });
    if (document.body) document.body.append(a);
    a.click();
    if (a.remove) a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(input) {
    const file = (input.files || [])[0];
    if (!file) return;
    if (file.size > MAX_THEME_FILE) return warn(t("theme.fileTooLarge"));
    let data;
    try { data = JSON.parse(await file.text()); } catch (_) { return warn(t("theme.importNotJson")); }
    const v = TH.validateTheme(data);
    input.value = "";
    if (!v.ok) return warn(t("theme.importFailed"), h("ul", { class: "plain-list" }, v.errors.map((e) => h("li", null, themeMsg(e)))));
    state.themeDraft = { slug: null, isNew: true, name: v.theme.name, base: v.theme.base, tokens: { ...v.theme.tokens } };
    paintForm();
    say(h("p", { role: "status" }, t("theme.imported")));
  }

  function paintForm() {
    for (const k of Object.keys(rows)) delete rows[k];
    const d = draft();
    if (!d) { state.preview = null; applyTheme(); formBox.replaceChildren(h("p", { class: "muted" }, t("theme.choose"))); return; }
    state.preview = refresh;
    const name = h("input", { type: "text", id: "theme-name", value: d.name, maxlength: "60", autocomplete: "off" });
    name.addEventListener("input", () => { d.name = name.value; });
    const base = h("select", { id: "theme-base" }, h("option", { value: "light" }, t("theme.light")), h("option", { value: "dark" }, t("theme.dark")));
    base.value = d.base;
    base.addEventListener("change", (e) => { d.base = e.target.value === "dark" ? "dark" : "light"; for (const tok of TH.TOKENS) paintRow(tok); refresh(); });
    const btn = (label, fn, cls) => { const b = h("button", { type: "button", class: cls || false }, label); b.addEventListener("click", fn); return b; };
    const confirmBox = h("div", null);
    formBox.replaceChildren(h("section", { class: "theme-form", "aria-label": t("theme.editorLabel") },
      h("h2", null, d.isNew ? t("theme.new") : t("theme.edit", { name: d.name })),
      h("div", { class: "field" }, h("label", { for: "theme-name" }, t("col.name")), name),
      h("div", { class: "field" }, h("label", { for: "theme-base" }, t("theme.base")), base, h("span", { class: "muted" }, t("theme.emptyUsesBase"))),
      ...TH.TOKENS.map(tokenRow), warnBox,
      h("div", { class: "actions" }, btn(t("theme.save"), save, "primary"), btn(t("theme.export"), exportTheme),
        d.isNew ? null : btn(t("theme.delete"), () => confirmBox.replaceChildren(askConfirm(t("theme.deleteConfirm", { name: d.name }), t("theme.deleteYes"), remove))),
        btn(t("theme.close"), () => { state.themeDraft = null; paintForm(); })),
      confirmBox));
    for (const tok of TH.TOKENS) paintRow(tok);
    refresh();
  }
  function paintList() {
    const input = h("input", { type: "file", id: "theme-import", class: "visually-hidden", accept: ".json,application/json", tabindex: "-1" });
    input.addEventListener("change", () => importFile(input));
    const importButton = h("button", { type: "button" }, t("theme.import"));
    importButton.addEventListener("click", () => input.click());
    const create = h("button", { type: "button" }, t("theme.newButton"));
    create.addEventListener("click", () => { state.themeDraft = { slug: null, isNew: true, name: "", base: "light", tokens: {} }; paintForm(); say(); });
    const editButton = (th) => {
      const b = h("button", { class: "row-link", type: "button", "data-edit": th.slug }, th.name);
      b.addEventListener("click", () => { state.themeDraft = { slug: th.slug, isNew: false, name: th.name, base: th.base, tokens: { ...th.tokens } }; paintForm(); say(); });
      return b;
    };
    listBox.replaceChildren(
      state.themes.length ? h("ul", { class: "items" }, state.themes.map((th) => th.error
        ? h("li", null, h("code", null, th.slug), h("p", { class: "warn" }, "▲ " + t("theme.invalidFile", { reason: themeMsg(th) })))
        : h("li", null, editButton(th), h("span", { class: "muted" }, ` ${t(th.base === "dark" ? "theme.dark" : "theme.light")}${state.themeChoice === `custom:${th.slug}` ? ", " + t("theme.inUse") : ""}`))))
        : h("p", { class: "muted" }, t("theme.noneYet")),
      h("div", { class: "actions" }, create, importButton, input));
  }
  paintList();
  paintForm();
  root.append(h("h1", null, t("nav.themes")), h("p", { class: "muted" }, t("theme.intro")), listBox, formBox, out);
  return [root];
}

// Home: recent activity is the page; spending and harness health sit in the rail as plain text and a small table (no metric tiles).
// The server groups by UTC day; the page regroups by the viewer's local day so a time and its heading always agree.
function localDays(days) {
  const by = new Map();
  for (const d of days) for (const i of d.items) { const day = R.fmtDate(i.ts); if (!by.has(day)) by.set(day, []); by.get(day).push(i); }
  return [...by.entries()].filter(([day]) => day !== "-").sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, items]) => ({ day, items: items.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1)) }));
}
function activityBlock(days) {
  if (!days.length) return h("p", { class: "muted" }, t("home.empty"));
  return h("div", null, localDays(days).map((d) => h("section", { class: "page-section day" }, h("h2", null, d.day),
    h("ul", { class: "items" }, d.items.map((i) => h("li", null, h("span", { class: "muted" }, `${kindLabel(i.kind)} `), link(i.kind, i.id, i.title), h("span", { class: "muted" }, ` ${ts(i.what)}, ${R.fmtDateTime(i.ts).slice(11) || "?"}`)))))));
}
function spendingBlock(sp) {
  if (!sp.available) return h("p", { class: "muted" }, t("home.noSpending"));
  const by = Object.fromEntries(sp.windows.map((w) => [w.days, w]));
  const cols = sp.windows.map((w) => w.days);
  return h("div", null,
    h("table", { class: "compact" }, h("thead", null, h("tr", null, h("th", null, t("home.tokens")), cols.map((d) => h("th", { class: "n" }, t("home.days", { n: fmt(d) }))))),
      h("tbody", null, KINDS.map(([k, label]) => h("tr", null, h("td", null, label), cols.map((d) => h("td", { class: "n" }, short(by[d][k]))))))),
    h("p", null, t("home.cacheRatio", { n: fmt(cols[cols.length - 1]) }) + " ", h("strong", null, pct(sp.cache_hit_ratio))),
    sp.top_models.length ? h("div", null, h("h3", null, t("home.topModels")), h("ul", { class: "refs" }, sp.top_models.map((m) => h("li", null, m.model, h("span", { class: "muted" }, " " + t("home.tokensN", { n: short(m.tokens) })))))) : null,
    h("p", null, link("usage", "", t("home.usageDetails"))));
}
function healthBlock(hl) {
  if (!hl.installed) return h("p", { class: "muted" }, t("harness.notInstalled"));
  const rows = [[t("harness.version"), hl.version || "-"], [t("harness.hooks"), fmt(hl.hooks)], [t("nav.mcp"), fmt(hl.mcp_servers)], [t("nav.skill"), fmt(hl.skills)], [t("home.agents"), fmt(hl.agents)], [t("harness.telemetry"), hl.telemetry ? t("common.on") : t("common.off")]];
  return h("div", null, h("dl", { class: "meta" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, String(v))])), h("p", null, link("harness", "", t("home.harnessDetails"))));
}
function impactRankBlock(rk) {
  if (!rk || !rk.available) return null;
  const line = (r) => h("li", null, `${r.verdict === "better" ? "▼" : "▲"} `, link("skill", r.skill, r.skill),
    h("span", { class: "muted" }, " " + t("home.rankLine", { delta: R.fmtDelta("error_rate", r.delta, words()), n: fmt(r.n), sessions: fmt(r.sessions) })));
  const list = (title, rows) => (rows.length ? h("div", null, h("h3", null, title), h("ul", { class: "refs" }, rows.map(line))) : null);
  const none = !rk.best.length && !rk.worst.length;
  return h("div", null,
    none ? h("p", { class: "muted" }, t("home.noRank", { n: fmt(rk.min_sessions) })) : null,
    list(t("home.lowerError"), rk.best), list(t("home.higherError"), rk.worst),
    h("p", { class: "muted" }, t("home.rankFoot", { ranked: fmt(rk.ranked), tracked: fmt(rk.tracked), days: fmt(rk.days) }) + " " + ts(rk.note)));
}
async function viewHome() {
  const hm = await api("wiki/home");
  return [h("div", { class: "page" }, h("article", { class: "doc" }, h("h1", null, t("home.title")), activityBlock(hm.activity)),
    h("aside", { class: "rail", "aria-label": t("home.railLabel") }, railBlock(t("nav.spending"), spendingBlock(hm.spending)), railBlock(t("home.skillImpact"), impactRankBlock(hm.impact)), railBlock(t("home.health"), healthBlock(hm.health))))];
}
// Lint: candidates worth a second look, counted per check and linked to their pages. Wording is "review", never a verdict.
function lintItem(it) {
  const people = Array.isArray(it.members) && it.members.length > 1
    ? h("ul", { class: "refs" }, it.members.map((m) => h("li", null, link(m.kind, m.id, m.title), m.topic_key ? h("span", { class: "muted" }, ` ${m.topic_key}`) : null)))
    : null;
  return h("li", null, people ? h("span", null, t("lint.group") + " ") : link(it.kind, it.id, it.title), it.detail ? h("span", { class: "muted" }, ` ${ts(it.detail)}`) : null, people);
}
function lintCategory(c) {
  return h("section", { class: "page-section lint-cat" }, h("h2", null, `${ts(c.title)} (${fmt(c.count)})`), h("p", { class: "muted" }, ts(c.note)),
    c.items.length ? h("ul", { class: "items" }, c.items.map(lintItem)) : h("p", null, t("lint.nothing")),
    c.truncated ? h("p", { class: "muted" }, t("lint.showing", { shown: fmt(c.items.length), total: fmt(c.count) })) : null);
}
async function viewLint() {
  const l = await api("wiki/lint");
  const sc = l.scanned || {};
  return [h("div", { class: "page" }, h("article", { class: "doc" }, h("h1", null, t("nav.lint")),
    h("p", { class: "muted" }, t("lint.intro", { n: fmt(sc.memories), capped: sc.capped ? t("lint.capped") : "" })),
    l.categories.map(lintCategory)))];
}
async function viewUsagePage() { return [...(await viewOverview()), ...(await viewUsage())]; }

async function renderRoute(route, changed) {
  const { kind, id } = route;
  if (kind === "unknown") return [teach(t("route.notPage"), t("route.noMatch", { id }))];
  if (id && WIKI_KINDS.includes(kind)) return viewWikiPage(kind, id, route.source);
  if (changed && ["skill", "tool", "mcp"].includes(kind)) state.usageKind = { skill: "skills", tool: "tools", mcp: "mcp_servers" }[kind];
  const views = { home: viewHome, project: viewProjects, usage: viewUsagePage, skill: viewSkillCatalog, component: viewComponents, tool: viewUsage, mcp: viewUsage, session: viewSessions, memory: viewMemories, memfile: viewMemories, feature: viewFeatures, node: viewGraph, harness: viewHarness, settings: viewSettings, lint: viewLint, themes: viewThemes };
  return views[kind]();
}

function renderNav(route) {
  $("nav").replaceChildren(...SECTIONS.map(([heading, items]) => h("section", { class: "nav-section" }, h("h2", null, t(heading)),
    h("ul", null, items.map(([k, label]) => h("li", null, link(k, "", t(label), { "aria-current": k === route.kind ? "page" : false })))))));
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
    if (seq === renderSeq) { $("view").replaceChildren(panel(t("common.error"), h("p", { class: "warn" }, String(err.message || err)))); state.shown = key; }
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
for (const id of ["days", "project"]) $(id).addEventListener("change", render);
$("theme-picker").addEventListener("change", (e) => chooseTheme(e.target.value));
$("lang-picker").addEventListener("change", (e) => setLanguage(e.target.value));
window.addEventListener("hashchange", () => { state.route = R.parseHash(location.hash); render(); });
state.route = R.parseHash(location.hash);
applyLanguage(I.loadLang(I.storage()) || I.detect(I.browserLanguage())); // a stored choice wins over the browser language
applyTheme();
paintPicker();
if (state.route.kind !== "themes") loadThemes(); // the editor page loads them itself
loadRecent();
loadProjects().then(render);
// Liveness signal: lets a launcher-started server exit once the window is gone. Failures are silent on purpose.
function heartbeat() { fetch("/api/heartbeat", { method: "POST", headers: { "X-Portal-Token": token } }).catch(() => {}); }
heartbeat();
setInterval(heartbeat, 10000);
