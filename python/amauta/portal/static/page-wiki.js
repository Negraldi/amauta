"use strict";
// Wiki pages: the shared page blocks, the skill catalog and the harness component catalog.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

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
    ...bars.map((b) => svg("g", null, svg("title", null, tn("uot.bar", b.value, { day: R.fmtDate(b.day), n: fmt(b.value) })), svg("rect", { x: b.x, y: b.y, width: b.width, height: b.height, class: "f-input" }))),
    svg("line", { x1: 0, x2: W, y1: H, y2: H, class: "axis" }), svg("text", { x: 0, y: H + 11 }, R.fmtDate(bars[0].day)), svg("text", { x: W, y: H + 11, "text-anchor": "end" }, R.fmtDate(last)));
  return h("section", { class: "page-section" }, h("h2", null, t("uot.title")), h("p", { class: "muted" }, tn("uot.summary", total, { n: fmt(total), days: fmt(usage.days), last: R.fmtDate(last) })), h("div", { class: "spark" }, root));
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
    h("div", { class: "controls" }, box), list, ...(cat.total ? [] : [h("p", { class: "muted" }, t("skills.where"))])];
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
    ...(cat.refresh && cat.refresh.servers ? [refreshControl(null)] : []), h("div", { class: "controls" }, box), list, ...(cat.total ? [] : [h("p", { class: "muted" }, t("components.where"))])];
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
