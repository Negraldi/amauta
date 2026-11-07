"use strict";
// Activity pages: token usage overview, usage tables and sessions (#/usage, #/session).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

async function viewOverview() {
  const [o, c] = await Promise.all([api("overview", filters()), api("costs", filters())]);
  if (!o.available) return [panel(t("nav.usage"), empty(t("usage.nodata.refresh")))];
  const tot = o.totals;
  const out = [
    h("div", { class: "grid" },
      card(t("usage.inputTokens"), short(tot.input)), card(t("usage.outputTokens"), short(tot.output)), card(t("tok.cache_read"), short(tot.cache_read)), card(t("tok.cache_write"), short(tot.cache_write)),
      card(t("usage.cacheHit"), pct(o.cache_hit_ratio), h("div", { class: "l" }, t("usage.cacheHitHelp"))),
      card(t("col.messages"), fmt(tot.messages)), card(t("nav.session"), fmt(tot.sessions)),
      card(t("usage.events"), fmt(o.events), o.dropped_events ? h("div", { class: "l warn" }, t("usage.dropped", { n: fmt(o.dropped_events) })) : h("div", { class: "l" }, t("usage.droppedNone")))),
    panel(t("usage.tokensPerDay"), stackedChart(o.daily)),
    panel(t("usage.sessionsPerDay"), o.daily.length ? table("sessday", [{ key: "day", label: t("col.day") }, { key: "sessions", label: t("nav.session"), num: true }, { key: "messages", label: t("col.messages"), num: true }], o.daily) : empty(t("usage.noSessionsRange"))),
    panel(t("usage.modelSplit"), modelBars(o.models)),
  ];
  if (o.runtimes && o.runtimes.length > 1) out.push(panel(t("usage.byRuntime"), table("runtimes", [{ key: "runtime", label: t("col.runtime"), render: runtimeBadge }, { key: "sessions", label: t("nav.session"), num: true }, { key: "messages", label: t("col.messages"), num: true }, ...KINDS.map(([k, l]) => ({ key: k, label: t(l), num: true }))], o.runtimes)));
  if (c.error) out.push(panel(t("cost.title"), h("p", { class: "warn" }, ts(c.error))));
  if (c.enabled) {
    out.push(panel(t("cost.title"), h("p", { class: "warn" }, ts(c.label)),
      c.invalid_prices && c.invalid_prices.length ? h("p", { class: "warn" }, t("cost.invalid", { models: c.invalid_prices.join(", ") })) : null,
      table("cost", [{ key: "model", label: t("col.model") }, { key: "cost", label: t("cost.estimated"), num: true, render: (v) => (v == null ? t("cost.noPrice") : R.fmtDecimal(v, 2)) }], c.models),
      h("p", null, t("cost.total"), " ", h("strong", null, R.fmtDecimal(c.total || 0, 2)))));
  }
  return out;
}

async function viewUsage() {
  const tl = await api("tools", filters());
  if (!tl.available) return [panel(t("nav.usage"), empty(t("usage.nodata")))];
  const kinds = [["skills", t("nav.skill")], ["tools", t("nav.tool")], ["mcp_servers", t("nav.mcp")], ["mcp_tools", t("usage.mcpTools")], ["subagents", t("usage.subagents")]];
  const linkKind = { skills: "skill", tools: "tool", mcp_servers: "mcp", mcp_tools: "tool" }[state.usageKind];
  const cols = [{ key: "name", label: t("col.name"), render: linkKind ? (v) => link(linkKind, v, v) : undefined }, { key: "count", label: t("col.calls"), num: true }, { key: "sessions", label: t("nav.session"), num: true }, { key: "last_used", label: t("col.lastUsed") }];
  return [
    h("div", { class: "tabs" }, kinds.map(([k, l]) => h("button", { type: "button", "aria-pressed": state.usageKind === k, onclick: () => { state.usageKind = k; render(); } }, `${l} (${fmt(tl[k].length)})`))),
    panel(kinds.find(([k]) => k === state.usageKind)[1], tl[state.usageKind].length ? table("usage-" + state.usageKind, cols, tl[state.usageKind]) : empty(t("usage.nothingRange"))),
  ];
}

async function viewSessions() {
  const s = await api("sessions", filters());
  if (!s.available) return [panel(t("nav.session"), empty(t("usage.nodata")))];
  const nums = [["messages", t("col.msgs")], ["input", t("tok.input")], ["output", t("tok.output")], ["cache_read", t("tok.cache_read")], ["cache_write", t("tok.cache_write")]].map(([key, label]) => ({ key, label, num: true }));
  return [
    panel(t("nav.project"), table("projects", [{ key: "project", label: t("kind.project"), link: true }, { key: "sessions", label: t("nav.session"), num: true }, ...nums], s.projects, (r) => { $("project").value = r.project; render(); })),
    panel(t("nav.session"), table("sessions", [{ key: "session_id", label: t("kind.session"), render: (v) => link("session", v, String(v).slice(0, 8)) }, { key: "runtime", label: t("col.runtime"), render: runtimeBadge }, { key: "project", label: t("kind.project") }, { key: "last_ts", label: t("col.lastActivity") }, { key: "model", label: t("col.model") }, ...nums], s.sessions)),
  ];
}

// Event handlers run outside render()'s try/catch: show the failure where the result would have gone.
function guarded(fn, into) {
  return async (...args) => {
    try { await fn(...args); } catch (err) { into.hidden = false; into.replaceChildren(h("p", { class: "warn" }, String(err.message || err))); }
  };
}


async function viewUsagePage() { return [...(await viewOverview()), ...(await viewUsage())]; }
