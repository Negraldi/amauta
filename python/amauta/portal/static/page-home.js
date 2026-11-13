"use strict";
// Home page: recent activity, spending, health and the skill-impact rail (#/).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

function localDays(days) {
  const by = new Map();
  for (const d of days) for (const i of d.items) { const day = R.fmtDate(i.ts); if (!by.has(day)) by.set(day, []); by.get(day).push(i); }
  return [...by.entries()].filter(([day]) => day !== "-").sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, items]) => ({ day, items: items.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1)) }));
}
// The server writes counts as plain digits ("session, 11300 messages"): group them like every other number on the page.
const groupCounts = (text) => String(text).replace(/(?<![\w.,:\/-])\d{4,}(?![\w.,:\/-])/g, (m) => fmt(Number(m)));
// The feed shows the HOME_DAYS most recent days; Show more adds as many again (client side, the server sends them all).
const HOME_DAYS = 5;
// "12 messages, 21:10", or only the time when the title already says the rest (the server leaves `what` empty then).
const feedTail = (i) => [i.what ? groupCounts(ts(i.what)) : "", R.fmtDateTime(i.ts).slice(11) || "?"].filter(Boolean).join(", ");
const dayBlock = (d) => h("section", { class: "page-section day" }, h("h3", null, d.day),
  h("ul", { class: "items" }, d.items.map((i) => h("li", null, h("span", { class: "muted" }, `${kindLabel(i.kind)} `), link(i.kind, i.id, i.title), h("span", { class: "muted" }, ` ${feedTail(i)}`)))));
function activityBlock(days) {
  if (!days.length) return h("p", { class: "muted" }, t("home.empty"));
  const all = localDays(days), box = h("div", null, all.slice(0, HOME_DAYS).map(dayBlock));
  if (all.length <= HOME_DAYS) return box;
  let shown = HOME_DAYS;
  const more = h("button", { type: "button" }, t("home.showMore")), wrap = h("div", null, box, more);
  more.addEventListener("click", () => {
    const added = all.slice(shown, shown + HOME_DAYS).map(dayBlock);
    box.append(...added);
    shown += added.length;
    if (shown >= all.length) wrap.replaceChildren(box); // everything shows: nothing more to ask for
    added[0].setAttribute("tabindex", "-1"); // focus moves to the first new day, never lost with a removed button
    if (added[0].focus) added[0].focus();
  });
  return wrap;
}
function spendingBlock(sp) {
  if (!sp.available) return h("p", { class: "muted" }, t("home.noSpending"));
  const by = Object.fromEntries(sp.windows.map((w) => [w.days, w]));
  const cols = sp.windows.map((w) => w.days);
  const dayHeads = () => cols.map((d) => h("th", { class: "n" }, t("home.days", { n: fmt(d) })));
  const compact = (head, rows) => scrollBox(h("table", { class: "compact" }, h("thead", null, h("tr", null, head)), h("tbody", null, rows)));
  return h("div", null,
    compact([h("th", null, t("home.tokens")), ...dayHeads()],
      KINDS.map(([k, label]) => h("tr", null, h("td", null, t(label)), cols.map((d) => h("td", { class: "n" }, short(by[d][k])))))),
    sp.runtimes && sp.runtimes.length > 1 ? h("div", null, h("h3", null, t("home.byRuntime")),
      compact([h("th", null, t("col.runtime")), ...dayHeads()], sp.runtimes.map((r) => h("tr", null, h("td", null, runtimeName(r.runtime)),
        r.windows.map((w) => h("td", { class: "n" }, short(KINDS.reduce((a, [k]) => a + (w[k] || 0), 0)))))))) : null,
    h("p", null, t("home.cacheRatio", { n: fmt(cols[cols.length - 1]) }) + " ", h("strong", null, pct(sp.cache_hit_ratio))),
    sp.top_models.length ? h("div", null, h("h3", null, t("home.topModels")), h("ul", { class: "refs" }, sp.top_models.map((m) => h("li", null, m.model, h("span", { class: "muted" }, " " + t("home.tokensN", { n: short(m.tokens) })))))) : null,
    h("p", null, link("usage", "", t("home.usageDetails"))));
}
// "Is anything broken today?": the harness health sentence (same count as the Catalog); its component count links to the overview.
async function homeStatus(health) {
  if (!health || !health.installed) return h("p", { class: "lead warn" }, "▲ ", link("harness", "", t("harness.notInstalled")));
  const [hs, comps, skills] = await Promise.all(["harness", "harness/components", "skills"].map((p) => api(p).catch(() => null)));
  if (!hs || !hs.installed) return null; // the overview itself says how to install
  return healthLine(hs, comps, skills);
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
// The rail comes first in the DOM: one column under 72rem shows spending before the long feed; wide screens put it on the
// right (style.css .page.home).
async function viewHome() {
  const [hm, pipes] = await Promise.all([api("wiki/home"), pipelinesRail()]);
  const status = await homeStatus(hm.health);
  return [h("header", { class: "page-head" }, h("h1", null, t("home.title")), status), h("div", { class: "page home" },
    h("aside", { class: "rail", "aria-label": t("home.railLabel") }, railBlock(t("nav.pipelines"), pipes),
      railBlock(t("nav.spending"), spendingBlock(hm.spending)), railBlock(t("home.skillImpact"), impactRankBlock(hm.impact))),
    h("article", { class: "doc" }, h("h2", null, t("home.recent")), activityBlock(hm.activity)))];
}
// Lint: candidates worth a second look, counted per check and linked to their pages. Wording is "review", never a verdict.
