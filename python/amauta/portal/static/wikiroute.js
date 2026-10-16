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

  globalThis.AmautaRoute = { KINDS, parseHash, formatHash, flattenResults, moveIndex };
})();
