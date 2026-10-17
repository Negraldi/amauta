"use strict";
// All data reaches the DOM through text nodes only (never as HTML strings), so data can never become markup.
const token = document.querySelector('meta[name="portal-token"]').content;
const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const R = globalThis.AmautaRoute, MD = globalThis.AmautaMarkdown; // markdown.js and wikiroute.js load first (see index.html)
const SECTIONS = [
  ["Knowledge", [["home", "Home"], ["memory", "Memory"], ["feature", "ODD features"], ["node", "Graph"]]],
  ["Harness", [["skill", "Skills"], ["tool", "Tools"], ["mcp", "MCP servers"], ["session", "Sessions"], ["harness", "Harness"]]],
  ["Spending", [["usage", "Usage"]]],
  ["Manage", [["lint", "Lint"], ["settings", "Settings"]]],
];
const KINDS = [["input", "Input"], ["output", "Output"], ["cache_read", "Cache read"], ["cache_write", "Cache write"]];

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const fmt = (n) => R.fmtNumber(n);
const short = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0));
const pct = (r) => (r == null ? "-" : (r * 100).toFixed(1) + "%");

async function api(path, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const r = await fetch(`/api/${path}${q.toString() ? "?" + q : ""}`, { headers: { Accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
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
    tag.onerror = () => { mermaidReady = null; reject(new Error("could not load /static/mermaid.min.js")); };
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
    if (!root) throw new Error("diagram output was not SVG");
    into.replaceChildren(document.importNode(root, true));
  } catch (err) {
    into.replaceChildren(h("p", { class: "warn" }, `Diagram could not be rendered: ${String(err.message || err).split("\n")[0]}`), h("pre", { class: "text" }, source));
  }
}
function diagramBox(source, caption) {
  const box = h("div", { class: "diagram scroll", role: "img", "aria-label": caption || "Diagram" }, h("p", { class: "muted" }, "Rendering..."));
  drawMermaid(source, box);
  return box;
}
// Markdown the portal shows as text may hold ```mermaid fences: draw the first few under it.
function fenceDiagrams(text, into) {
  const sources = [...String(text).matchAll(/^```mermaid[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)].slice(0, 5).map((m) => m[1]);
  into.replaceChildren(...sources.map((src, i) => h("div", null, h("div", { class: "muted" }, `Mermaid diagram ${i + 1}`), diagramBox(src, `Mermaid diagram ${i + 1}`))));
  into.hidden = sources.length === 0;
}

const state = { route: { kind: "home", id: "" }, shown: null, usageKind: "skills", memSource: "own", sort: {} };
const link = (kind, id, label, attrs) => h("a", { href: R.formatHash(kind, id), ...attrs }, label);
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
    c.link && onRow ? h("button", { class: "row-link", type: "button", [c.attr || "data-row"]: "1", onclick: () => onRow(r) }, r[c.key]) : c.render ? c.render(r[c.key], r) : c.num ? fmt(r[c.key]) : R.fmtIso(r[c.key]) ?? "-"))));
  return h("div", { class: "scroll", tabindex: 0, role: "region", "aria-label": "Table, scrollable" }, h("table", null, h("thead", null, head), h("tbody", null, body)));
}

function legend() { return h("div", { class: "legend" }, KINDS.map(([k, l]) => h("span", null, h("span", { class: `sw f-${k}` }), l))); }

function stackedChart(daily) {
  if (!daily.length) return empty("No usage in this range.");
  const W = 720, H = 220, L = 44, B = 22, T = 8, PR = 6;
  const totals = daily.map((d) => KINDS.reduce((a, [k]) => a + (d[k] || 0), 0));
  const max = Math.max(...totals, 1);
  const bw = (W - L - PR) / daily.length;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Tokens per day" });
  for (const f of [0, 0.5, 1]) {
    const y = T + (H - T - B) * (1 - f);
    root.append(svg("line", { x1: L, x2: W - PR, y1: y, y2: y, class: "axis" }), svg("text", { x: L - 4, y: y + 4, "text-anchor": "end" }, short(max * f)));
  }
  daily.forEach((d, i) => {
    let y = H - B;
    const g = svg("g", null, svg("title", null, `${R.fmtDate(d.day)}: ` + KINDS.map(([k, l]) => `${l} ${fmt(d[k])}`).join(", ")));
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
    { key: "model", label: "Model" }, { key: "messages", label: "Messages", num: true },
    { key: "input", label: "Input", num: true }, { key: "output", label: "Output", num: true },
    { key: "cache_read", label: "Cache read", num: true }, { key: "cache_write", label: "Cache write", num: true },
    { key: "share", label: "Share", num: true, render: (v) => pct(v) },
  ], models.map((m) => ({ ...m, share: KINDS.reduce((s, [k]) => s + (m[k] || 0), 0) / total })));
}

async function viewOverview() {
  const [o, c] = await Promise.all([api("overview", filters()), api("costs", filters())]);
  if (!o.available) return [panel("Usage", empty("No usage data yet. Run the backfill or click Refresh usage."))];
  const t = o.totals;
  const out = [
    h("div", { class: "grid" },
      card("Input tokens", short(t.input)), card("Output tokens", short(t.output)), card("Cache read", short(t.cache_read)), card("Cache write", short(t.cache_write)),
      card("Cache hit ratio", pct(o.cache_hit_ratio), h("div", { class: "l" }, "cache read / (input + cache read + cache write)")),
      card("Messages", fmt(t.messages)), card("Sessions", fmt(t.sessions)),
      card("Telemetry events", fmt(o.events), o.dropped_events ? h("div", { class: "l warn" }, `${fmt(o.dropped_events)} dropped (lock contention or write failure)`) : h("div", { class: "l" }, "0 dropped"))),
    panel("Tokens per day", stackedChart(o.daily)),
    panel("Sessions per day", o.daily.length ? table("sessday", [{ key: "day", label: "Day" }, { key: "sessions", label: "Sessions", num: true }, { key: "messages", label: "Messages", num: true }], o.daily) : empty("No sessions in this range.")),
    panel("Model split", modelBars(o.models)),
  ];
  if (c.error) out.push(panel("Cost estimate", h("p", { class: "warn" }, c.error)));
  if (c.enabled) {
    out.push(panel("Cost estimate", h("p", { class: "warn" }, c.label),
      c.invalid_prices && c.invalid_prices.length ? h("p", { class: "warn" }, "Invalid prices (those models are not costed): " + c.invalid_prices.join(", ")) : null,
      table("cost", [{ key: "model", label: "Model" }, { key: "cost", label: "Estimated cost", num: true, render: (v) => (v == null ? "no price" : v.toFixed(2)) }], c.models),
      h("p", null, "Total (priced models): ", h("strong", null, (c.total || 0).toFixed(2)))));
  }
  return out;
}

async function viewUsage() {
  const t = await api("tools", filters());
  if (!t.available) return [panel("Usage", empty("No usage data yet."))];
  const kinds = [["skills", "Skills"], ["tools", "Tools"], ["mcp_servers", "MCP servers"], ["mcp_tools", "MCP tools"], ["subagents", "Subagent types"]];
  const linkKind = { skills: "skill", tools: "tool", mcp_servers: "mcp", mcp_tools: "tool" }[state.usageKind];
  const cols = [{ key: "name", label: "Name", render: linkKind ? (v) => link(linkKind, v, v) : undefined }, { key: "count", label: "Calls", num: true }, { key: "sessions", label: "Sessions", num: true }, { key: "last_used", label: "Last used" }];
  return [
    h("div", { class: "tabs" }, kinds.map(([k, l]) => h("button", { type: "button", "aria-pressed": state.usageKind === k, onclick: () => { state.usageKind = k; render(); } }, `${l} (${t[k].length})`))),
    panel(kinds.find(([k]) => k === state.usageKind)[1], t[state.usageKind].length ? table("usage-" + state.usageKind, cols, t[state.usageKind]) : empty("Nothing recorded in this range.")),
  ];
}

async function viewSessions() {
  const s = await api("sessions", filters());
  if (!s.available) return [panel("Sessions", empty("No usage data yet."))];
  const nums = [["messages", "Msgs"], ["input", "Input"], ["output", "Output"], ["cache_read", "Cache read"], ["cache_write", "Cache write"]].map(([key, label]) => ({ key, label, num: true }));
  return [
    panel("Projects", table("projects", [{ key: "project", label: "Project", link: true }, { key: "sessions", label: "Sessions", num: true }, ...nums], s.projects, (r) => { $("project").value = r.project; render(); })),
    panel("Sessions", table("sessions", [{ key: "session_id", label: "Session", render: (v) => link("session", v, String(v).slice(0, 8)) }, { key: "project", label: "Project" }, { key: "last_ts", label: "Last activity" }, { key: "model", label: "Model" }, ...nums], s.sessions)),
  ];
}

// Event handlers run outside render()'s try/catch: show the failure where the result would have gone.
function guarded(fn, into) {
  return async (...args) => {
    try { await fn(...args); } catch (err) { into.hidden = false; into.replaceChildren(h("p", { class: "warn" }, String(err.message || err))); }
  };
}

function fences(text) { const box = h("div", null); fenceDiagrams(text, box); return box; }

async function showMemory(source, id, into) {
  const m = await api("memory", { source, id });
  const hist = m.topic_key ? await api("memory/history", { source, topic_key: m.topic_key, project: m.project }) : { items: [] };
  into.replaceChildren(
    h("h2", null, m.title), h("p", null, link("memory", m.id, "Open as wiki page")), h("div", { class: "muted" }, [m.type, m.project, m.topic_key, `rev ${m.revision}`, R.fmtIso(m.updated_at)].filter(Boolean).join(" · ")),
    h("pre", { class: "text" }, m.content), fences(m.content),
    hist.items.length > 1 || (hist.items[0] && hist.items[0].revision > 1) ? h("div", null, h("h2", null, "Topic history"), table("hist", [{ key: "id", label: "#", num: true }, { key: "revision", label: "Rev", num: true }, { key: "updated_at", label: "Updated" }, { key: "deleted_at", label: "Deleted" }], hist.items)) : null);
}

async function viewMemories() {
  const detail = h("section", { class: "panel" }, h("p", { class: "muted" }, "Select a memory to read it."));
  const q = h("input", { type: "search", placeholder: "Search memories", "aria-label": "Search memories", value: state.memQuery || "" });
  const type = h("select", { "aria-label": "Type" }, h("option", { value: "" }, "All types"));
  const mine = h("div", null);
  const load = guarded(async () => {
    state.memQuery = q.value;
    const r = await api("memories", { source: state.memSource, q: q.value, project: $("project").value, type: type.value });
    if (r.available && !type.dataset.ready) { r.facets.types.forEach((t) => type.append(h("option", { value: t }, t))); type.dataset.ready = "1"; }
    mine.replaceChildren(r.available ? (r.items.length ? table("mem", [{ key: "title", label: "Title", link: true }, { key: "type", label: "Type" }, { key: "project", label: "Project" }, { key: "topic_key", label: "Topic" }, { key: "revision", label: "Rev", num: true }, { key: "updated_at", label: "Updated" }], r.items, guarded((row) => showMemory(state.memSource, row.id, detail), detail)) : empty("No matching memories.")) : empty(state.memSource === "engram" ? "Engram database not found or not compatible." : "Memory database not found."));
  }, mine);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  type.addEventListener("change", load);
  await load();
  const files = await api("memory-files");
  const fileDetail = h("pre", { class: "text" }, "");
  fileDetail.hidden = true;
  const fileFences = h("div", null);
  fileFences.hidden = true;
  return [
    h("div", { class: "tabs" }, [["own", "amauta memory"], ["engram", "Engram (read-only)"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": state.memSource === k, onclick: () => { state.memSource = k; state.memQuery = ""; render(); } }, l))),
    panel("Search", h("div", { class: "filters" }, q, type, h("button", { type: "button", onclick: load }, "Search")), mine),
    detail,
    panel(`Claude file memories (${files.items.length})`, files.items.length ? table("mfiles", [{ key: "name", label: "File", link: true }, { key: "project", label: "Project" }, { key: "size", label: "Bytes", num: true }, { key: "mtime", label: "Modified" }], files.items, guarded(async (f) => { const b = await api("memory-file", { id: f.id }); fileDetail.textContent = b.content; fileDetail.hidden = false; fenceDiagrams(b.content, fileFences); }, fileDetail)) : empty("No file memories found."), fileDetail, fileFences),
    await graphifyPanel(),
  ];
}

function graphDiagram(repo, node, depth) {
  const box = h("div", null, h("p", { class: "muted" }, "Rendering..."));
  api("graph/diagram", { repo, node, depth }).then((d) => {
    if (!d.source) box.replaceChildren(empty("Nothing to draw."));
    else box.replaceChildren(diagramBox(d.source, "Neighbors of the selected graph node"), d.truncated || d.nodes > 30 ? empty(`Showing the nearest 30 of ${fmt(d.nodes)} nodes.`) : null);
  }).catch((err) => box.replaceChildren(h("p", { class: "warn" }, String(err.message || err))));
  return box;
}

// One block per --repo: stats, searchable node list, neighbors of the selected node. Data only ever becomes text.
function graphRepo(r) {
  if (!r.available) return { ready: null, el: h("div", null, h("h3", null, r.name), empty(r.reason || "Not available.")) };
  const q = h("input", { type: "search", placeholder: "Search nodes", "aria-label": "Search graph nodes" });
  const depth = h("select", { "aria-label": "Depth" }, [1, 2, 3].map((d) => h("option", { value: String(d) }, `depth ${d}`)));
  const list = h("div", null);
  const near = h("div", null);
  const show = guarded(async (node) => {
    const g = await api("graph/neighbors", { repo: r.path, node: node.id, depth: depth.value });
    near.replaceChildren(h("h3", null, `Neighbors of ${node.label || node.id}`), h("p", null, link("node", `${r.name}::${node.id}`, "Open as wiki page")),
      table("gn-" + r.path, [{ key: "depth", label: "Depth", num: true }, { key: "label", label: "Label" }, { key: "kind", label: "Kind" }, { key: "file", label: "File" }], g.nodes),
      h("h3", null, "Neighborhood diagram"), graphDiagram(r.path, node.id, depth.value),
      g.edges.length ? table("ge-" + r.path, [{ key: "src", label: "From" }, { key: "relation", label: "Relation" }, { key: "dst", label: "To" }], g.edges) : empty("No edges between these nodes."));
  }, near);
  const load = guarded(async () => {
    const g = await api("graph/nodes", { repo: r.path, q: q.value });
    list.replaceChildren(g.items.length ? table("gnodes-" + r.path, [{ key: "label", label: "Node", link: true, attr: "data-graph" }, { key: "kind", label: "Kind" }, { key: "file", label: "File" }], g.items, show) : empty("No matching nodes."));
  }, list);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  const ready = load();
  return { ready, el: h("div", null, h("h3", null, r.name), h("p", { class: "muted" }, `${fmt(r.nodes)} nodes, ${fmt(r.edges)} edges (mirrored ${R.fmtDateTime(r.synced_at)}; graph.json ${R.fmtDateTime(r.graph_mtime)}), ${fmt(r.sql_tables || 0)} SQL tables`),
    h("p", { class: "muted" }, `Semantic pass pending: ${r.semantic_pending ? "yes" : "no"}. Last semantic run: ${r.semantic_at ? `${R.fmtDateTime(r.semantic_at)} (${r.semantic_model || "unknown model"})` : "never"}`),
    h("div", { class: "filters" }, q, depth, h("button", { type: "button", onclick: load }, "Search graph")), list, near) };
}

async function graphifyPanel() {
  const g = await api("graphify");
  if (!g.repos.length) return panel("Graph memory (graphify)", empty("No repositories configured (use --repo)."));
  const blocks = g.repos.map(graphRepo);
  await Promise.all(blocks.map((b) => b.ready));
  return panel("Graph memory (graphify)", ...blocks.map((b) => b.el));
}

// Harness architecture: the archify page lives on its own route with its own sandboxing CSP and is shown in a sandboxed iframe (scripts only, no
// same-origin), so the portal's script-src 'self' is untouched. Without node/archify the server sends the Mermaid text diagram instead.
function archifyBlock(d) {
  if (!d.installed) return null;
  if (d.available && /^\/archify\/[0-9a-f]{64}\.html$/.test(d.url)) {
    return panel("Architecture", h("iframe", { class: "archify-frame", src: d.url, sandbox: "allow-scripts", title: "amauta harness architecture (archify)", referrerpolicy: "no-referrer" }),
      h("p", { class: "muted" }, `${fmt(d.components)} components drawn by archify from the install state.`));
  }
  return panel("Architecture", d.fallback ? diagramBox(d.fallback, "amauta install architecture") : null,
    h("p", { class: "muted" }, `Showing the Mermaid fallback${d.reason ? ": " + d.reason : ""}.`));
}

async function viewHarness() {
  const [hs, odd, arch] = await Promise.all([api("harness"), api("odd"), api("archify").catch(() => ({ installed: false }))]);
  const out = [];
  if (!hs.installed) out.push(panel("Harness", empty("amauta is not installed (no state.json in the state directory).")));
  else {
    out.push(h("div", { class: "grid" }, card("Version", hs.version || "-"), card("RDD mode", hs.rdd_mode || "-"), card("Telemetry", hs.telemetry ? "on" : "off"), card("Managed files", fmt(hs.managed_files)), card("Persona", hs.persona || "-")),
      archifyBlock(arch),
      panel("Components", empty((hs.components || []).join(", ") || "none")),
      panel("Hooks", hs.hooks.length ? table("hooks", [{ key: "event", label: "Event" }, { key: "kind", label: "Kind" }], hs.hooks) : empty("No hooks registered.")),
      panel("MCP servers", hs.mcp_servers.length ? table("mcp", [{ key: "name", label: "Name" }, { key: "type", label: "Type" }, { key: "command", label: "Command" }], hs.mcp_servers) : empty("None.")));
  }
  out.push(panel("ODD task progress", odd.repos.length ? odd.repos.map((r) => h("div", null, h("h2", null, r.repo), r.documents.length ? r.documents.map((d) => h("div", null, h("strong", null, link("feature", d.name.replace(/\.md$/, ""), d.name)), ` ${d.done}/${d.total}`, h("ul", null, d.tasks.map((t) => h("li", null, (t.done ? "[x] " : "[ ] ") + t.title))))) : empty("No odd/tasks/*.md found."))) : empty("No repositories configured (use --repo).")));
  return out;
}

// ---- wiki pages ---------------------------------------------------------------------------------------------
const HINTS = {
  memory: "Memories appear here after mem_save; a bare [[topic]] link points at a topic_key or title.",
  skill: "Skill pages appear after a session loads the skill; usage comes from the telemetry backfill (Refresh usage).",
  tool: "Tool pages appear after a session calls the tool; usage comes from the telemetry backfill (Refresh usage).",
  mcp: "MCP server pages appear after a session calls one of its tools; usage comes from the telemetry backfill.",
  session: "Session pages appear after the usage backfill reads its transcript (Refresh usage).",
  feature: "Feature pages come from odd/tasks/*.md in a repository passed with --repo.",
  node: "Graph node pages come from a mirrored graphify graph; run graphify update and the graph sync for a --repo.",
};
const statusChip = (value) => h("span", { class: `chip chip-${value}` }, (value === "done" ? "● " : value === "pending" ? "○ " : "▲ ") + value);
const isStatus = (v) => v === "done" || v === "pending" || v === "warning";

function skeleton() {
  return h("div", { class: "skeleton", "aria-hidden": "true" }, h("div", { class: "sk sk-title" }), h("div", { class: "sk" }), h("div", { class: "sk" }), h("div", { class: "sk sk-short" }));
}
function teach(title, ...paras) {
  return h("div", { class: "teach" }, h("h1", null, title), ...paras.map((p) => h("p", null, p)), h("p", null, link("home", "", "Back to Home")));
}
function refList(refs) {
  return h("ul", { class: "refs" }, refs.map((r) => h("li", null, link(r.kind, r.id, r.title), h("span", { class: "muted" }, ` ${R.KINDS[r.kind] || r.kind}`))));
}
function railBlock(title, body) { return body ? h("section", { class: "rail-block" }, h("h2", null, title), body) : null; }

function sectionBlock(s) {
  return h("section", { class: "page-section" }, h("h2", null, s.heading), h("ul", { class: "items" }, s.items.map((it) => h("li", null,
    it.kind && it.id ? link(it.kind, it.id, it.label) : h("span", null, it.label),
    it.value == null ? null : isStatus(it.value) ? statusChip(it.value) : h("span", { class: "muted" }, ` ${R.fmtMeta(it)}`)))));
}

function historyBlock(hist) {
  if (!hist) return null;
  if (!hist.available) return h("section", { class: "page-section" }, h("h2", null, "Revision history"), h("p", { class: "muted" }, hist.note));
  const revs = hist.revisions.map((r) => h("li", null, `Revision ${r.revision}`, r.title ? ` ${r.title}` : null, r.updated_at ? h("span", { class: "muted" }, ` ${R.fmtIso(r.updated_at)}`) : null));
  const diffs = hist.diffs.map((d) => h("details", null, h("summary", null, `Revision ${d.from} to ${d.to}`),
    h("div", { class: "diff", role: "group", "aria-label": `Changes from revision ${d.from} to ${d.to}` }, d.lines.map((ln) => { const r = R.diffRow(ln); return h("div", { class: `diff-line diff-${r.name}` }, r.mark + r.text); }))));
  return h("section", { class: "page-section" }, h("h2", null, "Revision history"), h("p", { class: "muted" }, hist.note), h("ul", { class: "items" }, revs), ...diffs);
}

// Calls per day as small bars; the title text and a sentence carry the numbers, so color and shape are never the only signal.
function usageBlock(usage) {
  if (!usage) return null;
  const total = usage.daily.reduce((a, d) => a + d.value, 0);
  const last = usage.daily.length ? usage.daily[usage.daily.length - 1].day : "";
  if (!total) return h("section", { class: "page-section" }, h("h2", null, "Usage over time"), h("p", { class: "muted" }, "No calls recorded yet."));
  const W = 360, H = 60;
  const bars = R.dailyBars(usage.daily, W, H);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H + 14}`, role: "img", "aria-label": `Calls per day over the ${usage.days} days up to ${R.fmtDate(last)}` },
    ...bars.map((b) => svg("g", null, svg("title", null, `${R.fmtDate(b.day)}: ${fmt(b.value)} calls`), svg("rect", { x: b.x, y: b.y, width: b.width, height: b.height, class: "f-input" }))),
    svg("line", { x1: 0, x2: W, y1: H, y2: H, class: "axis" }), svg("text", { x: 0, y: H + 11 }, R.fmtDate(bars[0].day)), svg("text", { x: W, y: H + 11, "text-anchor": "end" }, R.fmtDate(last)));
  return h("section", { class: "page-section" }, h("h2", null, "Usage over time"), h("p", { class: "muted" }, `${fmt(total)} calls in the ${usage.days} days up to ${R.fmtDate(last)}.`), h("div", { class: "spark" }, root));
}

// ODD feature: a progress bar with its number, state chips (shape plus label) and the commits the document mentions that git could resolve.
function progressBlock(pg) {
  if (!pg.progress) return null;
  const p = R.progress(pg.progress.done, pg.progress.total);
  const pending = pg.progress.total - pg.progress.done;
  return h("section", { class: "progress-block", "aria-label": "Task progress" },
    h("progress", { max: Math.max(pg.progress.total, 1), value: pg.progress.done, "aria-label": p.label }),
    h("p", null, h("strong", null, p.label), ` (${p.percent}%)`, statusChip("done"), ` ${pg.progress.done}`, statusChip("pending"), ` ${pending}`));
}

function commitsBlock(commits) {
  if (!commits || !commits.length) return null;
  return h("section", { class: "page-section" }, h("h2", null, "Commits"), h("ul", { class: "items" }, commits.map((c) => h("li", null, h("code", null, c.hash), ` ${c.subject}`, h("span", { class: "muted" }, ` ${R.fmtDate(c.date)}`)))));
}

// Graph node: the neighborhood diagram is drawn lazily (mermaid loads on first use) from source the server generated with every label escaped.
function nodeDiagramBlock(diagram) {
  if (!diagram || !diagram.source) return null;
  return h("section", { class: "page-section" }, h("h2", null, "Neighborhood"), diagramBox(diagram.source, "Neighbors of this graph node"),
    diagram.truncated ? h("p", { class: "muted" }, `Showing the nearest ${R.NODE_CAP} of ${fmt(diagram.nodes)} nodes.`) : null);
}

// ODD feature: tasks grouped by phase in a grid (shape + word + class carry the status); long documents are capped server-side.
function taskDiagramBlock(pg) {
  const d = pg.diagram;
  if (pg.kind !== "feature" || !d || !d.source) return null;
  return h("section", { class: "page-section" }, h("h2", null, "Task grid"), diagramBox(d.source, "Tasks of this feature grouped by phase and status"),
    d.tasks > d.shown ? h("p", { class: "muted" }, `Showing the first ${d.shown} of ${fmt(d.tasks)} tasks.`) : null);
}

// Skill impact (comparative): the metrics with their sample sizes, then the change log with before/after deltas. Direction is a shape plus words.
function markSpan(m) {
  const d = R.deltaMark(m);
  return h("span", { class: `mark mark-${d.name}` }, `${d.mark} ${d.text}`);
}
function impactRow(name, m) {
  const reason = m.suppressed ? h("div", { class: "muted" }, m.reason || "too few sessions") : null;
  return h("tr", null, h("td", null, m.label, reason), h("td", { class: "n" }, R.fmtMetric(name, m.exposed.value)), h("td", { class: "n" }, R.fmtMetric(name, m.baseline.value)),
    h("td", null, markSpan(m), m.delta == null ? null : h("span", { class: "muted" }, ` ${R.fmtDelta(name, m.delta)}`)),
    h("td", { class: "n" }, `${fmt(m.exposed.n)} / ${fmt(m.baseline.n)}`));
}
function changeItem(c) {
  const head = c.kind === "installed" ? `Installed version ${c.label}` : `Commit ${c.label}`;
  const when = R.fmtDate(c.when || c.ts);
  const lines = c.suppressed ? [h("p", { class: "muted" }, c.reason || "too few sessions")] : Object.entries(c.metrics).filter(([, m]) => m.delta != null).map(([name, m]) =>
    h("li", null, `${m.label}: ${R.fmtMetric(name, m.before)} to ${R.fmtMetric(name, m.after)} `, markSpan(m), h("span", { class: "muted" }, ` (n ${fmt(m.n_before)} before, ${fmt(m.n_after)} after)`)));
  return h("li", null, h("strong", null, head), h("span", { class: "muted" }, `, ${when}: ${fmt(c.before_sessions)} sessions before, ${fmt(c.after_sessions)} after`), c.suppressed ? lines[0] : h("ul", { class: "items" }, lines));
}
function impactBlock(im) {
  if (!im) return null;
  const title = h("h2", null, "Impact (comparative)");
  const note = h("p", { class: "note" }, im.note);
  if (!im.available) return h("section", { class: "page-section impact" }, title, note, h("p", { class: "muted" }, im.reason || "No data yet."));
  if (!im.exposed_sessions) return h("section", { class: "page-section impact" }, title, note, h("p", { class: "muted" }, `This skill was not loaded in the last ${im.days} days, so there is nothing to compare.`));
  const scope = im.control_scope === "same-project" ? "same project" : "all projects";
  const m = im.metrics, u = m.unused_after_load;
  const rows = ["error_rate", "retry_rate", "tokens_per_turn", "test_failure_rate"].map((k) => impactRow(k, m[k]));
  const ch = im.changes || { versions: [], commits: [], changes: [] };
  return h("section", { class: "page-section impact" }, title, note,
    h("p", null, `${im.exposed_sessions} sessions loaded this skill in the last ${im.days} days; ${im.control_sessions} sessions without it (${scope}) form the baseline. Values below ${im.min_sessions} sessions on either side are withheld.`),
    im.outcomes_recorded ? null : h("p", { class: "muted" }, "Tool outcomes are not recorded yet: run Refresh usage so the transcripts are read again."),
    h("table", { class: "compact" }, h("thead", null, h("tr", null, h("th", null, "Metric"), h("th", { class: "n" }, "After load"), h("th", { class: "n" }, "Baseline"), h("th", null, "Difference"), h("th", { class: "n" }, "n (calls or turns)"))), h("tbody", null, rows)),
    h("p", null, u.suppressed ? `Loaded but unused: ${u.n} loaded sessions, ${u.reason || "too few to show a share"}.` : `Loaded but unused: ${u.unused} of ${u.n} loaded sessions (${R.fmtMetric("rate", u.value)}) ended with no tool call after the load.`),
    h("h3", null, "Change log"),
    ch.versions.length ? h("p", { class: "muted" }, "Installed versions (first seen): " + ch.versions.map((v) => `${v.hash}${v.current ? " (current)" : ""} ${R.fmtDate(v.first_seen)}`).join(", ")) : null,
    ch.changes.length ? h("ul", { class: "items" }, ch.changes.map(changeItem)) : h("p", { class: "muted" }, "No change recorded yet: a skill needs a second installed version or a git commit (a repository passed with --repo that holds it) to compare before and after."));
}

function pageExtras(pg) {
  return [usageBlock(pg.usage), pg.kind === "skill" ? impactBlock(pg.impact) : null, historyBlock(pg.history), commitsBlock(pg.commits), taskDiagramBlock(pg), pg.kind === "node" ? nodeDiagramBlock(pg.diagram) : null];
}

function bodyNodes(pg) {
  const known = (kind, id) => !(pg.missing || []).some((m) => m.kind === kind && m.id === id);
  let diagrams = 0;
  const mermaid = (src) => (++diagrams <= 5 ? diagramBox(src, "Mermaid diagram") : h("pre", { class: "code" }, h("code", null, src)));
  return MD.toDom(MD.parse(pg.body_md), document, { known, mermaid, headingOffset: 1 });
}

async function viewWikiPage(kind, id) {
  let pg;
  try { pg = await api("wiki/page", { kind, id }); } catch (err) {
    if (/not found/i.test(String(err.message))) return [teach(`No ${(R.KINDS[kind] || kind).toLowerCase()} page`, `Nothing is stored under ${id}.`, HINTS[kind] || "")];
    throw err;
  }
  document.title = `${pg.title} - amauta`;
  const meta = pg.meta.length ? h("dl", { class: "meta" }, pg.meta.flatMap((m) => { const v = R.fmtMeta(m); return [h("dt", null, m.label), h("dd", { class: R.isLongToken(v) ? "tok" : false }, v)]; })) : null;
  return [h("div", { class: "page" },
    h("article", { class: "doc" },
      h("p", { class: "kind" }, R.KINDS[pg.kind] || pg.kind), h("h1", null, pg.title), progressBlock(pg),
      pg.body_md ? h("div", { class: "prose" }, bodyNodes(pg)) : null,
      ...pg.sections.map(sectionBlock), ...pageExtras(pg)),
    h("aside", { class: "rail", "aria-label": "Page details" }, railBlock("Details", meta), railBlock("Links", pg.links.length ? refList(pg.links) : null), railBlock("Linked from", pg.backlinks.length ? refList(pg.backlinks) : null)))];
}

async function viewFeatures() {
  const odd = await api("odd");
  const docs = odd.repos.flatMap((r) => r.documents.map((d) => ({ ...d, repo: r.repo })));
  if (!docs.length) return [teach("ODD features", "Feature documents appear here when a repository passed with --repo has odd/tasks/*.md.")];
  return [h("h1", null, "ODD features"), h("ul", { class: "items" }, docs.map((d) => h("li", null, link("feature", d.name.replace(/\.md$/, ""), d.name), h("span", { class: "muted" }, ` ${d.repo}`), ` ${d.done}/${d.total} tasks done`)))];
}

async function viewGraph() { return [h("h1", null, "Graph"), await graphifyPanel()]; }

// ---- Settings editor: a closed list of options, always preview -> confirm -> apply, with undo ----------------------------------------
const SETTING_OPTIONS = [
  ["persona", "Persona", [["gentleman", "Gentleman"], ["neutral", "Neutral"]], "How Claude talks to you: gentleman is warm and mentoring, neutral is plain and direct. Applying swaps the installed output style and the persona section of CLAUDE.md."],
  ["review_mode", "Review mode", [["off", "Off"], ["on", "On"]], "On: after each commit amauta assesses the risk of the change and may ask for a review before you go on. Off: no review reminders."],
  ["telemetry", "Telemetry", [["on", "On"], ["off", "Off"]], "On: hooks record which tools ran, how long they took and how big they were, into your own local database (never content, never sent anywhere). Off: those hooks are removed."],
];
const SETTING_MODULES = [
  ["sdd", "Spec-driven development (SDD)", "Skills, agents and /amauta-sdd-* commands for planned changes, plus a safety hook that checks sdd agents before they start."],
  ["rea", "Reverse engineering (rea)", "Registers the rea MCP server in Claude Code so it can inspect binaries and packaged apps."],
  ["context7", "Library docs (context7)", "Registers the context7 MCP server so Claude can look up current library documentation."],
  ["impeccable", "Frontend design (impeccable)", "Installs the design skill and downloads its pinned engine with npm (needs the network once)."],
  ["archify", "Architecture diagrams (archify)", "Installs the diagram skill (runs offline). The Harness page uses it to draw the architecture."],
];
const setDisabled = (el, on) => { if (on) el.setAttribute("disabled", ""); else el.removeAttribute("disabled"); };

async function postJson(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Portal-Token": token, Accept: "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function planBlock(res) {
  const p = res.plan || {}, files = p.files || [], removed = p.removed || [], skipped = p.skipped || [];
  const list = (title, items) => items.length ? h("details", null, h("summary", null, `${title} (${items.length})`), h("ul", { class: "plain-list" }, items.slice(0, 40).map((f) => h("li", null, h("code", null, f))), items.length > 40 ? h("li", { class: "muted" }, `and ${items.length - 40} more`) : null)) : null;
  return h("div", { class: "plan" },
    res.changes.length ? h("ul", { class: "plain-list" }, res.changes.map((c) => h("li", null, `${settingLabel(c.key)}: ${c.from} → ${c.to}`)))
      : h("p", null, res.repair ? "No option changes. Repair re-applies the current settings." : "No option changes."),
    h("p", null, `${files.length} file(s) written, ${removed.length} removed, ${skipped.length} kept because you edited them.`),
    p.changed === false ? h("p", { class: "muted" }, "Everything is already in place, so applying changes nothing.") : null,
    p.impeccable && p.impeccable.engine === "would-install" ? h("p", null, "npm will download the pinned impeccable engine.") : null,
    list("Files written", files), list("Files removed", removed), list("Kept because you edited them", skipped));
}
function settingLabel(key) {
  if (key.startsWith("module:")) return `Module ${key.slice(7)}`;
  return { persona: "Persona", review_mode: "Review mode", telemetry: "Telemetry" }[key] || key;
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
    for (const [key, el] of marks) { const c = changes.find((x) => x.key === key); el.textContent = c ? `◆ changed, was ${c.from}` : ""; }
    if (previewBtn) setDisabled(previewBtn, changes.length === 0);
  };
  const option = (key, id, label, choices, value, help) => {
    const mark = h("span", { class: "changed" });
    marks.set(key, mark);
    const select = h("select", { id, "aria-describedby": `${id}-help` }, choices.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
    select.value = value;
    select.addEventListener("change", (e) => {
      const v = e.target.value;
      if (key.startsWith("module:")) draft.modules[key.slice(7)] = v; else draft[key] = v;
      refreshMarks();
    });
    return h("div", { class: "option" }, h("label", { for: id }, label), select, h("span", { class: "current" }, `now ${value}`), mark, h("p", { id: `${id}-help`, class: "option-help muted" }, help));
  };
  const buildForm = () => {
    draft = copy(info.current);
    marks.clear();
    previewBtn = h("button", { type: "button", disabled: true }, "Preview changes");
    previewBtn.addEventListener("click", () => runPreview(false));
    repairBtn = h("button", { type: "button" }, "Preview repair");
    repairBtn.addEventListener("click", () => runPreview(true));
    formBox.replaceChildren(...[
      info.installed ? null : h("p", { class: "notice" }, "amauta is not installed yet. Previewing and applying here runs the installer for the first time."),
      h("div", { class: "options" },
        ...SETTING_OPTIONS.map(([key, label, choices, help]) => option(key, `set-${key.replace("_", "-")}`, label, choices, info.current[key], help)),
        h("h2", null, "Optional modules"),
        ...SETTING_MODULES.map(([name, label, help]) => option(`module:${name}`, `set-module-${name}`, label, [["off", "Off"], ["on", "On"]], info.current.modules[name], help))),
      h("div", { class: "actions" }, previewBtn),
      h("section", { class: "repair" }, h("h2", null, "Reinstall / repair"),
        h("p", { class: "muted" }, "Re-applies the current settings: restores missing or outdated files that amauta installed. Files you edited are kept."), h("div", { class: "actions" }, repairBtn))].filter(Boolean));
    refreshMarks();
  };

  const busy = (text) => { out.replaceChildren(h("p", { role: "status", class: "muted" }, text)); };
  const fail = (res, retry) => {
    const adv = R.settingsAdvice(res.status);
    out.replaceChildren(h("div", { class: "notice warn", role: "alert" }, h("p", null, `▲ ${(res.data && res.data.error) || `Request failed (${res.status})`}`),
      res.data && res.data.detail ? h("p", { class: "muted" }, h("code", null, res.data.detail)) : null, h("p", null, adv.text),
      adv.again ? (() => { const b = h("button", { type: "button" }, "Preview again"); b.addEventListener("click", () => retry()); return b; })() : null));
  };
  const askConfirm = (text, yes, onYes, onNo) => {
    const ok = h("button", { type: "button", class: "primary" }, yes), no = h("button", { type: "button" }, "Go back");
    ok.addEventListener("click", onYes); no.addEventListener("click", onNo);
    return h("div", { class: "confirm", role: "group", "aria-label": "Confirm" }, h("p", null, text), h("div", { class: "actions" }, ok, no));
  };

  async function runPreview(repair) {
    const body = R.settingsBody(info.current, draft, repair);
    setDisabled(previewBtn, true); setDisabled(repairBtn, true);
    busy("Checking what would change. Nothing is written yet.");
    let res;
    try { res = await postJson("/api/settings/preview", body); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    setDisabled(repairBtn, false); refreshMarks();
    if (!res.ok) return fail(res, () => runPreview(repair));
    showPlan(res.data, repair);
  }
  function showPlan(plan, repair) {
    const confirmBox = h("div", null);
    const apply = h("button", { type: "button", class: "primary" }, "Apply changes");
    apply.addEventListener("click", () => {
      setDisabled(apply, true);
      confirmBox.replaceChildren(askConfirm("This changes your Claude Code configuration. A backup is made first and you can undo it from here.", "Yes, apply now", () => runApply(plan), () => { setDisabled(apply, false); confirmBox.replaceChildren(); }));
    });
    const cancel = h("button", { type: "button" }, "Discard preview");
    cancel.addEventListener("click", () => out.replaceChildren());
    out.replaceChildren(h("section", { class: "panel" }, h("h2", null, "Preview: what would change"), planBlock(plan), h("p", { class: "muted" }, `This preview is valid for ${Math.round((plan.expires_in || 300) / 60)} minutes.`), h("div", { class: "actions" }, apply, cancel), confirmBox));
  }
  async function runApply(plan) {
    busy("Applying. This can take a while when a module downloads something.");
    let res;
    try { res = await postJson("/api/settings/apply", { apply_token: plan.apply_token, confirm: true }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runPreview(false));
    const d = res.data;
    const undo = d.undo_available ? h("button", { type: "button" }, "Undo this change") : null;
    if (undo) undo.addEventListener("click", () => { setDisabled(undo, true); runUndoPreview(); });
    out.replaceChildren(h("section", { class: "panel", role: "status" }, h("h2", null, "Applied."),
      h("p", null, `✓ ${d.files.length} file(s) written, ${d.removed.length} removed.`), d.backup ? h("p", null, `Backup: ${d.backup}`) : h("p", { class: "muted" }, "Nothing needed a backup."),
      d.skipped.length ? h("p", { class: "muted" }, `${d.skipped.length} file(s) you edited were kept.`) : null,
      d.impeccable && d.impeccable.engine === "failed" ? h("p", { class: "warn" }, `▲ The impeccable engine was not installed: ${d.impeccable.detail || "npm failed"}. Run Reinstall / repair to retry.`) : null,
      h("div", { class: "actions" }, undo)));
    await reload();
  }
  async function runUndoPreview() {
    busy("Checking what undoing would change.");
    let res;
    try { res = await postJson("/api/settings/undo/preview", {}); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runUndoPreview());
    const plan = res.data, confirmBox = h("div", null);
    const revert = h("button", { type: "button", class: "primary" }, "Revert these changes");
    revert.addEventListener("click", () => {
      setDisabled(revert, true);
      confirmBox.replaceChildren(askConfirm("Undo re-runs the installer with the previous values and makes a fresh backup. Files you changed by hand since are not overwritten wholesale.", "Yes, undo", () => runUndo(plan), () => { setDisabled(revert, false); confirmBox.replaceChildren(); }));
    });
    const cancel = h("button", { type: "button" }, "Discard preview");
    cancel.addEventListener("click", () => out.replaceChildren());
    out.replaceChildren(h("section", { class: "panel" }, h("h2", null, "Preview: what undoing would change"), planBlock(plan),
      h("p", { class: "muted" }, `Undo re-runs the installer with the settings from before your change. This preview is valid for ${Math.round((plan.expires_in || 300) / 60)} minutes.`),
      h("div", { class: "actions" }, revert, cancel), confirmBox));
  }
  async function runUndo(plan) {
    busy("Undoing the change.");
    let res;
    try { res = await postJson("/api/settings/undo", { apply_token: plan.apply_token, confirm: true }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runUndoPreview());
    const d = res.data;
    out.replaceChildren(h("section", { class: "panel", role: "status" }, h("h2", null, "Undone."), h("p", null, `✓ ${d.files.length} file(s) written, ${d.removed.length} removed.`),
      d.backup ? h("p", null, `Backup: ${d.backup}`) : h("p", { class: "muted" }, "Nothing needed a backup."),
      h("p", { class: "muted" }, "If the change had downloaded an npm engine, run Reinstall / repair to bring it back.")));
    await reload();
  }
  async function reload() {
    try { info = await api("settings"); buildForm(); } catch (_) { /* the page keeps what it shows */ }
  }

  buildForm();
  root.append(h("h1", null, "Settings"),
    h("p", { class: "muted" }, "A short, closed list of harness options. Every change is previewed first, needs your confirmation, makes a backup and can be undone (also previewed first). Nothing else about Claude Code is editable here."),
    formBox, out);
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
  if (!days.length) return h("p", { class: "muted" }, "Memories saved, sessions and ODD document edits appear here, grouped by day.");
  return h("div", null, localDays(days).map((d) => h("section", { class: "page-section day" }, h("h2", null, d.day),
    h("ul", { class: "items" }, d.items.map((i) => h("li", null, h("span", { class: "muted" }, `${R.KINDS[i.kind] || i.kind} `), link(i.kind, i.id, i.title), h("span", { class: "muted" }, ` ${i.what}, ${R.fmtDateTime(i.ts).slice(11) || "?"}`)))))));
}
function spendingBlock(sp) {
  if (!sp.available) return h("p", { class: "muted" }, "Spending appears after the usage backfill: open Usage and choose Refresh usage.");
  const by = Object.fromEntries(sp.windows.map((w) => [w.days, w]));
  const cols = sp.windows.map((w) => w.days);
  return h("div", null,
    h("table", { class: "compact" }, h("thead", null, h("tr", null, h("th", null, "Tokens"), cols.map((d) => h("th", { class: "n" }, `${d} days`)))),
      h("tbody", null, KINDS.map(([k, label]) => h("tr", null, h("td", null, label), cols.map((d) => h("td", { class: "n" }, short(by[d][k]))))))),
    h("p", null, `Cache hit ratio over ${cols[cols.length - 1]} days: `, h("strong", null, pct(sp.cache_hit_ratio))),
    sp.top_models.length ? h("div", null, h("h3", null, "Top models"), h("ul", { class: "refs" }, sp.top_models.map((m) => h("li", null, m.model, h("span", { class: "muted" }, ` ${short(m.tokens)} tokens`))))) : null,
    h("p", null, link("usage", "", "Usage details")));
}
function healthBlock(hl) {
  if (!hl.installed) return h("p", { class: "muted" }, "amauta is not installed (no state.json in the state directory).");
  const rows = [["Version", hl.version || "-"], ["Hooks", fmt(hl.hooks)], ["MCP servers", fmt(hl.mcp_servers)], ["Skills", fmt(hl.skills)], ["Agents", fmt(hl.agents)], ["Telemetry", hl.telemetry ? "on" : "off"]];
  return h("div", null, h("dl", { class: "meta" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, String(v))])), h("p", null, link("harness", "", "Harness details")));
}
function impactRankBlock(rk) {
  if (!rk || !rk.available) return null;
  const line = (r) => h("li", null, `${r.verdict === "better" ? "▼" : "▲"} `, link("skill", r.skill, r.skill),
    h("span", { class: "muted" }, ` ${R.fmtDelta("error_rate", r.delta)} error rate, ${fmt(r.n)} calls, ${fmt(r.sessions)} sessions`));
  const list = (title, rows) => (rows.length ? h("div", null, h("h3", null, title), h("ul", { class: "refs" }, rows.map(line))) : null);
  const none = !rk.best.length && !rk.worst.length;
  return h("div", null,
    none ? h("p", { class: "muted" }, `No skill has ${rk.min_sessions} or more sessions with and without it yet.`) : null,
    list("Lower error rate after load", rk.best), list("Higher error rate after load", rk.worst),
    h("p", { class: "muted" }, `${rk.ranked} of ${rk.tracked} skills have enough sessions (last ${rk.days} days). ${rk.note}`));
}
async function viewHome() {
  const hm = await api("wiki/home");
  return [h("div", { class: "page" }, h("article", { class: "doc" }, h("h1", null, "Recent activity"), activityBlock(hm.activity)),
    h("aside", { class: "rail", "aria-label": "Spending and harness" }, railBlock("Spending", spendingBlock(hm.spending)), railBlock("Skill impact", impactRankBlock(hm.impact)), railBlock("Harness health", healthBlock(hm.health))))];
}
// Lint: candidates worth a second look, counted per check and linked to their pages. Wording is "review", never a verdict.
function lintItem(it) {
  const people = Array.isArray(it.members) && it.members.length > 1
    ? h("ul", { class: "refs" }, it.members.map((m) => h("li", null, link(m.kind, m.id, m.title), m.topic_key ? h("span", { class: "muted" }, ` ${m.topic_key}`) : null)))
    : null;
  return h("li", null, people ? h("span", null, "Group: ") : link(it.kind, it.id, it.title), it.detail ? h("span", { class: "muted" }, ` ${it.detail}`) : null, people);
}
function lintCategory(c) {
  return h("section", { class: "page-section lint-cat" }, h("h2", null, `${c.title} (${fmt(c.count)})`), h("p", { class: "muted" }, c.note),
    c.items.length ? h("ul", { class: "items" }, c.items.map(lintItem)) : h("p", null, "Nothing to review."),
    c.truncated ? h("p", { class: "muted" }, `Showing ${c.items.length} of ${fmt(c.count)}.`) : null);
}
async function viewLint() {
  const l = await api("wiki/lint");
  const sc = l.scanned || {};
  return [h("div", { class: "page" }, h("article", { class: "doc" }, h("h1", null, "Lint"),
    h("p", { class: "muted" }, `Read-only checks over ${fmt(sc.memories)} memories, installed skills and ODD documents${sc.capped ? " (only the newest memories were scanned)" : ""}. These are prompts to review, not errors.`),
    l.categories.map(lintCategory)))];
}
async function viewUsagePage() { return [...(await viewOverview()), ...(await viewUsage())]; }

async function renderRoute(route, changed) {
  const { kind, id } = route;
  if (kind === "unknown") return [teach("Not a wiki page", `The address ${id} does not match any page.`)];
  if (id && ["memory", "skill", "tool", "mcp", "session", "feature", "node"].includes(kind)) return viewWikiPage(kind, id);
  if (changed && ["skill", "tool", "mcp"].includes(kind)) state.usageKind = { skill: "skills", tool: "tools", mcp: "mcp_servers" }[kind];
  const views = { home: viewHome, usage: viewUsagePage, skill: viewUsage, tool: viewUsage, mcp: viewUsage, session: viewSessions, memory: viewMemories, feature: viewFeatures, node: viewGraph, harness: viewHarness, settings: viewSettings, lint: viewLint };
  return views[kind]();
}

function renderNav(route) {
  $("nav").replaceChildren(...SECTIONS.map(([heading, items]) => h("section", { class: "nav-section" }, h("h2", null, heading),
    h("ul", null, items.map(([k, label]) => h("li", null, link(k, "", label, { "aria-current": k === route.kind ? "page" : false })))))));
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const route = state.route;
  const key = `${route.kind}/${route.id}`;
  const changed = state.shown !== key;
  renderNav(route);
  $("filters").hidden = !R.showsFilters(route);
  $("shell").setAttribute("data-nav", "closed");
  $("nav-toggle").setAttribute("aria-expanded", "false");
  document.title = `${R.KINDS[route.kind] || "amauta"} - amauta`;
  if (changed) { $("view").setAttribute("aria-busy", "true"); $("view").replaceChildren(skeleton()); }
  try {
    const nodes = await renderRoute(route, changed);
    if (seq !== renderSeq) return;
    $("view").replaceChildren(...nodes);
    state.shown = key;
    if (changed && $("view").focus) $("view").focus({ preventScroll: true });
  } catch (err) {
    if (seq === renderSeq) { $("view").replaceChildren(panel("Error", h("p", { class: "warn" }, String(err.message || err)))); state.shown = key; }
  } finally {
    if (seq === renderSeq) $("view").setAttribute("aria-busy", "false");
  }
}

async function loadRecent() {
  const box = $("recent");
  try {
    const r = await api("wiki/recent", { limit: 12 });
    box.replaceChildren(r.items.length
      ? h("ul", { class: "refs" }, r.items.map((i) => h("li", null, link(i.kind, i.id, i.title), h("span", { class: "muted" }, ` ${i.what}, ${R.fmtDateTime(i.ts)}`))))
      : h("p", { class: "muted" }, "Saved memories, sessions and ODD document edits appear here."));
  } catch (_) { box.replaceChildren(h("p", { class: "muted" }, "Recent changes are unavailable.")); }
}

async function loadProjects() {
  try {
    const s = await api("sessions", { days: 3650, limit: 1 });
    const cur = $("project").value;
    $("project").replaceChildren(h("option", { value: "" }, "All projects"), ...s.projects.map((p) => h("option", { value: p.project }, p.project)));
    $("project").value = cur;
  } catch (_) { /* optional */ }
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
function paintResults(groups, q) {
  const box = $("palette-results");
  palette.items = R.flattenResults(groups);
  palette.nodes = [];
  if (!palette.items.length) { box.replaceChildren(h("p", { class: "muted" }, `No results for "${q}". Memories, skills, tools, sessions, ODD features and graph nodes are searched.`)); return; }
  let flat = 0;
  box.replaceChildren(...groups.map((g) => h("div", { class: "pal-group", role: "group", "aria-label": g.kind }, h("div", { class: "pal-head" }, `${g.kind} (${g.count})`),
    g.items.map((it) => {
      const i = flat++;
      const node = h("div", { role: "option", id: `pal-${i}`, class: "pal-item", "aria-selected": "false", onclick: () => goResult(i) },
        h("span", { class: "pal-kind" }, g.kind), h("span", { class: "pal-title" }, it.title), it.snippet ? h("span", { class: "pal-snip muted" }, it.snippet) : null);
      palette.nodes.push(node);
      return node;
    }))));
  selectResult(0);
}
async function runSearch() {
  const q = $("palette-input").value.trim();
  const seq = ++palette.seq;
  if (!q) { palette.items = []; palette.nodes = []; $("palette-results").replaceChildren(h("p", { class: "muted" }, "Type to search. Arrow keys move, Enter opens, Esc closes.")); return; }
  try {
    const r = await api("wiki/search", { q });
    if (seq === palette.seq) paintResults(r.groups, q);
  } catch (err) {
    if (seq === palette.seq) { palette.items = []; palette.nodes = []; $("palette-results").replaceChildren(h("p", { class: "warn" }, `Search failed: ${String(err.message || err)}`)); }
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
  $("status").textContent = "Refreshing...";
  try {
    const r = await fetch("/api/refresh", { method: "POST", headers: { "X-Portal-Token": token } });
    const b = await r.json();
    $("status").textContent = r.ok ? `Done: ${b.messages} new message(s) from ${b.files} file(s).` : `Failed: ${b.error}`;
    await loadProjects();
    loadRecent();
    render();
  } catch (err) { $("status").textContent = "Failed: " + err.message; }
});
for (const id of ["days", "project"]) $(id).addEventListener("change", render);
window.addEventListener("hashchange", () => { state.route = R.parseHash(location.hash); render(); });
state.route = R.parseHash(location.hash);
loadRecent();
loadProjects().then(render);
// Liveness signal: lets a launcher-started server exit once the window is gone. Failures are silent on purpose.
function heartbeat() { fetch("/api/heartbeat", { method: "POST", headers: { "X-Portal-Token": token } }).catch(() => {}); }
heartbeat();
setInterval(heartbeat, 10000);
