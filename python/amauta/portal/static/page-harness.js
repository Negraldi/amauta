"use strict";
// Harness page and the graph explorer: code graph blocks and the install architecture (#/harness, #/node).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

// "Showing the nearest 30 of 45 nodes", or "of at least 200" when the server stopped walking at its cap (the count is a floor).
const nearestNote = (shown, d) => h("p", { class: "muted" }, t(d.capped ? "graph.nearestAtLeast" : "graph.nearest", { shown, total: fmt(d.nodes) }));
function graphDiagram(repo, node, depth) {
  const box = h("div", null, h("p", { class: "muted" }, t("common.rendering")));
  api("graph/diagram", { repo, node, depth }).then((d) => {
    if (!d.source) box.replaceChildren(empty(t("graph.nothing")));
    else {
      const source = localizeGraphSource(d.source);
      box.replaceChildren(adaptiveDiagram(source, t("graph.neighborsOfSelected")), d.truncated || d.nodes > 30 ? nearestNote(30, d) : null);
    }
  }).catch((err) => box.replaceChildren(errorNote(err)));
  return box;
}

// One block per --repo: stats, searchable node list, neighbors of the selected node. Data only ever becomes text.
// A node kind (graphify's file_type) as a word; an unknown kind is shown as sent.
function nodeKind(k) {
  const key = `graph.kind.${k}`;
  return k && key in I.dict.en ? t(key) : k || "-";
}
// The node list opens on meaningful nodes (T11 b): most connected first, vendored, minified and dependency files hidden
// behind a labelled toggle. Both choices go to the server, which ranks and filters before the 50-row cap.
function graphFilters(onChange) {
  const vendored = h("input", { type: "checkbox", id: "graph-vendored" }), concepts = h("input", { type: "checkbox", id: "graph-concepts" });
  const order = h("select", { "aria-label": t("graph.order") },
    h("option", { value: "links" }, t("graph.orderLinks")), h("option", { value: "name" }, t("graph.orderName")));
  for (const el of [vendored, concepts, order]) el.addEventListener("change", onChange);
  // The list opens on the project's own code: concept and reference nodes (no source file) are one labelled option away (D8).
  const flag = (box) => (box.checked ? "1" : "");
  const query = () => ({ vendored: flag(vendored), concepts: flag(concepts), order: order.value === "name" ? "name" : "" });
  const check = (box, id, key) => h("label", { class: "check", for: id }, box, t(key));
  return { query, el: [order, check(vendored, "graph-vendored", "graph.vendored"), check(concepts, "graph-concepts", "graph.concepts")] };
}
// "Showing 50 of 1,234 nodes; 312 vendored ... hidden.": the toggle changes a number the reader can see, not only the rows.
// While rows remain, Show more asks the server for the next page (`more`).
function nodeCount(g, query, more) {
  if (g.matched == null || !g.items.length) return null;
  const n = { shown: fmt(g.items.length), total: fmt(g.matched - g.hidden), hidden: fmt(g.hidden) };
  const line = h("p", { class: "muted" }, t(query.vendored && query.concepts ? "graph.showingAll" : g.hidden ? "graph.showing" : "graph.showingPlain", n));
  if (g.items.length >= g.matched - g.hidden) return line;
  return h("div", null, line, h("button", { type: "button", class: "show-more", onclick: () => more(true) }, t("more.button")));
}
const KIND_COLUMN = () => ({ key: "kind", label: t("col.kind"), render: nodeKind });
const NODE_COLUMNS = () => [{ key: "label", label: t("col.node"), link: true, attr: "data-graph" }, KIND_COLUMN(),
  { key: "links", label: t("col.links"), num: true }, { key: "file", label: t("col.file") }];

// The neighbours of the selected node: its heading, depth select and a live status stay put while the content is redrawn, so
// changing the depth re-renders at once and never loses focus. Choosing a row brings the panel into view (D2).
const reducedMotion = () => Boolean(globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
function neighborsPanel(r) {
  const depth = h("select", { "aria-label": t("graph.depth") }, [1, 2, 3].map((d) => h("option", { value: String(d) }, t("graph.depthN", { n: d }))));
  depth.value = "1";
  const title = h("h3", { tabindex: -1 }), status = h("p", { class: "visually-hidden", role: "status" }), body = h("div", null);
  const el = h("section", { class: "near" }, h("div", { class: "controls" }, title, depth), status, body);
  el.hidden = true;
  let selected = null;
  const show = guarded(async (node, reveal) => {
    selected = node;
    const name = node.label || node.id;
    el.hidden = false;
    title.textContent = t("graph.neighborsOf", { name });
    const g = await api("graph/neighbors", { repo: r.path, node: node.id, depth: depth.value });
    const nodeCols = [{ key: "depth", label: t("graph.depth"), num: true }, { key: "label", label: t("col.label") }, KIND_COLUMN(),
      { key: "file", label: t("col.file") }];
    const edgeCols = [{ key: "src", label: t("col.from") }, { key: "relation", label: t("col.relation"), render: edgeRelation },
      { key: "dst", label: t("col.to") }];
    body.replaceChildren(h("p", null, link("node", `${r.name}::${node.id}`, t("graph.openPage"))), table("gn-" + r.path, nodeCols, g.nodes),
      h("h3", null, t("graph.diagramTitle")), graphDiagram(r.path, node.id, depth.value),
      g.edges.length ? table("ge-" + r.path, edgeCols, g.edges) : empty(t("graph.noEdges")));
    status.textContent = t("graph.neighborsStatus", { name, depth: depth.value, n: fmt(g.nodes.length) });
    if (!reveal) return;
    if (el.scrollIntoView) el.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    title.focus({ preventScroll: true });
  }, body);
  depth.addEventListener("change", () => { if (selected) show(selected, false); });
  return { el, show: (node) => show(node, true) };
}
// "3 nodes, 1 edge (loaded ...; graph.json ..., 4 days old), 2 SQL tables"; one time when both copies agree (B11).
function graphStats(r) {
  const days = Math.floor((Date.now() - Date.parse(r.graph_mtime)) / 86400000);
  const same = R.fmtDateTime(r.synced_at) === R.fmtDateTime(r.graph_mtime);
  return t(same ? "graph.statsSame" : "graph.stats", { ...graphCounts(r.nodes, r.edges), mirrored: R.fmtDateTime(r.synced_at),
    file: R.fmtDateTime(r.graph_mtime), age: days >= 1 ? `, ${tn("graph.age", days, { days: fmt(days) })}` : "",
    sql: tn("graph.sqlTables", r.sql_tables || 0, { n: fmt(r.sql_tables || 0) }) });
}

function graphRepo(r) {
  if (!r.available) return { ready: null, el: h("div", null, h("h3", null, r.name), empty(r.reason ? codeSpans(ts(r.reason)) : t("graph.notAvailable"))) };
  const q = h("input", { type: "search", placeholder: t("graph.searchNodes"), "aria-label": t("graph.searchNodesLabel") });
  const list = h("div", null);
  const near = neighborsPanel(r), show = near.show;
  let items = [];
  const load = guarded(async (more) => {
    const g = await api("graph/nodes", { repo: r.path, q: q.value, ...filters.query(), offset: more === true ? items.length : 0 });
    items = more === true ? [...items, ...g.items] : g.items;
    const rows = items.length ? table("gnodes-" + r.path, NODE_COLUMNS(), items, show) : empty(t("graph.noMatch"));
    list.replaceChildren(...[rows, nodeCount({ ...g, items }, filters.query(), load)].filter(Boolean));
    const next = more === true && list.querySelector && list.querySelector("button.show-more");
    if (next && next.focus) next.focus(); // focus stays on the control, never lost with the re-rendered list
  }, list);
  const filters = graphFilters(() => { // a server order by name must not be re-sorted by links in the table
    if (filters.query().order) state.sort["gnodes-" + r.path] = { key: "label", dir: 1 }; else delete state.sort["gnodes-" + r.path];
    load();
  });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  const ready = load();
  return { ready, el: h("div", null, h("h3", null, r.name), h("p", { class: "muted" }, graphStats(r)),
    h("p", { class: "muted" }, semanticLine(r)),
    h("div", { class: "controls" }, q, h("button", { type: "button", onclick: load }, t("graph.searchGraph")), ...filters.el), list, near.el) };
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
// The diagram opens at its natural size in a sideways scroller (keyboard-focusable and hinted while it overflows, fit.js), so its
// labels stay legible; "Fit to width" (a pressed-state toggle) is the optional overview and stops at the 11px text floor.
// It is shown, not folded (T14 k), and once drawn it opens centred on its middle: the top-down flow starts at a centred root,
// so the left edge of a wide drawing is mostly empty.
function centerScroll(el) {
  el.scrollLeft = Math.max(0, ((el.scrollWidth || 0) - (el.clientWidth || 0)) / 2);
}
function archSizeToggle(scroller) {
  const b = h("button", { type: "button", "aria-pressed": "false" }, t("harness.fitWidth"));
  b.addEventListener("click", () => {
    const fit = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(fit));
    scroller.setAttribute("data-size", fit ? "fit" : "full");
    syncOverflow(scroller.parentNode); // refit (fit stops at the text floor) and say whether the scroller now scrolls (fit.js)
  });
  return h("p", null, b);
}
const archifyAgain = () => api("archify").then((d) => (d.installed ? archifyParts(d) : null)); // Retry redraws only the diagram part
function archifyBlock(d) {
  if (d.failed) {
    return h("section", { class: "page-section" }, h("h2", null, t("harness.architecture")),
      errorNote(d.failed, t("part.architecture"), archifyAgain));
  }
  if (!d.installed) return null;
  return h("section", { class: "page-section" }, h("h2", null, t("harness.architecture")), archifyParts(d));
}
function archifyParts(d) {
  const full = d.available && /^\/archify\/[0-9a-f]{64}\.html$/.test(d.url)
    ? h("p", null, h("a", { href: d.url, target: "_blank", rel: "noopener" },
      tn("harness.drawn", d.components, { n: fmt(d.components) }))) : null;
  const label = t("harness.installArch");
  const scroller = d.fallback
    ? h("div", { class: "arch-scroll", "data-size": "full", tabindex: 0, role: "region", "aria-label": label },
      adaptiveDiagram(d.fallback, label, (box) => { fitDiagram(box); centerScroll(scroller); })) : null;
  return h("div", null, scroller ? archSizeToggle(scroller) : null, scroller, full);
}

// One status vocabulary for the Harness wiki: a filled dot for on/runs, a ring for off/disabled, always with the word.
const stateChip = (on, word) => h("span", { class: `chip ${on ? "chip-done" : "chip-off"}` }, `${on ? "●" : "○"} ${word}`);
const disabledCount = (comps) => (comps ? comps.groups.reduce((n, g) => n + g.items.filter((i) => i.disabled).length, 0) : 0);

// "amauta 0.3.0 is installed; 42 components, 1 needs attention (plugin disabled)." from /api/harness, /api/harness/components and
// /api/skills: the same total the Catalog shows. Skills that fail to load only drop out of the count.
// The sentence in parts, so Home can link the component count; null parts when the catalog could not load.
function healthParts(hs, comps, skills) {
  const head = t("harness.health.installed", { version: hs.version || "-" });
  if (!comps || !Array.isArray(comps.groups)) return { head, parts: null, attention: null, off: 0 };
  const total = [...skillGroup(skills), ...comps.groups].reduce((n, g) => n + g.items.length, 0);
  const off = disabledCount(comps);
  // Without skills the total is partial and says so.
  const said = skills ? tn("harness.health.components", total, { n: fmt(total) }) : t("harness.health.partial", { n: fmt(total) });
  return { head, parts: said, off,
    attention: off ? tn("harness.health.attention", off, { n: fmt(off) }) : t("harness.health.fine") };
}
function healthSentence(hs, comps, skills) {
  const p = healthParts(hs, comps, skills);
  return p.parts ? `${p.head}; ${p.parts}, ${p.attention}.` : `${p.head}.`;
}
// Home: plain text with an ordinary link on the component count; the warning tone and mark only when something needs it.
function healthLine(hs, comps, skills) {
  const p = healthParts(hs, comps, skills);
  if (!p.parts) return h("p", { class: "lead" }, `${p.head}.`);
  const mark = p.off ? "▲ " : "";
  return h("p", { class: p.off ? "lead warn" : "lead" }, `${mark}${p.head}; `, link("harness", "", p.parts), `, ${p.attention}.`);
}

function installFacts(hs) {
  const row = (term, value) => [h("dt", null, term), h("dd", null, value)];
  const known = hs.rdd_mode === "on" || hs.rdd_mode === "off";
  const mode = known ? stateChip(hs.rdd_mode === "on", t(`common.${hs.rdd_mode}`)) : "-";
  return h("dl", { class: "meta facts" }, ...row(t("harness.version"), hs.version || "-"), ...row(t("harness.review"), mode),
    ...row(t("harness.telemetry"), stateChip(hs.telemetry, hs.telemetry ? t("common.on") : t("common.off"))),
    ...row(t("harness.persona"), personaLabel(hs.persona)),
    ...row(t("harness.modules"), (hs.components || []).join(", ") || t("common.none")),
    ...row(t("harness.managed"), fmt(hs.managed_files)));
}

// Hook rows from the catalog entries: the id starts with the event, the title is "<event> (<matcher>) · <handler>".
// Without the catalog, the install's own hooks list (user settings only) with amauta's handler names.
// A dispatcher without known handler names reads "amauta hooks: " on the server: shown as "amauta hooks".
function hookRows(hs, comps) {
  const group = comps && comps.groups.find((g) => g.kind === "hook");
  const own = (x) => ({ event: x.event, order: hookEventOrder(x.event), handler: (x.handlers || []).join(", ") || x.kind,
    source: t("harness.userSettings"), status: true });
  if (!group) return hs.hooks.map(own);
  return group.items.map((i) => {
    const m = /^(.*?)(?: \((.*)\))? · (.*)$/.exec(i.title) || [];
    const handler = m[3] ? m[3].trim().replace(/:$/, "") : i.title;
    const event = String(i.id).split(":")[0];
    return { event, order: hookEventOrder(event), handler, matcher: m[3] ? m[2] : null, id: i.id, source: ts(i.source),
      status: !i.disabled };
  });
}
function hooksTable(hs, comps) {
  const rows = hookRows(hs, comps);
  if (!rows.length) return empty(t("harness.noHooks"));
  const matcher = (r) => (r.matcher ? h("span", { class: "muted" }, " ", breakAfterBars(r.matcher)) : null);
  const handler = (v, r) => [r.id ? link("hook", r.id, v) : v, matcher(r)];
  const status = (v) => stateChip(v, v ? t("harness.runs") : t("harness.pluginOff"));
  sortOnce("hooks", "event", 1); // lifecycle order until a header is clicked
  return table("hooks", [{ key: "event", label: t("col.event"), sortBy: "order" },
    { key: "handler", label: t("col.handler"), render: handler }, { key: "source", label: t("col.source") },
    { key: "status", label: t("col.status"), render: status }], rows);
}

// Runtimes (T10): names are plain text, never a color. One row per runtime found; no Codex home is one sentence.
const RUNTIME_KEYS = { claude: "runtime.claude", codex: "runtime.codex" };
const runtimeNames = (list) => (list || []).map((r) => (RUNTIME_KEYS[r] ? t(RUNTIME_KEYS[r]) : r)).join(", ");
const noCodexNote = (rt) => (rt && rt.codex && rt.codex.found === false ? h("p", { class: "muted" }, t("runtime.noCodex")) : null);
// Each instruction block names its catalog page; no block is the word "none".
const blockLinks = (v, r) => (r.blockIds.length ? r.blockIds.flatMap((id, i) => [i ? ", " : null, link("instructions", id, id)]) : v);
function runtimesSection(rt) {
  if (!rt || !rt.claude || !rt.codex) return null;
  const row = (key, r) => ({ runtime: runtimeNames([key]), home: r.home, installed: r.installed,
    blocks: (r.blocks || []).join(", ") || t("common.none"), blockIds: r.blocks || [],
    hooks: r.hooks, mcp: r.mcp_servers, skills: r.skills });
  const rows = [row("claude", rt.claude), ...(rt.codex.found ? [row("codex", rt.codex)] : [])];
  const yes = (v) => stateChip(v, v ? t("common.yes") : t("common.no"));
  const cols = [{ key: "runtime", label: t("col.runtime") }, { key: "home", label: t("harness.rt.home") },
    { key: "installed", label: t("harness.rt.installed"), render: yes },
    { key: "blocks", label: t("harness.rt.blocks"), render: blockLinks },
    { key: "hooks", label: t("harness.rt.hooks"), num: true }, { key: "mcp", label: t("harness.rt.mcp"), num: true },
    { key: "skills", label: t("harness.rt.skills"), num: true }];
  return h("section", { class: "page-section" }, h("h2", null, t("harness.runtimes")), h("p", { class: "muted" }, t("harness.rt.lead")),
    table("runtimes", cols, rows), noCodexNote(rt));
}

async function viewHarness() {
  const [hs, arch, comps, skills] = await Promise.all([api("harness"), api("archify").catch((err) => ({ failed: err })),
    api("harness/components").catch(() => null), api("skills").catch(() => null)]);
  const title = pageHead(t("nav.harnessPage"), hs.installed ? healthSentence(hs, comps, skills) : null);
  const how = h("div", { class: "teach" }, h("p", null, t("harness.notInstalled")), h("p", null, codeSpans(t("harness.howInstall"))));
  if (!hs.installed) return [title, how];
  const skillsDown = comps && !skills ? errorNote(null, t("part.skills"), true) : null; // the count above is partial: say what is missing
  const pending = comps && comps.pending ? h("p", null, tn("harness.pending", comps.pending, { n: fmt(comps.pending) })) : null;
  const hooks = h("section", { class: "page-section" }, h("h2", null, t("harness.hooks")), hooksTable(hs, comps));
  const open = h("p", null, link("component", "", t("harness.openComponents")));
  return [title, skillsDown, installFacts(hs), runtimesSection(comps && comps.runtimes), open, pending, archifyBlock(arch), hooks]
    .filter(Boolean); // archifyBlock is null without archify, runtimesSection without the catalog
}
