"use strict";
// Activity pages: what was spent (#/usage), sessions (#/session), and tools and skills (#/tool).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

// Usage opens with one sentence answering "what did I spend" for the filtered range (impeccable critique, plan N12f).
function usageSentence(tot, hit, c) {
  const p = { messages: tn("usage.messagesN", tot.messages, { n: fmt(tot.messages) }),
    sessions: tn("usage.sessionsN", tot.sessions, { n: fmt(tot.sessions) }), input: short(tot.input), output: short(tot.output), hit: pct(hit) };
  const cost = c && c.enabled && c.total != null ? " " + t("usage.costLead", { cost: R.fmtDecimal(c.total, 2) }) : "";
  return t(hit == null ? "usage.summaryNoCache" : "usage.summary", p) + cost;
}

// Every calendar day from the first to the last one with data, empty days as zeros: the date axis never skips a day.
function fillDays(daily) {
  const by = new Map(daily.map((d) => [String(d.day), d]));
  const days = [...by.keys()].sort();
  const step = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const out = [];
  for (let day = days[0]; day && day <= days[days.length - 1] && out.length < 4000; day = step(day)) {
    out.push(by.get(day) || { day, input: 0, output: 0, cache_read: 0, cache_write: 0 });
  }
  return out;
}

// Stacked bars per day. The SVG holds only the marks (it stretches to the panel); the axis labels are HTML text so they
// keep their size on a phone. Each day has a hover title; the exact values are in the table under the chart.
const CHART_H = 200, COL_W = 10;
function chartBody(days, kinds) {
  const max = Math.max(1, ...days.map((d) => kinds.reduce((a, [k]) => a + (d[k] || 0), 0)));
  const W = days.length * COL_W, last = days[days.length - 1];
  const root = svg("svg", { viewBox: `0 0 ${W} ${CHART_H}`, preserveAspectRatio: "none", class: "chart-svg", role: "img",
    "aria-label": t("usage.chartLabel", { from: days[0].day, to: last.day }) });
  for (const y of [0, CHART_H / 2, CHART_H]) root.append(svg("line", { x1: 0, x2: W, y1: y, y2: y, class: "axis" }));
  days.forEach((d, i) => {
    let y = CHART_H;
    const tip = `${R.fmtDate(d.day)}: ` + kinds.map(([k, l]) => `${t(l)} ${fmt(d[k] || 0)}`).join(", ");
    const g = svg("g", { "data-day": d.day }, svg("title", null, tip));
    for (const [k] of kinds) {
      const hgt = ((d[k] || 0) / max) * CHART_H;
      y -= hgt;
      if (hgt > 0) g.append(svg("rect", { x: i * COL_W + 1, y, width: COL_W - 2, height: hgt, class: `f-${k}` }));
    }
    root.append(g);
  });
  const ends = days.length > 2 ? [days[0], days[Math.floor((days.length - 1) / 2)], last] : days;
  const yAxis = h("div", { class: "chart-y", "aria-hidden": "true" }, [short(max), short(max / 2), "0"].map((v) => h("span", null, v)));
  const xAxis = h("div", { class: "chart-x", "aria-hidden": "true" }, ends.map((d) => h("span", null, R.fmtDate(d.day))));
  return [h("div", { class: "legend" }, kinds.map(([k, l]) => h("span", null, h("span", { class: `sw f-${k}` }), t(l)))),
    h("div", { class: "chart-plot" }, yAxis, root, h("span", null), xAxis)];
}
// The values behind the chart, one row per day in date order (a plain table: sorting would break the time order).
function dayTable(days) {
  const head = h("tr", null, h("th", null, t("col.day")), KINDS.map(([, l]) => h("th", { class: "n" }, t(l))));
  const cells = (d) => KINDS.map(([k]) => h("td", { class: "n" }, fmt(d[k] || 0)));
  const rows = days.map((d) => h("tr", null, h("td", null, R.fmtDate(d.day)), cells(d)));
  return h("details", { class: "chart-values" }, h("summary", null, t("usage.perDay")),
    h("div", { class: "scroll", tabindex: 0, role: "region", "aria-label": t("usage.perDay") }, h("table", null, h("thead", null, head), h("tbody", null, rows))));
}
// Input and output first (the costly kinds); cache read and write join behind a visible toggle (critique C2).
function usageChart(daily) {
  if (!daily.length) return empty(t("usage.noneRange"));
  const days = fillDays(daily);
  const toggle = h("input", { type: "checkbox" });
  toggle.checked = Boolean(state.usageCache);
  const box = h("div", { class: "chart" });
  const draw = () => box.replaceChildren(...chartBody(days, toggle.checked ? KINDS : KINDS.slice(0, 2)));
  toggle.addEventListener("change", () => { state.usageCache = toggle.checked; draw(); });
  draw();
  return h("div", null, h("label", { class: "check" }, toggle, " ", t("usage.includeCache")), box, dayTable(days));
}

function modelBars(models) {
  const total = models.reduce((a, m) => a + KINDS.reduce((s, [k]) => s + (m[k] || 0), 0), 0) || 1;
  return table("models", [{ key: "model", label: t("col.model") }, { key: "messages", label: t("col.messages"), num: true },
    ...KINDS.map(([k, l]) => ({ key: k, label: t(l), num: true })), { key: "share", label: t("col.share"), num: true, render: (v) => pct(v) },
  ], models.map((m) => ({ ...m, share: KINDS.reduce((s, [k]) => s + (m[k] || 0), 0) / total })));
}
function costPanel(c) {
  if (c.error) return panel(t("cost.title"), h("p", { class: "warn" }, ts(c.error)));
  if (!c.enabled) return null;
  return panel(t("cost.title"), h("p", { class: "warn" }, ts(c.label)),
    c.invalid_prices && c.invalid_prices.length ? h("p", { class: "warn" }, t("cost.invalid", { models: c.invalid_prices.join(", ") })) : null,
    table("cost", [{ key: "model", label: t("col.model") }, { key: "cost", label: t("cost.estimated"), num: true,
      render: (v) => (v == null ? t("cost.noPrice") : R.fmtDecimal(v, 2)) }], c.models),
    h("p", null, t("cost.total"), " ", h("strong", null, R.fmtDecimal(c.total || 0, 2))));
}

async function viewOverview() {
  const [o, c] = await Promise.all([api("overview", filters()), api("costs", filters())]);
  if (!o.available) return [panel(t("nav.usage"), empty(t("usage.nodata.refresh")))];
  dataAsOf([o.totals.latest]);
  sortOnce("sessday", "day"); // a daily table opens newest day first, until a header is clicked
  const runtimeCols = [{ key: "runtime", label: t("col.runtime"), render: runtimeBadge }, { key: "sessions", label: t("nav.session"), num: true },
    { key: "messages", label: t("col.messages"), num: true }, ...KINDS.map(([k, l]) => ({ key: k, label: t(l), num: true }))];
  return [
    h("p", { class: "lead" }, usageSentence(o.totals, o.cache_hit_ratio, c)),
    h("p", { class: o.dropped_events ? "muted warn" : "muted" }, tn("usage.eventsLine", o.events, { n: fmt(o.events),
      dropped: o.dropped_events ? t("usage.dropped", { n: fmt(o.dropped_events) }) : t("usage.droppedNone") })),
    panel(t("usage.tokensPerDay"), usageChart(o.daily)),
    panel(t("usage.sessionsPerDay"), o.daily.length ? table("sessday", [{ key: "day", label: t("col.day") },
      { key: "sessions", label: t("nav.session"), num: true }, { key: "messages", label: t("col.messages"), num: true }], o.daily) : empty(t("usage.noSessionsRange"))),
    panel(t("usage.modelSplit"), modelBars(o.models)),
    o.runtimes && o.runtimes.length > 1 ? panel(t("usage.byRuntime"), table("runtimes", runtimeCols, o.runtimes)) : null,
    costPanel(c),
  ].filter(Boolean);
}

// Tools and skills (#/tool): the segment is part of the hash (?seg=), so a reload or a shared link keeps it. Each segment is a link.
async function viewTools(route) {
  const tl = await api("tools", filters());
  if (!tl.available) return [empty(t("usage.nodata"))];
  dataAsOf(Object.values(tl).flatMap((v) => (Array.isArray(v) ? v.map((r) => r.last_used) : [])));
  const kinds = [["skills", t("nav.skill")], ["tools", t("nav.tool")], ["mcp", t("nav.mcp")], ["mcptools", t("usage.mcpTools")],
    ["subagents", t("usage.subagents")]];
  const field = R.usageSegment(route), seg = kinds.find(([s]) => R.SEGMENTS[s] === field)[0];
  const linkKind = { skills: "skill", tools: "tool", mcp_servers: "mcp", mcp_tools: "tool" }[field];
  const cols = [{ key: "name", label: t("col.name"), render: linkKind ? (v) => link(linkKind, v, v) : undefined },
    { key: "count", label: t("col.calls"), num: true }, { key: "sessions", label: t("nav.session"), num: true }, { key: "last_used", label: t("col.lastUsed") }];
  const count = (s) => fmt(tl[R.SEGMENTS[s]].length);
  const item = ([s, l]) => h("a", { href: R.segmentHash(s), "aria-current": s === seg ? "true" : false },
    t("usage.segUsed", { label: l, n: count(s) })); // used in the range: not the Catalog's or the Overview's skill count
  const none = t(filters().runtime === "codex" ? "usage.noCodexTools" : "usage.nothingRange"); // Codex tool calls are never recorded
  return [
    h("nav", { class: "segmented segmented-wrap", "aria-label": t("usage.segments") }, kinds.map(item)),
    panel(null, tl[field].length ? table("usage-" + field, cols, tl[field]) : empty(none)),
  ];
}

// Sessions (#/session): the shared session columns (app.js); the Project filter above is the one way to narrow it.
async function viewSessions() {
  const s = await api("sessions", filters());
  if (!s.available) return [empty(t("usage.nodata"))];
  dataAsOf(s.sessions.map((x) => x.last_ts));
  sortOnce("sessions", "last_ts"); // newest first, like a project's Sessions tab
  return [s.sessions.length ? table("sessions", sessionColumns(), s.sessions) : empty(t("usage.noSessionsRange"))];
}

// Event handlers run outside render()'s try/catch: show the failure where the result would have gone.
function guarded(fn, into) {
  return async (...args) => {
    try { await fn(...args); } catch (err) { into.hidden = false; into.replaceChildren(errorNote(err)); }
  };
}
