"use strict";
// Projects: the list (#/project, one row per project) and the project hub (#/project/<name>?tab=), one place per project
// with its overview, ODD features, graph, pipelines, sessions and memories; also #/feature and #/node lists.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

function projectOdd(o) {
  const params = { done: fmt(o.done), total: fmt(o.total), percent: R.fmtPercent(o.total ? o.done / o.total : 0, 0), n: fmt(o.features) };
  return o.features ? tn("project.odd", o.features, params) : t("project.noOdd");
}
// A small progress bar with its words beside it (the bar never carries the number alone).
function barCell(done, total, label) {
  const bar = h("progress", { max: Math.max(total, 1), value: done, "aria-label": label });
  return h("span", { class: "bar-cell" }, bar, h("span", null, label));
}
// Graph freshness on the list: a filled dot when mirrored (with the date), a ring when not; color only reinforces.
function graphChip(g) {
  return g.mirrored ? h("span", { class: "chip chip-done" }, "● " + t("project.graphMirrored", { at: R.fmtDate(g.synced_at) }))
    : h("span", { class: "chip chip-pending" }, "○ " + t("project.graphNot"));
}
const sortOnce = (id, key, dir = -1) => { state.sort[id] ||= { key, dir }; }; // a table's first order, until a header is clicked

// Folders that sessions ran in but that are not projects (no git repository, or past the discovery caps): Today and Usage
// name them, so the list says where they are and how one becomes a project (T14 e).
function foldersBlock(folders) {
  if (!folders || !folders.length) return null;
  sortOnce("pfolders", "last");
  const cols = [{ key: "name", label: t("col.name") }, { key: "path", label: t("col.path") },
    { key: "sessions", label: t("nav.session"), num: true },
    { key: "last", label: t("col.lastActivity"), render: (v) => R.fmtDate(v || null) }];
  return h("section", { class: "page-section" }, h("h2", null, t("project.foldersTitle")),
    h("p", { class: "muted" }, t("project.foldersLead"), " ", h("a", { href: "#/settings?tab=projects" }, t("nav.settings")), "."),
    table("pfolders", cols, folders));
}

async function viewProjects() {
  const [d, sibs] = await Promise.all([api("projects"), siblingsBlock()]); // last activity comes with each row (sessname rule)
  if (!d.projects.length) {
    const settings = h("span", null, link("settings", "", t("project.openSettings")));
    return [teach(t("nav.project"), t("project.noneKnown"), settings), foldersBlock(d.folders)].filter(Boolean);
  }
  const profile = (p) => (p.profile && p.profile !== "default" ? t("project.profile", { name: p.profile }) : null);
  const originOf = (p) => p.origin.map(originLabel).join(", ");
  const sub = (p) => (profile(p) ? h("div", { class: "muted" }, profile(p)) : null); // the origin has its own column
  const rows = d.projects.map((p) => ({ ...p, found: originOf(p), percent: p.odd.total ? p.odd.done / p.odd.total : -1,
    synced: p.graph.synced_at || "",
    last: p.last || "" }));
  const odd = (p) => (p.odd.features ? barCell(p.odd.done, p.odd.total, projectOdd(p.odd))
    : h("span", { class: "muted" }, projectOdd(p.odd)));
  sortOnce("projects", "last");
  const cols = [
    { key: "name", label: t("col.name"), render: (v, p) => [link("project", v, v), sub(p)] },
    { key: "found", label: t("project.colOrigin") },
    { key: "percent", label: t("project.colOdd"), render: (v, p) => odd(p) },
    { key: "synced", label: t("project.colGraph"), render: (v, p) => graphChip(p.graph) },
    { key: "last", label: t("col.lastActivity"), render: (v) => R.fmtDate(v || null) }];
  const count = tn(d.auto_discover ? "project.countAuto" : "project.count", d.projects.length, { n: fmt(d.projects.length) });
  const lead = [`${count} `, t("project.manage"), " ", link("settings", "", t("nav.settings")), "."];
  return [pageHead(t("nav.project"), lead), table("projects", cols, rows), foldersBlock(d.folders), sibs].filter(Boolean);
}

// ---- the hub ---------------------------------------------------------------------------------------------------
// The facts the hub reads from the page's meta (server labels, compared only; the rail shows them through ts()).
function hubFacts(pg) {
  const num = (m) => Number(m.value) || 0, f = { features: 0, sessions: 0, memories: 0, path: null };
  for (const m of pg.meta) {
    if (m.label === "Features") f.features = num(m);
    else if (m.label === "Sessions") f.sessions = num(m);
    else if (m.label === "Memories") f.memories = num(m);
    else if (m.label === "Path") f.path = m.value;
  }
  return f;
}
const railFact = (m) => m.label === "Path" || m.label === "Found by";
function hubTabs(id, current) {
  const href = (x) => R.routeHash({ kind: "project", id, query: x === "overview" ? {} : { tab: x } });
  const tab = (x) => h("a", { href: href(x), "aria-current": x === current ? "page" : false }, t(R.TAB_KEYS[x]));
  return h("nav", { class: "tabs", "aria-label": t("nav.tabs") }, R.PROJECT_TABS.map(tab));
}
// Title and a one-line summary, the counts written once and in the right plural.
function hubHead(pg) {
  const f = hubFacts(pg);
  const parts = [tn("project.nFeatures", f.features, { n: fmt(f.features) }), tn("project.nSessions", f.sessions, { n: fmt(f.sessions) }),
    tn("project.nMemories", f.memories, { n: fmt(f.memories) })];
  return h("header", { class: "page-head" }, h("h1", null, pg.title),
    h("p", { class: "lead" }, parts.join(" · ")));
}
// A tab's body: skeleton lines while its data loads, then the view or a short failure with Retry (the tabs stay usable).
function tabPanel(label, load) {
  const box = h("section", { class: "tab-panel", "aria-label": label });
  const failed = (err) => h("div", { class: "panel error-panel", role: "alert" }, h("h2", null, t("common.error")),
    h("p", { class: "warn" }, t("project.tabError")), h("p", { class: "muted tok" }, plainReason(err)),
    h("div", { class: "controls" }, h("button", { type: "button", onclick: run }, t("error.retry"))));
  const run = async () => {
    box.setAttribute("aria-busy", "true");
    box.replaceChildren(skeleton());
    try { box.replaceChildren(...[].concat(await load()).filter(Boolean)); } catch (err) { box.replaceChildren(failed(err)); }
    finally { box.setAttribute("aria-busy", "false"); }
  };
  run();
  return box;
}
const TAB_VIEWS = () => ({ features: featuresTab, graph: graphTab, pipelines: pipelinesTab, sessions: sessionsTab, memories: memoriesTab });
async function viewProjectHub(route) {
  const pg = await fetchWikiPage("project", route.id);
  if (!pg) return noPage("project", route.id);
  document.title = `${pg.title} - amauta`;
  const tab = R.projectTab(route);
  const body = tab === "overview" ? overviewTab(pg) : tabPanel(t(R.TAB_KEYS[tab]), () => TAB_VIEWS()[tab](pg));
  return [hubHead(pg), hubTabs(pg.id, tab), body];
}

// Overview: overall ODD progress, graph freshness with its actions, and the rail (path, how it was found, backlinks).
function overviewTab(pg) {
  const odd = pg.progress && pg.progress.total ? progressBlock(pg) : h("p", { class: "muted" }, t("project.featuresEmpty"));
  return h("div", { class: "page" },
    h("article", { class: "doc" }, odd, pg.body_md ? h("div", { class: "prose" }, bodyNodes(pg)) : null, projectGraphBlock(pg)),
    h("aside", { class: "rail", "aria-label": t("page.details") }, railBlock(t("page.detailsTitle"), metaList(pg, railFact)),
      railBlock(t("page.linkedFrom"), pg.backlinks.length ? refList(pg.backlinks) : null)));
}
async function featuresTab(pg) {
  const repo = (await api("odd")).repos.find((r) => r.repo === pg.id);
  const docs = repo ? repo.documents : [];
  if (!docs.length) return empty(t("project.featuresEmpty"));
  const rows = docs.map((d) => ({ ...d, title: d.name.replace(/\.md$/, ""), percent: d.total ? d.done / d.total : 0 }));
  const label = (d) => t("progress.label", { done: fmt(d.done), total: fmt(d.total) });
  sortOnce("pfeatures", "title", 1);
  return [table("pfeatures", [{ key: "title", label: t("kind.feature"), render: (v, d) => link("feature", d.id, v) },
    { key: "percent", label: t("project.colOdd"), render: (v, d) => barCell(d.done, d.total, label(d)) }], rows), oddDiagramsBlock(pg)];
}
async function graphTab(pg) {
  const r = (await api("graphify")).repos.find((x) => x.path === hubFacts(pg).path || x.name === pg.id);
  const all = h("p", { class: "muted" }, t("project.graphAll") + " ", link("node", "", t("nav.node")), ".");
  if (!r || !r.available) {
    const how = codeSpans(ts((r && r.reason) || pg.graph.howto || ""));
    return [h("div", { class: "teach" }, h("p", null, t("project.graphEmpty")), h("p", null, how)), all];
  }
  const block = graphRepo(r);
  await block.ready;
  return [block.el, all];
}
async function pipelinesTab(pg) {
  const d = await api("pipelines");
  const all = h("p", { class: "muted" }, link("pipelines", "", t("project.allPipelines")));
  if (!d.available) return [empty(t("pipe.notInstalled")), all];
  const pr = d.projects.find((p) => p.path === hubFacts(pg).path || p.name === pg.id);
  if (!pr || !pr.pipelines.length) return [empty(codeSpans(t("project.pipelinesEmpty"))), all];
  return [pipeSummary([pr]), pr.error ? h("p", { class: "warn" }, `▲ ${ts(pr.error)}`) : null,
    pr.trusted ? null : h("p", { class: "muted" }, codeSpans(t("pipe.untrusted"))),
    h("div", { class: "pipe-cards" }, pr.pipelines.map((p) => pipelineCard(pr, p))), all];
}
async function sessionsTab(pg) {
  const s = await api("sessions", { days: 3650, project: pg.id, limit: 200 });
  if (!s.available) return empty(t("usage.nodata"));
  if (!s.sessions.length) return empty(t("project.sessionsEmpty", { name: pg.id }));
  sortOnce("psessions", "last_ts");
  const scope = h("p", { class: "muted" }, t("project.sessionsScope", { name: pg.id }));
  return [scope, table("psessions", sessionColumns({ project: false }), s.sessions)];
}
async function memoriesTab(pg) {
  const r = await api("memories", { project: pg.id, limit: 200 });
  if (!r.available) return empty(t("mem.noDb"));
  if (!r.items.length) return empty(t("project.memoriesEmpty", { name: pg.id }));
  sortOnce("pmem", "updated_at");
  return table("pmem", [{ key: "title", label: t("col.title"), href: (row) => R.formatHash("memory", String(row.id)) },
    { key: "type", label: t("col.type"), render: memType }, { key: "topic_key", label: t("col.topic") },
    { key: "updated_at", label: t("col.updated") }], r.items);
}

// Features tab extras: one collapsed task-progress diagram per feature (drawn when opened).
function oddDiagramsBlock(pg) {
  if (!pg.odd_diagrams || !pg.odd_diagrams.length) return null;
  const cut = pg.odd_diagrams_total > pg.odd_diagrams.length;
  return h("section", { class: "page-section" }, h("h2", null, t("project.taskProgress")),
    cut ? h("p", { class: "muted" }, t("more.showing", { shown: fmt(pg.odd_diagrams.length), total: fmt(pg.odd_diagrams_total) })) : null, pg.odd_diagrams.map((d, i) => {
    const body = h("div", null);
    let drawn = false;
    const draw = () => {
      if (!drawn) { drawn = true; body.replaceChildren(diagramBox(d.source, t("project.progressOf", { name: d.name }))); }
    };
    const head = t("project.featureDone", { name: d.name, done: fmt(d.done), total: fmt(d.total) });
    const det = h("details", { open: i === 0 }, h("summary", null, head), body);
    det.addEventListener("toggle", () => { if (det.open) draw(); });
    if (i === 0) draw();
    return det;
  }));
}
// Graph sync for one project: last sync, whether it is older than the last commit, and the two guarded actions
// (refresh now; install the git hooks). The refresh runs in a detached process, so after the 202 the page polls the
// project page until the sync time changes or the refresh is over.
const GRAPH_POLL_MS = 3000, GRAPH_POLL_MAX = 60;
function graphFreshness(g) {
  if (g.running) return h("p", { class: "muted" }, t("project.syncRunning"));
  if (!g.mirrored || !g.last_commit || g.stale === null || g.stale === undefined) return null;
  return g.stale ? h("p", { class: "warn" }, "▲ " + t("project.graphStale", { at: R.fmtDateTime(g.last_commit) }))
    : h("p", { class: "muted" }, t("project.graphFresh", { at: R.fmtDateTime(g.last_commit) }));
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
  const fail = (res) => out.replaceChildren(h("div", { class: "notice warn", role: "alert" },
    "▲ " + (res.data && res.data.error ? ts(res.data.error) : t("common.requestFailed", { status: res.status }))));
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
    try { res = await postJson(path, { project: pg.id }); } catch (err) {
      res = { ok: false, status: 0, data: { error: netError(err) } };
    }
    if (!res.ok) { busy(false); fail(res); return; }
    out.replaceChildren(h("p", null, "✓ " + t(started)));
    then();
  };
  sync.addEventListener("click", () => act("/api/projects/graph-sync", "project.syncStarted", () => poll(g.synced_at)));
  const connected = () => { busy(false); state.connectedNote = pg.id; render(); };
  if (connect) connect.addEventListener("click", () => act("/api/projects/graph-connect", "project.connected", connected));
  if (g.running) { busy(true); poll(g.synced_at); }
  const help = h("p", { class: "muted" }, connect ? t("project.connectHelp") : t("project.syncHelp"));
  return h("div", { class: "actions" }, ...buttons, help, out);
}
// Overview: graph freshness and its actions; the node counts and the explorer live in the Graph tab.
function projectGraphBlock(pg) {
  if (!pg.graph) return null;
  const g = pg.graph, graphTabHash = R.routeHash({ kind: "project", id: pg.id, query: { tab: "graph" } });
  return h("section", { class: "page-section" }, h("h2", null, t("project.graphMemory")),
    g.mirrored ? h("p", null, t("project.graphSynced", { at: R.fmtDateTime(g.synced_at) }) + " ",
      h("a", { href: graphTabHash }, t("project.browseNodes")))
      : h("p", { class: "muted" }, t("project.notMirrored") + " ", codeSpans(ts(g.howto))),
    graphFreshness(g), graphActions(pg));
}

async function viewFeatures() {
  const odd = await api("odd");
  const docs = odd.repos.flatMap((r) => r.documents.map((d) => ({ ...d, repo: r.repo })));
  if (!docs.length) return [teach(t("nav.feature"), t("feature.empty"))];
  const id = (d) => d.id || `${d.repo}/${d.name.replace(/\.md$/, "")}`;
  const item = (d) => h("li", null, link("feature", id(d), d.name), h("span", { class: "muted" }, ` ${d.repo}`),
    " " + t("feature.tasksDone", { done: fmt(d.done), total: fmt(d.total) }));
  return [h("h1", null, t("nav.feature")), h("ul", { class: "items" }, docs.map(item))];
}

async function viewGraph() { return graphExplorer(); }
