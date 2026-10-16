"use strict";
// Pure helpers for the wiki shell (no DOM): hash routing and the search palette's list handling.
(function () {
  // kind -> label shown in the sidebar and as the page's kind label
  const KINDS = {
    home: "Home", memory: "Memory", skill: "Skill", tool: "Tool", mcp: "MCP server", session: "Session", feature: "ODD feature",
    node: "Graph node", harness: "Harness", usage: "Usage", settings: "Settings", diagrams: "Diagrams",
  };
  // Hashes of the previous tabbed portal keep working.
  const LEGACY = { overview: "home", usage: "usage", sessions: "session", memories: "memory", harness: "harness", diagrams: "diagrams" };

  function decode(part) {
    try { return decodeURIComponent(part); } catch (_) { return part; }
  }

  // "#/memory/arch%2Fwidgets" -> {kind: "memory", id: "arch/widgets"}; "" -> home; unknown kinds -> {kind: "unknown", id: <raw>}.
  function parseHash(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    if (raw === "" || raw === "/") return { kind: "home", id: "" };
    if (!raw.startsWith("/")) return LEGACY[raw] ? { kind: LEGACY[raw], id: "" } : { kind: "unknown", id: raw };
    const [kind, ...rest] = raw.slice(1).split("/");
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return { kind: "unknown", id: raw };
    return { kind, id: rest.length ? decode(rest.join("/")) : "" };
  }

  // The inverse of parseHash: ids are fully percent-encoded so slashes, '#', '?' and '::' survive a round trip.
  function formatHash(kind, id) {
    return id ? `#/${kind}/${encodeURIComponent(id)}` : `#/${kind}`;
  }

  // Search groups -> one flat list (keyboard order) with a header marker before each group.
  function flattenResults(groups) {
    const flat = [];
    for (const g of groups || []) for (const item of g.items || []) flat.push({ group: g.kind, count: g.count, kind: item.kind, id: item.id, title: item.title, snippet: item.snippet || null });
    return flat;
  }

  // Wrapping selection for arrow keys over `n` options (-1 = nothing selected yet).
  function moveIndex(index, delta, n) {
    if (n <= 0) return -1;
    if (index < 0) return delta > 0 ? 0 : n - 1;
    return (index + delta + n) % n;
  }

  // Line diff rows from the server: a visible mark (never color alone) and a style name.
  const DIFF = { "+": ["+ ", "add"], "-": ["- ", "del"], " ": ["  ", "same"], "=": ["... ", "gap"] };
  function diffRow(line) {
    const [mark, name] = DIFF[line && line.op] || DIFF[" "];
    return { mark, name, text: String((line && line.text) ?? "") };
  }

  // Done/total for the progress bar of an ODD feature: a whole percent and the text label.
  function progress(done, total) {
    const d = Math.max(0, Number(done) || 0), t = Math.max(0, Number(total) || 0);
    return { percent: t ? Math.min(100, Math.round((d / t) * 100)) : 0, label: `${d} of ${t} done` };
  }

  // Bars for a small per-day chart: [{day, value}] -> [{day, value, x, y, width, height}] inside a W x H box (at least 1px tall when value > 0).
  function dailyBars(daily, W, H) {
    const rows = Array.isArray(daily) ? daily : [];
    const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0));
    const bw = rows.length ? W / rows.length : W;
    return rows.map((r, i) => {
      const v = Math.max(0, Number(r.value) || 0);
      const height = v > 0 ? Math.max(1, (v / max) * H) : 0;
      return { day: String(r.day), value: v, x: i * bw, y: H - height, width: Math.max(bw - 1, 1), height };
    });
  }

  // Skill impact: direction is always shown as a shape plus words (lower is better for every metric), never by color alone.
  function deltaMark(m) {
    if (!m || m.suppressed || m.delta == null || !m.verdict) return { mark: "–", text: "not enough data", name: "na" };
    if (m.verdict === "no clear difference") return { mark: "■", text: "no clear difference", name: "flat" };
    return m.delta < 0 ? { mark: "▼", text: "lower, better", name: "better" } : { mark: "▲", text: "higher, worse", name: "worse" };
  }
  function fmtMetric(name, v) {
    if (v == null || !Number.isFinite(Number(v))) return "n/a";
    return name === "tokens_per_turn" ? `${Math.round(v)} tokens` : `${(v * 100).toFixed(1)}%`;
  }
  function fmtDelta(name, d) {
    if (d == null || !Number.isFinite(Number(d))) return "";
    if (name === "tokens_per_turn") return `${d < 0 ? "-" : "+"}${Math.abs(Math.round(d))} tokens`;
    return `${d < 0 ? "-" : "+"}${Math.abs(d * 100).toFixed(1)} pp`;
  }

  globalThis.AmautaRoute = { KINDS, parseHash, formatHash, flattenResults, moveIndex, diffRow, progress, dailyBars, deltaMark, fmtMetric, fmtDelta, NODE_CAP: 30 };
})();
