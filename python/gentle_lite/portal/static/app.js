"use strict";
// All data reaches the DOM through text nodes only (never as HTML strings), so data can never become markup.
const token = document.querySelector('meta[name="portal-token"]').content;
const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const VIEWS = [["overview", "Overview"], ["usage", "Usage"], ["sessions", "Sessions"], ["memories", "Memories"], ["harness", "Harness"]];
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
const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString("en-US"));
const short = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0));
const pct = (r) => (r == null ? "-" : (r * 100).toFixed(1) + "%");

async function api(path, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const r = await fetch(`/api/${path}${q.toString() ? "?" + q : ""}`, { headers: { Accept: "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

const state = { view: "overview", usageKind: "skills", memSource: "own", sort: {} };
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
    onkeydown: (e) => { if (e.key === "Enter") e.target.click(); },
  }, c.label, s.key === c.key ? (s.dir > 0 ? " ▲" : " ▼") : "")));
  const body = sorted.map((r) => h("tr", null, columns.map((c) => h("td", { class: c.num ? "n" : "" },
    c.link && onRow ? h("button", { class: "row-link", type: "button", [c.attr || "data-row"]: "1", onclick: () => onRow(r) }, r[c.key]) : c.render ? c.render(r[c.key], r) : c.num ? fmt(r[c.key]) : r[c.key] ?? "-"))));
  return h("div", { class: "scroll" }, h("table", null, h("thead", null, head), h("tbody", null, body)));
}

function legend() { return h("div", { class: "legend" }, KINDS.map(([k, l]) => h("span", null, h("span", { class: `sw f-${k}` }), l))); }

function stackedChart(daily) {
  if (!daily.length) return empty("No usage in this range.");
  const W = 720, H = 220, L = 44, B = 22, T = 8, R = 6;
  const totals = daily.map((d) => KINDS.reduce((a, [k]) => a + (d[k] || 0), 0));
  const max = Math.max(...totals, 1);
  const bw = (W - L - R) / daily.length;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Tokens per day" });
  for (const f of [0, 0.5, 1]) {
    const y = T + (H - T - B) * (1 - f);
    root.append(svg("line", { x1: L, x2: W - R, y1: y, y2: y, class: "axis" }), svg("text", { x: L - 4, y: y + 4, "text-anchor": "end" }, short(max * f)));
  }
  daily.forEach((d, i) => {
    let y = H - B;
    const g = svg("g", null, svg("title", null, `${d.day}: ` + KINDS.map(([k, l]) => `${l} ${fmt(d[k])}`).join(", ")));
    for (const [k] of KINDS) {
      const hgt = ((d[k] || 0) / max) * (H - T - B);
      y -= hgt;
      if (hgt > 0) g.append(svg("rect", { x: L + i * bw + 1, y, width: Math.max(bw - 2, 1), height: hgt, class: `f-${k}` }));
    }
    root.append(g);
    if (daily.length <= 12 || i % Math.ceil(daily.length / 8) === 0) root.append(svg("text", { x: L + i * bw + bw / 2, y: H - 6, "text-anchor": "middle" }, d.day.slice(5)));
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
  const cols = [{ key: "name", label: "Name" }, { key: "count", label: "Calls", num: true }, { key: "sessions", label: "Sessions", num: true }, { key: "last_used", label: "Last used" }];
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
    panel("Sessions", table("sessions", [{ key: "session_id", label: "Session", render: (v) => String(v).slice(0, 8) }, { key: "project", label: "Project" }, { key: "last_ts", label: "Last activity" }, { key: "model", label: "Model" }, ...nums], s.sessions)),
  ];
}

// Event handlers run outside render()'s try/catch: show the failure where the result would have gone.
function guarded(fn, into) {
  return async (...args) => {
    try { await fn(...args); } catch (err) { into.hidden = false; into.replaceChildren(h("p", { class: "warn" }, String(err.message || err))); }
  };
}

async function showMemory(source, id, into) {
  const m = await api("memory", { source, id });
  const hist = m.topic_key ? await api("memory/history", { source, topic_key: m.topic_key, project: m.project }) : { items: [] };
  into.replaceChildren(
    h("h2", null, m.title), h("div", { class: "muted" }, [m.type, m.project, m.topic_key, `rev ${m.revision}`, m.updated_at].filter(Boolean).join(" · ")),
    h("pre", { class: "text" }, m.content),
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
  return [
    h("div", { class: "tabs" }, [["own", "gentle-lite memory"], ["engram", "Engram (read-only)"]].map(([k, l]) => h("button", { type: "button", "aria-pressed": state.memSource === k, onclick: () => { state.memSource = k; state.memQuery = ""; render(); } }, l))),
    panel("Search", h("div", { class: "filters" }, q, type, h("button", { type: "button", onclick: load }, "Search")), mine),
    detail,
    panel(`Claude file memories (${files.items.length})`, files.items.length ? table("mfiles", [{ key: "name", label: "File", link: true }, { key: "project", label: "Project" }, { key: "size", label: "Bytes", num: true }, { key: "mtime", label: "Modified" }], files.items, guarded(async (f) => { const b = await api("memory-file", { id: f.id }); fileDetail.textContent = b.content; fileDetail.hidden = false; }, fileDetail)) : empty("No file memories found."), fileDetail),
    await graphifyPanel(),
  ];
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
    near.replaceChildren(h("h3", null, `Neighbors of ${node.label || node.id}`),
      table("gn-" + r.path, [{ key: "depth", label: "Depth", num: true }, { key: "label", label: "Label" }, { key: "kind", label: "Kind" }, { key: "file", label: "File" }], g.nodes),
      g.edges.length ? table("ge-" + r.path, [{ key: "src", label: "From" }, { key: "relation", label: "Relation" }, { key: "dst", label: "To" }], g.edges) : empty("No edges between these nodes."));
  }, near);
  const load = guarded(async () => {
    const g = await api("graph/nodes", { repo: r.path, q: q.value });
    list.replaceChildren(g.items.length ? table("gnodes-" + r.path, [{ key: "label", label: "Node", link: true, attr: "data-graph" }, { key: "kind", label: "Kind" }, { key: "file", label: "File" }], g.items, show) : empty("No matching nodes."));
  }, list);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  const ready = load();
  return { ready, el: h("div", null, h("h3", null, r.name), h("p", { class: "muted" }, `${fmt(r.nodes)} nodes, ${fmt(r.edges)} edges (mirrored ${r.synced_at}; graph.json ${r.graph_mtime})`),
    h("div", { class: "filters" }, q, depth, h("button", { type: "button", onclick: load }, "Search graph")), list, near) };
}

async function graphifyPanel() {
  const g = await api("graphify");
  if (!g.repos.length) return panel("Graph memory (graphify)", empty("No repositories configured (use --repo)."));
  const blocks = g.repos.map(graphRepo);
  await Promise.all(blocks.map((b) => b.ready));
  return panel("Graph memory (graphify)", ...blocks.map((b) => b.el));
}

async function viewHarness() {
  const [hs, odd] = await Promise.all([api("harness"), api("odd")]);
  const out = [];
  if (!hs.installed) out.push(panel("Harness", empty("gentle-lite is not installed (no state.json in the state directory).")));
  else {
    out.push(h("div", { class: "grid" }, card("Version", hs.version || "-"), card("RDD mode", hs.rdd_mode || "-"), card("Telemetry", hs.telemetry ? "on" : "off"), card("Managed files", fmt(hs.managed_files)), card("Persona", hs.persona || "-")),
      panel("Components", empty((hs.components || []).join(", ") || "none")),
      panel("Hooks", hs.hooks.length ? table("hooks", [{ key: "event", label: "Event" }, { key: "kind", label: "Kind" }], hs.hooks) : empty("No hooks registered.")),
      panel("MCP servers", hs.mcp_servers.length ? table("mcp", [{ key: "name", label: "Name" }, { key: "type", label: "Type" }, { key: "command", label: "Command" }], hs.mcp_servers) : empty("None.")));
  }
  out.push(panel("ODD task progress", odd.repos.length ? odd.repos.map((r) => h("div", null, h("h2", null, r.repo), r.documents.length ? r.documents.map((d) => h("div", null, h("strong", null, d.name), ` ${d.done}/${d.total}`, h("ul", null, d.tasks.map((t) => h("li", null, (t.done ? "[x] " : "[ ] ") + t.title))))) : empty("No odd/tasks/*.md found."))) : empty("No repositories configured (use --repo).")));
  return out;
}

const RENDERERS = { overview: viewOverview, usage: viewUsage, sessions: viewSessions, memories: viewMemories, harness: viewHarness };
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  $("nav").replaceChildren(...VIEWS.map(([k, l]) => h("a", { href: "#" + k, "aria-current": k === state.view ? "page" : false }, l)));
  try {
    const nodes = await RENDERERS[state.view]();
    if (seq === renderSeq) $("view").replaceChildren(...nodes);
  } catch (err) {
    if (seq === renderSeq) $("view").replaceChildren(panel("Error", h("p", { class: "warn" }, String(err.message || err))));
  }
}

async function loadProjects() {
  try {
    const s = await api("sessions", { days: 3650, limit: 1 });
    const cur = $("project").value;
    $("project").replaceChildren(h("option", { value: "" }, "All projects"), ...s.projects.map((p) => h("option", { value: p.project }, p.project)));
    $("project").value = cur;
  } catch (_) { /* optional */ }
}

$("refresh").addEventListener("click", async () => {
  $("status").textContent = "Refreshing...";
  try {
    const r = await fetch("/api/refresh", { method: "POST", headers: { "X-Portal-Token": token } });
    const b = await r.json();
    $("status").textContent = r.ok ? `Done: ${b.messages} new message(s) from ${b.files} file(s).` : `Failed: ${b.error}`;
    await loadProjects();
    render();
  } catch (err) { $("status").textContent = "Failed: " + err.message; }
});
for (const id of ["days", "project"]) $(id).addEventListener("change", render);
window.addEventListener("hashchange", () => { state.view = VIEWS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : "overview"; render(); });
state.view = VIEWS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : "overview";
loadProjects().then(render);
