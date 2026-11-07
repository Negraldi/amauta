"use strict";
// Home page: recent activity, spending, health and the skill-impact rail (#/).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

function localDays(days) {
  const by = new Map();
  for (const d of days) for (const i of d.items) { const day = R.fmtDate(i.ts); if (!by.has(day)) by.set(day, []); by.get(day).push(i); }
  return [...by.entries()].filter(([day]) => day !== "-").sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, items]) => ({ day, items: items.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1)) }));
}
function activityBlock(days) {
  if (!days.length) return h("p", { class: "muted" }, t("home.empty"));
  return h("div", null, localDays(days).map((d) => h("section", { class: "page-section day" }, h("h2", null, d.day),
    h("ul", { class: "items" }, d.items.map((i) => h("li", null, h("span", { class: "muted" }, `${kindLabel(i.kind)} `), link(i.kind, i.id, i.title), h("span", { class: "muted" }, ` ${ts(i.what)}, ${R.fmtDateTime(i.ts).slice(11) || "?"}`)))))));
}
function spendingBlock(sp) {
  if (!sp.available) return h("p", { class: "muted" }, t("home.noSpending"));
  const by = Object.fromEntries(sp.windows.map((w) => [w.days, w]));
  const cols = sp.windows.map((w) => w.days);
  return h("div", null,
    h("table", { class: "compact" }, h("thead", null, h("tr", null, h("th", null, t("home.tokens")), cols.map((d) => h("th", { class: "n" }, t("home.days", { n: fmt(d) }))))),
      h("tbody", null, KINDS.map(([k, label]) => h("tr", null, h("td", null, label), cols.map((d) => h("td", { class: "n" }, short(by[d][k]))))))),
    sp.runtimes && sp.runtimes.length > 1 ? h("div", null, h("h3", null, t("home.byRuntime")),
      h("table", { class: "compact" }, h("thead", null, h("tr", null, h("th", null, t("col.runtime")), cols.map((d) => h("th", { class: "n" }, t("home.days", { n: fmt(d) }))))),
        h("tbody", null, sp.runtimes.map((r) => h("tr", null, h("td", null, runtimeName(r.runtime)), r.windows.map((w) => h("td", { class: "n" }, short(KINDS.reduce((a, [k]) => a + (w[k] || 0), 0))))))))) : null,
    h("p", null, t("home.cacheRatio", { n: fmt(cols[cols.length - 1]) }) + " ", h("strong", null, pct(sp.cache_hit_ratio))),
    sp.top_models.length ? h("div", null, h("h3", null, t("home.topModels")), h("ul", { class: "refs" }, sp.top_models.map((m) => h("li", null, m.model, h("span", { class: "muted" }, " " + t("home.tokensN", { n: short(m.tokens) })))))) : null,
    h("p", null, link("usage", "", t("home.usageDetails"))));
}
function healthBlock(hl) {
  if (!hl.installed) return h("p", { class: "muted" }, t("harness.notInstalled"));
  const rows = [[t("harness.version"), hl.version || "-"], [t("harness.hooks"), fmt(hl.hooks)], [t("nav.mcp"), fmt(hl.mcp_servers)], [t("nav.skill"), fmt(hl.skills)], [t("home.agents"), fmt(hl.agents)], [t("harness.telemetry"), hl.telemetry ? t("common.on") : t("common.off")]];
  return h("div", null, h("dl", { class: "meta" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, String(v))])), h("p", null, link("harness", "", t("home.harnessDetails"))));
}
function impactRankBlock(rk) {
  if (!rk || !rk.available) return null;
  const line = (r) => h("li", null, `${r.verdict === "better" ? "▼" : "▲"} `, link("skill", r.skill, r.skill),
    h("span", { class: "muted" }, " " + t("home.rankLine", { delta: R.fmtDelta("error_rate", r.delta, words()), n: fmt(r.n), sessions: fmt(r.sessions) })));
  const list = (title, rows) => (rows.length ? h("div", null, h("h3", null, title), h("ul", { class: "refs" }, rows.map(line))) : null);
  const none = !rk.best.length && !rk.worst.length;
  return h("div", null,
    none ? h("p", { class: "muted" }, t("home.noRank", { n: fmt(rk.min_sessions) })) : null,
    list(t("home.lowerError"), rk.best), list(t("home.higherError"), rk.worst),
    h("p", { class: "muted" }, t("home.rankFoot", { ranked: fmt(rk.ranked), tracked: fmt(rk.tracked), days: fmt(rk.days) }) + " " + ts(rk.note)));
}
async function viewHome() {
  const hm = await api("wiki/home");
  return [h("div", { class: "page" }, h("article", { class: "doc" }, h("h1", null, t("home.title")), activityBlock(hm.activity)),
    h("aside", { class: "rail", "aria-label": t("home.railLabel") }, railBlock(t("nav.spending"), spendingBlock(hm.spending)), railBlock(t("home.skillImpact"), impactRankBlock(hm.impact)), railBlock(t("home.health"), healthBlock(hm.health))))];
}
// Lint: candidates worth a second look, counted per check and linked to their pages. Wording is "review", never a verdict.
