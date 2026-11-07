"use strict";
// Harness page: code graph panels and the install architecture (#/harness, #/node).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

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

// Harness diagram (plan N12e): the session flow of the harness model in the portal's own Mermaid style. archify, when
// installed, is only a link to its own route (/archify/<hash>.html, sandboxed by its own CSP); it is never framed here.
function archifyBlock(d) {
  if (!d.installed) return null;
  const full = d.available && /^\/archify\/[0-9a-f]{64}\.html$/.test(d.url)
    ? h("p", null, h("a", { href: d.url, target: "_blank", rel: "noopener" }, t("harness.drawn", { n: fmt(d.components) }))) : null;
  return panel(t("harness.architecture"), d.fallback ? diagramBox(d.fallback, t("harness.installArch")) : null, full);
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
