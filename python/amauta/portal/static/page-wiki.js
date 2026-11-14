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
// Server sections whose item labels are fixed text.
const CHROME_ITEMS = ["Tokens in the sessions that used it", "Tool calls", "Last refresh"];

function skeleton() {
  return h("div", { class: "skeleton", "aria-hidden": "true" }, h("div", { class: "sk sk-title" }), h("div", { class: "sk" }), h("div", { class: "sk" }), h("div", { class: "sk sk-short" }));
}
function teach(title, ...paras) {
  return h("div", { class: "teach" }, h("h1", null, title), ...paras.map((p) => h("p", null, p)), h("p", null, link("home", "", t("common.backHome"))));
}
const REF_ROWS = 20; // a rail list opens on 20 rows; `total` (from the server) is the real number when it sent fewer
function refList(refs, total) {
  const row = (r) => h("li", null, link(r.kind, r.id, r.title, null, r.source), h("span", { class: "muted" }, ` ${kindLabel(r.kind)}`));
  return pagedList(refs, REF_ROWS, row, { class: "refs" }, total);
}
function railBlock(title, body) { return body ? h("section", { class: "rail-block" }, h("h2", null, title), body) : null; }

function sectionBlock(s) {
  // Item labels that link to a page, or are user content (ODD task titles), stay as written; only the fixed token-row labels are translated.
  const label = (it) => (CHROME_ITEMS.includes(s.heading) ? ts(it.label) : it.label);
  const heading = s.relation ? relationHeading(s.relation, s.direction) : ts(s.heading);
  return h("section", { class: "page-section" }, h("h2", null, heading), h("ul", { class: "items" }, s.items.map((it) => h("li", null,
    it.kind && it.id ? link(it.kind, it.id, it.label, null, it.source) : h("span", null, label(it)),
    it.value == null ? null : s.relation ? h("span", { class: "muted" }, ` ${nodeKind(it.value)}`)
      : isStatus(it.value) ? statusChip(it.value) : h("span", { class: "muted" }, ` ${groupDigits(ts(R.fmtMeta(it)))}`)))));
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
    h("p", null, h("strong", null, label), ` (${R.fmtPercent(p.percent / 100, 0)})`, statusChip("done"), ` ${fmt(pg.progress.done)}`, statusChip("pending"), ` ${fmt(pending)}`));
}

function commitsBlock(commits) {
  if (!commits || !commits.length) return null;
  return h("section", { class: "page-section" }, h("h2", null, t("commits.title")), h("ul", { class: "items" }, commits.map((c) => h("li", null, h("code", null, c.hash), ` ${c.subject}`, h("span", { class: "muted" }, ` ${R.fmtDate(c.date)}`)))));
}

// Graph node: the neighborhood diagram is drawn lazily (mermaid loads on first use) from source the server generated with every label escaped.
function nodeDiagramBlock(diagram) {
  if (!diagram || !diagram.source) return null;
  const box = diagramBox(localizeGraphSource(diagram.source), t("node.neighborsOfThis"));
  return h("section", { class: "page-section" }, h("h2", null, t("node.neighborhood")), box,
    diagram.truncated ? nearestNote(R.NODE_CAP, diagram) : null);
}

// Skill impact (comparative): the metrics with their sample sizes, then the change log with before/after deltas. Direction is a shape plus words.
function markSpan(m) {
  const d = R.deltaMark(m);
  return h("span", { class: `mark mark-${d.name}` }, `${d.mark} ${t(`delta.${d.name}`)}`);
}
// A reason shared by every cut row of the block is said once above the table (`shared`); a row keeps only a reason of its own.
const reasonText = (r) => (r ? ts(r) : t("impact.tooFew"));
function impactRow(name, m, shared) {
  const reason = m.suppressed && reasonText(m.reason) !== shared ? h("div", { class: "muted" }, reasonText(m.reason)) : null;
  return h("tr", null, h("td", null, ts(m.label), reason), h("td", { class: "n" }, R.fmtMetric(name, m.exposed.value, words())), h("td", { class: "n" }, R.fmtMetric(name, m.baseline.value, words())),
    h("td", null, markSpan(m), m.delta == null ? null : h("span", { class: "muted" }, ` ${R.fmtDelta(name, m.delta, words())}`)),
    h("td", { class: "n" }, `${fmt(m.exposed.n)} / ${fmt(m.baseline.n)}`));
}
function changeItem(c, shared) {
  const head = c.kind === "installed" ? t("impact.installedVersion", { label: c.label }) : t("impact.commit", { label: c.label });
  const when = R.fmtDate(c.when || c.ts);
  const own = reasonText(c.reason) === shared ? null : h("p", { class: "muted" }, reasonText(c.reason)); // a shared reason is said above
  const lines = c.suppressed ? [own] : Object.entries(c.metrics).filter(([, m]) => m.delta != null).map(([name, m]) =>
    h("li", null, t("impact.beforeAfter", { label: ts(m.label), before: R.fmtMetric(name, m.before, words()), after: R.fmtMetric(name, m.after, words()) }) + " ", markSpan(m), h("span", { class: "muted" }, " " + t("impact.n", { before: fmt(m.n_before), after: fmt(m.n_after) }))));
  return h("li", null, h("strong", null, head), h("span", { class: "muted" }, ", " + tn("impact.sessionsAround", c.before_sessions, { when, before: fmt(c.before_sessions), after: fmt(c.after_sessions) })), c.suppressed ? lines[0] : h("ul", { class: "items" }, lines));
}
function impactBlock(im) {
  if (!im) return null;
  const title = h("h2", null, t("impact.title"));
  const note = h("p", { class: "note" }, ts(im.note));
  if (!im.available) return h("section", { class: "page-section impact" }, title, note, h("p", { class: "muted" }, im.reason ? ts(im.reason) : t("impact.noData")));
  if (!im.exposed_sessions) return h("section", { class: "page-section impact" }, title, note, h("p", { class: "muted" }, t("impact.notLoaded", { days: fmt(im.days) })));
  const scope = im.control_scope === "same-project" ? t("impact.sameProject") : t("impact.allProjects");
  const m = im.metrics, u = m.unused_after_load;
  const keys = ["error_rate", "retry_rate", "tokens_per_turn", "test_failure_rate"];
  const cut = keys.map((k) => m[k]).filter((x) => x.suppressed).map((x) => reasonText(x.reason));
  const shared = cut.length > 1 && cut.every((r) => r === cut[0]) ? cut[0] : null;
  const rows = keys.map((k) => impactRow(k, m[k], shared));
  const ch = im.changes || { versions: [], commits: [], changes: [] };
  return h("section", { class: "page-section impact" }, title, note,
    h("p", null, t("impact.summary", { exposed: fmt(im.exposed_sessions), days: fmt(im.days), control: fmt(im.control_sessions), scope, min: fmt(im.min_sessions) })),
    im.outcomes_recorded ? null : h("p", { class: "muted" }, t("impact.noOutcomes")),
    shared ? h("p", { class: "muted" }, t("impact.sharedReason", { reason: shared })) : null,
    scrollBox(h("table", { class: "compact" }, h("thead", null, h("tr", null, h("th", null, t("impact.metric")), h("th", { class: "n" }, t("impact.afterLoad")), h("th", { class: "n" }, t("impact.baseline")), h("th", null, t("impact.difference")), h("th", { class: "n" }, t("impact.nCalls")))), h("tbody", null, rows))),
    h("p", null, u.suppressed ? t("impact.unusedSuppressed", { n: fmt(u.n), reason: u.reason && ts(u.reason) !== shared ? ts(u.reason) : t("impact.tooFewShare") }) : t("impact.unused", { unused: fmt(u.unused), n: fmt(u.n), rate: R.fmtMetric("rate", u.value, words()) })),
    h("h3", null, t("impact.changeLog")),
    ch.versions.length ? h("p", { class: "muted" }, t("impact.versions", { list: ch.versions.map((v) => `${v.hash}${v.current ? ` (${t("impact.current")})` : ""} ${R.fmtDate(v.first_seen)}`).join(", ") })) : null,
    ch.changes.length ? h("ul", { class: "items" }, ch.changes.map((c) => changeItem(c, shared)))
      : h("p", { class: "muted" }, t("impact.noChange")));
}

function pageExtras(pg) {
  return [usageBlock(pg.usage), pg.kind === "skill" ? impactBlock(pg.impact) : null, historyBlock(pg.history), commitsBlock(pg.commits), pg.kind === "node" ? nodeDiagramBlock(pg.diagram) : null];
}

function bodyNodes(pg, text = pg.body_md) {
  const known = (kind, id) => !(pg.missing || []).some((m) => m.kind === kind && m.id === id);
  let diagrams = 0;
  const mermaid = (src) => (++diagrams <= 5 ? diagramBox(src, t("diagram.mermaid")) : h("pre", { class: "code" }, h("code", null, src)));
  return MD.toDom(MD.parse(text), document, { known, mermaid, headingOffset: 1, labels: { missing: (kind, id) => t("md.missing", { kind, id }), table: t("table.label") } });
}

// The page data, or null when the server has no such page (any other failure reaches the error panel).
async function fetchWikiPage(kind, id, source) {
  try { return await api("wiki/page", { kind, id, source }); } catch (err) {
    if (/not found|no encontrad/i.test(plainReason(err))) return null;
    throw err;
  }
}
function noPage(kind, id) {
  const title = `notfound.${kind}` in I.dict.en ? t(`notfound.${kind}`) : t("page.none", { kind: kindLabel(kind).toLowerCase() });
  return [teach(title, t("page.nothingStored", { id }), HINTS.includes(kind) ? t(`hint.${kind}`) : "")];
}
// "a|b|c" may break after each bar (an argument hint), never one character per line.
const breakAfterBars = (v) => String(v).split(/(?<=\|)/).flatMap((part, i) => (i ? [h("wbr"), part] : [part]));
// The rail's details list; `keep` filters the rows (the project hub shows the other facts elsewhere).
function metaList(pg, keep) {
  const loose = pg.kind === "memory" && !pg.meta.some((m) => m.label === "Project"); // a memory saved without a project says so
  const none = loose ? [{ label: I.dict.en["kind.project"], value: t("mem.noProject") }] : [];
  const rows = [...(keep ? pg.meta.filter(keep) : pg.meta), ...none];
  if (!rows.length) return null;
  return h("dl", { class: "meta" }, rows.flatMap((m) => {
    const raw = m.label === "Found by" ? String(m.value).split(", ").map(originLabel).join(", ")
      : metaEnumLabel(pg.kind, m.label, m.value) || groupDigits(ts(R.fmtMeta(m)));
    const v = raw === "true" ? t("common.yes") : raw === "false" ? t("common.no") : raw; // front-matter booleans
    const dt = h("dt", null, `meta.${m.label}` in I.dict.en ? t(`meta.${m.label}`) : ts(m.label)); // SKILL.md keys get labels
    if (m.kind) return [dt, h("dd", null, link(m.kind, v, v))]; // a value that names a page (a session's project)
    if (R.isPathLike(v)) return [dt, h("dd", null, pathNode(v))];
    return [dt, String(v).includes("|") ? h("dd", null, breakAfterBars(v)) : h("dd", { class: R.isLongToken(v) ? "tok" : false }, v)];
  }));
}

// What it does already names the source (and its file), so the rail Source row and the server's origin section would
// say it twice.
// A long mono command reads as a code block in the main column, never squeezed into the rail.
const isOrigin = (s) => s.heading === "Source of these facts";
// "Configured in" with the one file the summary already names (T15 C10): the same fact twice.
const isSameConfig = (s, sm) => s.heading === "Configured in" && s.items.length === 1 && s.items[0].label === sm.path;
const isCommand = (m) => m.label === "Command";
function commandBlock(pg) {
  const cmd = pg.meta.find((m) => isCommand(m) && m.value);
  if (!cmd) return null;
  return h("section", { class: "page-section" }, h("h2", null, ts(cmd.label)), h("pre", { class: "code" }, h("code", null, String(cmd.value))));
}
async function viewWikiPage(kind, id, source) {
  const pg = await fetchWikiPage(kind, id, source);
  if (!pg) return noPage(kind, id);
  // Every item's crumb is its title, never its raw id (a memory's "709"); a session's is its short id, as the session tables
  // show it, since its title is the whole label (project, first prompt or model and count, date).
  state.pageTitle = pg.kind === "session" ? String(pg.id).slice(0, 8) : pg.title || null;
  const refs = (list, more) => (list.length ? refList(list, list.length + (more || 0)) : null);
  const sections = pg.summary ? pg.sections.filter((s) => !isOrigin(s) && !isSameConfig(s, pg.summary)) : pg.sections;
  const h1 = h("h1", null, itemTitle(pg.kind, pg.kind === "session" ? sessionHeading(pg.title) : pg.title));
  const keep = (m) => !isCommand(m) && !(pg.summary && m.label === "Source")
    && !(pg.progress && m.label === "Tasks done"); // the progress bar says it
  return [h("div", { class: pg.kind === "node" ? "page page-wide" : "page" },
    h("article", { class: "doc" },
      h1, progressBlock(pg), summaryBlock(pg.summary), // the breadcrumb names the kind
      commandBlock(pg),
      pg.refresh ? refreshControl(pg.refresh.server) : null, pg.body_md ? h("div", { class: "prose" }, bodyNodes(pg)) : null,
      ...sections.map(sectionBlock), explainBlock(pg), ...pageExtras(pg)),
    h("aside", { class: "rail", "aria-label": t("page.details") }, railBlock(t("page.detailsTitle"), metaList(pg, keep)),
      railBlock(t("page.links"), refs(pg.links)), railBlock(t("page.linkedFrom"), refs(pg.backlinks, pg.backlinks_more))))];
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
      h("div", { class: "prose" }, bodyNodes(pg, localizeExplain(ex.note.body_md))));
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
const clip = (text) => clipText(text, 220);
const CATALOG_CAP = 8; // items per kind in the All view; the kind link shows the rest
const catalogHash = (kind) => R.routeHash({ kind: "component", id: "", query: kind ? { kind } : {} });
// Skills join the component groups as one "Skills" group; each row keeps the label of where it comes from.
function skillGroup(sk) {
  const row = (g) => (i) => ({ kind: "skill", id: i.id, title: i.id, description: i.description, source: g.label, uses: i.uses,
    sessions: i.sessions, last_used: i.last_used, disabled: i.disabled, runtimes: i.runtimes });
  const items = ((sk && sk.groups) || []).flatMap((g) => g.items.map(row(g)));
  return items.length ? [{ kind: "skill", label: t("catalog.kind.skill"), items }] : [];
}
function catalogRow(i) {
  const used = i.kind === "skill" && i.uses;
  const usage = used ? h("div", { class: "muted" }, t("skills.usage", { calls: tn("skills.calls", i.uses, { n: fmt(i.uses) }), sessions: tn("skills.sessions", i.sessions, { n: fmt(i.sessions) }),
    last: R.fmtDate(i.last_used) })) : null;
  return h("li", null, link(i.kind, i.id, i.title), h("span", { class: "muted" }, ` ${ts(i.source)}`),
    i.disabled ? h("span", { class: "chip chip-off" }, `\u25cb ${t("components.disabled")}`) : null,
    i.description ? h("div", null, clip(localized(i, "description"))) : null, usage,
    i.runtimes ? h("div", { class: "muted" }, t("catalog.runtime", { names: runtimeNames(i.runtimes) })) : null);
}
function catalogGroup(g, capped) {
  const shown = capped ? g.items.slice(0, CATALOG_CAP) : g.items;
  const label = ts(g.label);
  const more = shown.length < g.items.length
    ? h("p", null, h("a", { href: catalogHash(g.kind) }, t("catalog.showAll", { n: fmt(g.items.length), label }))) : null;
  return h("section", { class: "page-section", "aria-label": label }, h("h2", null, `${label} (${fmt(g.items.length)})`),
    g.lead ? h("p", { class: "muted" }, ts(g.lead)) : null, // said once for the group, not on every row
    h("ul", { class: "items" }, shown.map(catalogRow)), more);
}
// The kind links: All plus one per kind present, each with its count; the current one is marked, the choice lives in ?kind=.
// Up to a dozen kinds: the group wraps onto rows (segmented-wrap) instead of hiding kinds behind a sideways scroll.
function kindLinks(groups, current, counts) {
  const count = (g) => (counts ? counts.get(g.kind) || 0 : g.items.length); // the counts follow the text filter
  const total = groups.reduce((n, g) => n + count(g), 0);
  const one = (kind, label, n) => h("a", { href: catalogHash(kind), "aria-current": kind === current ? "true" : false }, `${label} (${fmt(n)})`);
  return h("nav", { class: "segmented segmented-wrap", "aria-label": t("catalog.kinds") }, one("", t("catalog.all"), total),
    ...groups.map((g) => one(g.kind, ts(g.label), count(g))));
}
// Catalog (#/component): every harness component and skill, grouped by kind; ?kind= keeps one kind, the box filters what is loaded.
// When only one of the two lists loads, the page shows it with the error panel for the other.
async function viewCatalog(route) {
  const [res, sk] = await Promise.all([api("harness/components").catch((err) => ({ err })), api("skills").catch(() => null)]);
  if (res.err && !sk) throw res.err; // nothing to show: the page error panel
  const cat = res.err ? { groups: [] } : res;
  const groups = [...skillGroup(sk), ...cat.groups];
  const asked = route.query && route.query.kind;
  const kind = asked && groups.some((g) => g.kind === asked) ? asked : "";
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const list = h("div", { "aria-live": "polite" }); // an empty result is announced
  const kinds = kindLinks(groups, kind);
  const box = h("input", { type: "search", placeholder: t("components.filter"), "aria-label": t("components.filter"), value: state.componentQuery || "" });
  const paint = () => {
    state.componentQuery = box.value;
    const found = R.filterComponents(kind ? groups.filter((g) => g.kind === kind) : groups, box.value);
    const none = empty(total ? t("components.noMatch") : t("components.none"));
    list.replaceChildren(...(found.length ? found.map((g) => catalogGroup(g, !kind && !box.value.trim())) : [none]));
    const counts = new Map(R.filterComponents(groups, box.value).map((g) => [g.kind, g.items.length]));
    kinds.replaceChildren(...kindLinks(groups, kind, counts).children);
  };
  box.addEventListener("input", paint);
  paint();
  const teachWhere = total ? null : h("div", { class: "teach" }, h("p", null, t("components.where")), h("p", null, t("skills.where")));
  const refresh = cat.refresh && cat.refresh.servers ? refreshControl(null) : null;
  return [pageHead(t("nav.catalog"), tn("catalog.intro", total, { n: fmt(total) })), res.err ? errorPanel(route, res.err) : null,
    noCodexNote(cat.runtimes), kinds, h("div", { class: "controls" }, box), refresh, list, teachWhere];
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
    sm.generic ? h("p", null, h("a", { href: catalogHash("mcp") }, t("summary.mcpAll"))) : null, // what a server is: said once, on the list
    h("p", { class: "muted" }, t("summary.source", { source: ts(sm.source) }), sm.path ? [" · ", h("code", { class: "tok" }, sm.path)] : null));
}
