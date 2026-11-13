"use strict";
// Harness page and the graph explorer: code graph blocks and the install architecture (#/harness, #/node).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

function graphDiagram(repo, node, depth) {
  const box = h("div", null, h("p", { class: "muted" }, t("common.rendering")));
  api("graph/diagram", { repo, node, depth }).then((d) => {
    if (!d.source) box.replaceChildren(empty(t("graph.nothing")));
    else box.replaceChildren(diagramBox(d.source, t("graph.neighborsOfSelected")), d.truncated || d.nodes > 30 ? empty(t("graph.nearest", { shown: 30, total: fmt(d.nodes) })) : null);
  }).catch((err) => box.replaceChildren(errorNote(err)));
  return box;
}

// One block per --repo: stats, searchable node list, neighbors of the selected node. Data only ever becomes text.
function graphRepo(r) {
  if (!r.available) return { ready: null, el: h("div", null, h("h3", null, r.name), empty(r.reason ? codeSpans(ts(r.reason)) : t("graph.notAvailable"))) };
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
  return { ready, el: h("div", null, h("h3", null, r.name), h("p", { class: "muted" }, t("graph.stats", { ...graphCounts(r.nodes, r.edges), mirrored: R.fmtDateTime(r.synced_at), file: R.fmtDateTime(r.graph_mtime), sql: tn("graph.sqlTables", r.sql_tables || 0, { n: fmt(r.sql_tables || 0) }) })),
    h("p", { class: "muted" }, semanticLine(r)),
    h("div", { class: "controls" }, q, depth, h("button", { type: "button", onclick: load }, t("graph.searchGraph"))), list, near) };
}

// Whether a semantic pass is pending, as a sentence, and when the last one ran.
function semanticLine(r) {
  const last = r.semantic_at ? t("graph.lastRun", { at: R.fmtDateTime(r.semantic_at), model: r.semantic_model || t("graph.unknownModel") }) : t("common.never");
  return t(r.semantic_pending ? "graph.semanticPending" : "graph.semanticNone", { last });
}
// "3 nodes", "1 edge": the two counts of a graph, each with its own plural.
const graphCounts = (nodes, edges) => ({ nodes: tn("graph.nodeCount", nodes, { n: fmt(nodes) }),
  edges: tn("graph.edgeCount", edges, { n: fmt(edges) }) });

// Graph memory is filled per project by graphify; when nothing is mirrored yet, say how, and list the projects that already have a graph.
function graphEmptyState(projects) {
  const mirrored = (projects || []).filter((p) => p.graph && p.graph.mirrored);
  return h("div", { class: "teach" },
    h("p", null, t("graph.how1"), " ", h("code", null, "amauta graphify hook install"), " ", t("graph.how2"), " ",
      h("code", null, "graphify update ."), " ", t("graph.how3"), " ", h("code", null, "graphify update ."), " ", t("graph.how4"), " ", h("code", null, "python3 -P -m amauta.graph sync --repo ."), "."),
    mirrored.length ? h("div", null, h("h3", null, t("graph.mirroredProjects")), h("ul", { class: "refs" }, mirrored.map((p) => h("li", null, link("project", p.name, p.name), h("span", { class: "muted" }, " " + t("graph.nodesEdges", graphCounts(p.graph.nodes, p.graph.edges)))))))
      : h("p", { class: "muted" }, t("graph.noneMirrored")));
}

// Knowledge > Graph (#/node): the one cross-repo explorer. A repo picker, then that repo's search, neighbours and diagram.
async function graphExplorer() {
  const [g, pr] = await Promise.all([api("graphify"), api("projects").catch(() => null)]);
  if (!g.repos.length) return [graphEmptyState(pr && pr.projects)];
  const first = g.repos.find((r) => r.available) || g.repos[0];
  if (!g.repos.some((r) => r.path === state.graphRepo)) state.graphRepo = first.path;
  const picker = h("select", { "aria-label": t("graph.repo") }, g.repos.map((r) => h("option", { value: r.path }, r.name)));
  picker.value = state.graphRepo;
  const box = h("div", null);
  const show = async () => {
    const block = graphRepo(g.repos.find((r) => r.path === picker.value) || first);
    await block.ready;
    box.replaceChildren(block.el);
  };
  picker.addEventListener("change", guarded(async () => { state.graphRepo = picker.value; await show(); }, box));
  await show();
  const anyReady = g.repos.some((r) => r.available);
  return [...(anyReady ? [] : [graphEmptyState(pr && pr.projects)]),
    h("div", { class: "controls" }, h("label", null, t("graph.repo"), " ", picker)), box];
}

// Harness diagram (plan N12e): the session flow of the harness model in the portal's own Mermaid style. archify, when
// installed, is only a link to its own route (/archify/<hash>.html, sandboxed by its own CSP); it is never framed here.
// The diagram keeps its natural size inside a keyboard-focusable sideways scroller, folded behind a summary.
function archifyBlock(d) {
  if (!d.installed) return null;
  const full = d.available && /^\/archify\/[0-9a-f]{64}\.html$/.test(d.url)
    ? h("p", null, h("a", { href: d.url, target: "_blank", rel: "noopener" },
      tn("harness.drawn", d.components, { n: fmt(d.components) }))) : null;
  const label = t("harness.installArch");
  const scroller = d.fallback
    ? h("div", { class: "arch-scroll", tabindex: 0, role: "region", "aria-label": label }, diagramBox(d.fallback, label, true)) : null;
  return h("section", { class: "page-section" }, h("h2", null, t("harness.architecture")),
    scroller ? h("details", { class: "arch" }, h("summary", null, t("harness.showArch")), scroller) : null, full);
}

// One status vocabulary for the Harness wiki: a filled dot for on/runs, a ring for off/disabled, always with the word.
const stateChip = (on, word) => h("span", { class: `chip ${on ? "chip-done" : "chip-off"}` }, `${on ? "●" : "○"} ${word}`);
const disabledCount = (comps) => (comps ? comps.groups.reduce((n, g) => n + g.items.filter((i) => i.disabled).length, 0) : 0);

// "amauta 0.3.0 is installed; 42 components, 1 needs attention (plugin disabled)." from /api/harness, /api/harness/components and
// /api/skills: the same total the Catalog shows. Skills that fail to load only drop out of the count.
function healthSentence(hs, comps, skills) {
  const head = t("harness.health.installed", { version: hs.version || "-" });
  if (!comps || !Array.isArray(comps.groups)) return `${head}.`;
  const total = [...skillGroup(skills), ...comps.groups].reduce((n, g) => n + g.items.length, 0);
  const parts = tn("harness.health.components", total, { n: fmt(total) });
  const off = disabledCount(comps);
  const attention = off ? tn("harness.health.attention", off, { n: fmt(off) }) : t("harness.health.fine");
  return `${head}; ${parts}, ${attention}.`;
}

function installFacts(hs) {
  const row = (term, value) => [h("dt", null, term), h("dd", null, value)];
  const known = hs.rdd_mode === "on" || hs.rdd_mode === "off";
  const mode = known ? stateChip(hs.rdd_mode === "on", t(`common.${hs.rdd_mode}`)) : "-";
  return h("dl", { class: "meta facts" }, ...row(t("harness.version"), hs.version || "-"), ...row(t("harness.review"), mode),
    ...row(t("harness.telemetry"), stateChip(hs.telemetry, hs.telemetry ? t("common.on") : t("common.off"))),
    ...row(t("harness.persona"), hs.persona || "-"),
    ...row(t("harness.modules"), (hs.components || []).join(", ") || t("common.none")),
    ...row(t("harness.managed"), fmt(hs.managed_files)));
}

// Hook rows from the catalog entries: the id starts with the event, the title is "<event> (<matcher>) · <handler>".
// Without the catalog, the install's own hooks list (user settings only) with amauta's handler names.
// A dispatcher without known handler names reads "amauta hooks: " on the server: shown as "amauta hooks".
function hookRows(hs, comps) {
  const group = comps && comps.groups.find((g) => g.kind === "hook");
  const own = (x) => ({ event: x.event, handler: (x.handlers || []).join(", ") || x.kind, source: t("harness.userSettings"),
    status: true });
  if (!group) return hs.hooks.map(own);
  return group.items.map((i) => {
    const m = /^(.*?)(?: \((.*)\))? · (.*)$/.exec(i.title) || [];
    const handler = m[3] ? m[3].trim().replace(/:$/, "") : i.title;
    return { event: String(i.id).split(":")[0], handler, matcher: m[3] ? m[2] : null, id: i.id, source: ts(i.source), status: !i.disabled };
  });
}
function hooksTable(hs, comps) {
  const rows = hookRows(hs, comps);
  if (!rows.length) return empty(t("harness.noHooks"));
  const matcher = (r) => (r.matcher ? h("span", { class: "muted" }, " ", breakAfterBars(r.matcher)) : null);
  const handler = (v, r) => [r.id ? link("hook", r.id, v) : v, matcher(r)];
  const status = (v) => stateChip(v, v ? t("harness.runs") : t("harness.pluginOff"));
  return table("hooks", [{ key: "event", label: t("col.event") }, { key: "handler", label: t("col.handler"), render: handler },
    { key: "source", label: t("col.source") }, { key: "status", label: t("col.status"), render: status }], rows);
}

// Runtimes (T10): names are plain text, never a color. One row per runtime found; no Codex home is one sentence.
const RUNTIME_KEYS = { claude: "runtime.claude", codex: "runtime.codex" };
const runtimeNames = (list) => (list || []).map((r) => (RUNTIME_KEYS[r] ? t(RUNTIME_KEYS[r]) : r)).join(", ");
const noCodexNote = (rt) => (rt && rt.codex && rt.codex.found === false ? h("p", { class: "muted" }, t("runtime.noCodex")) : null);
function runtimesSection(rt) {
  if (!rt || !rt.claude || !rt.codex) return null;
  const row = (key, r) => ({ runtime: runtimeNames([key]), home: r.home, installed: r.installed,
    blocks: (r.blocks || []).join(", ") || t("common.none"), hooks: r.hooks, mcp: r.mcp_servers, skills: r.skills });
  const rows = [row("claude", rt.claude), ...(rt.codex.found ? [row("codex", rt.codex)] : [])];
  const yes = (v) => stateChip(v, v ? t("common.yes") : t("common.no"));
  const cols = [{ key: "runtime", label: t("col.runtime") }, { key: "home", label: t("harness.rt.home") },
    { key: "installed", label: t("harness.rt.installed"), render: yes }, { key: "blocks", label: t("harness.rt.blocks") },
    { key: "hooks", label: t("harness.rt.hooks"), num: true }, { key: "mcp", label: t("harness.rt.mcp"), num: true },
    { key: "skills", label: t("harness.rt.skills"), num: true }];
  return h("section", { class: "page-section" }, h("h2", null, t("harness.runtimes")), h("p", { class: "muted" }, t("harness.rt.lead")),
    table("runtimes", cols, rows), noCodexNote(rt));
}

async function viewHarness() {
  const [hs, arch, comps, skills] = await Promise.all([api("harness"), api("archify").catch(() => ({ installed: false })),
    api("harness/components").catch(() => null), api("skills").catch(() => null)]);
  const title = pageHead(t("nav.harnessPage"), hs.installed ? healthSentence(hs, comps, skills) : null);
  const how = h("div", { class: "teach" }, h("p", null, t("harness.notInstalled")), h("p", null, codeSpans(t("harness.howInstall"))));
  if (!hs.installed) return [title, how];
  const pending = comps && comps.pending ? h("p", null, tn("harness.pending", comps.pending, { n: fmt(comps.pending) })) : null;
  const hooks = h("section", { class: "page-section" }, h("h2", null, t("harness.hooks")), hooksTable(hs, comps));
  const open = h("p", null, link("component", "", t("harness.openComponents")));
  return [title, installFacts(hs), runtimesSection(comps && comps.runtimes), open, pending, archifyBlock(arch), hooks]
    .filter(Boolean); // archifyBlock is null without archify, runtimesSection without the catalog
}
