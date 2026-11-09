"use strict";
// Projects and features: ODD progress, task diagrams and graph sync per project (#/project, #/feature).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

function projectOdd(o) {
  return o.features ? tn("project.odd", o.features, { done: fmt(o.done), total: fmt(o.total), percent: fmt(o.percent), n: fmt(o.features) }) : t("project.noOdd");
}
async function viewProjects() {
  const [d, sibs] = await Promise.all([api("projects"), siblingsBlock()]);
  if (!d.projects.length) return [teach(t("nav.project"), t("project.noneKnown"), h("span", null, link("settings", "", t("project.openSettings"))))];
  return [h("h1", null, t("nav.project")), h("p", { class: "muted" }, tn(d.auto_discover ? "project.countAuto" : "project.count", d.projects.length, { n: fmt(d.projects.length) }) + " ", t("project.manage"), " ", link("settings", "", t("nav.settings")), "."),
    h("ul", { class: "items" }, d.projects.map((p) => h("li", null, link("project", p.name, p.name), h("span", { class: "muted" }, ` ${p.origin.map(originLabel).join(", ")}`),
      p.profile && p.profile !== "default" ? h("span", { class: "muted" }, ` · ${t("project.profile", { name: p.profile })}`) : null,
      h("div", null, projectOdd(p.odd)),
      h("div", { class: "muted" }, t("project.summary", { sessions: fmt(p.sessions), memories: fmt(p.memories), graph: p.graph.mirrored ? t("project.graphMirrored", { at: R.fmtDate(p.graph.synced_at) }) : t("project.graphNot") })),
      h("div", { class: "muted tok" }, p.path)))), sibs].filter(Boolean);
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
