"use strict";
// Pure helpers for the wiki shell (no DOM): hash routing and the search palette's list handling.
(function () {
  // kind -> label shown in the sidebar and as the page's kind label
  const KINDS = {
    home: "Home", project: "Project", memory: "Memory", skill: "Skill", tool: "Tool", mcp: "MCP server", session: "Session", feature: "ODD feature",
    node: "Graph node", memfile: "Memory file", harness: "Harness", usage: "Usage", settings: "Settings", lint: "Lint",
    security: "Security", pipelines: "Pipelines", guide: "Guide",
    hook: "Hook", mcptool: "MCP tool", connector: "Connector", agent: "Agent", command: "Command", plugin: "Plugin", outputstyle: "Output style", component: "Components",
  };
  // ---- navigation model (portal redesign T1) ----------------------------------------------------------------------
  // The sidebar is DATA: job groups in order, each item a hub page with its hash, label key and (optionally) the list
  // routes shown as its tabs. The "foot" group renders apart at the bottom of the sidebar and has no breadcrumb group.
  const tab = (kind, key) => ({ kind, key });
  const NAV = [
    { id: "today", key: "nav.group.today", items: [{ hub: "home", kind: "home", hash: "#/", key: "nav.home" }] },
    { id: "work", key: "nav.group.work", items: [{ hub: "project", kind: "project", hash: "#/project", key: "nav.project" },
      { hub: "pipelines", kind: "pipelines", hash: "#/pipelines", key: "nav.pipelines" }] },
    { id: "knowledge", key: "nav.group.knowledge", items: [{ hub: "memory", kind: "memory", hash: "#/memory", key: "nav.memory",
      tabs: [tab("memory", "nav.memory"), tab("memfile", "nav.memfile"), tab("lint", "nav.lint")] },
    { hub: "graph", kind: "node", hash: "#/node", key: "nav.node" }] },
    { id: "activity", key: "nav.activity", items: [{ hub: "usage", kind: "usage", hash: "#/usage", key: "nav.usage",
      tabs: [tab("usage", "nav.usage"), tab("session", "nav.session"), tab("tool", "nav.toolsSkills")] }] },
    { id: "harnessWiki", key: "nav.group.harnessWiki", items: [
      { hub: "harness", kind: "harness", hash: "#/harness", key: "nav.harnessOverview" },
      { hub: "component", kind: "component", hash: "#/component", key: "nav.catalog" },
      { hub: "security", kind: "security", hash: "#/security", key: "nav.security" }] },
    { id: "foot", key: "nav.group.foot", foot: true, items: [{ hub: "guide", kind: "guide", hash: "#/guide", key: "nav.guide" },
      { hub: "settings", kind: "settings", hash: "#/settings", key: "nav.settings" }] }, // its tabs ride in ?tab= (SETTINGS_TABS)
  ];
  // An item kind -> the list route that shows it (a hub's own kind or one of its tabs), with the query that list needs.
  const CATALOG = ["hook", "mcptool", "connector", "agent", "command", "plugin", "outputstyle"];
  // Every kind the Catalog (#/component) lists, in its order; ?kind= picks one. Their item pages crumb through Catalog / <kind>.
  const CATALOG_KINDS = ["skill", "hook", "mcp", "mcptool", "connector", "tool", "agent", "command", "plugin", "outputstyle"];
  const catalogItem = (r) => Boolean(r && typeof r === "object" && r.id && CATALOG_KINDS.includes(r.kind));
  const LIST_OF = { feature: { kind: "project" }, mcp: { kind: "tool", query: { seg: "mcp" } }, themes: { kind: "settings" },
    skill: { kind: "component", query: { kind: "skill" } },
    ...Object.fromEntries(CATALOG.map((k) => [k, { kind: "component" }])) };
  const listOf = (kind) => LIST_OF[kind] || { kind };
  const NAV_ITEMS = NAV.flatMap((g) => g.items.map((item) => ({ ...item, group: g })));
  const itemOf = (kind) => {
    const list = listOf(kind).kind;
    return NAV_ITEMS.find((i) => i.kind === list || (i.tabs || []).some((t) => t.kind === list)) || null;
  };
  const kindOf = (r) => (typeof r === "string" ? r : (r && r.kind) || "");
  // A route object for an item that belongs to one project (a feature) lights the Projects hub.
  function hubOf(route) {
    if (route && typeof route === "object" && ownerOf(route)) return "project";
    if (catalogItem(route)) return "component";
    const item = itemOf(kindOf(route));
    return item ? item.hub : "home";
  }
  // The tab of a hub with tabs that a route (list or item) belongs to, or null.
  function tabOf(route) {
    if (catalogItem(route)) return null;
    const item = itemOf(kindOf(route)), list = listOf(kindOf(route)).kind;
    return item && (item.tabs || []).some((t) => t.kind === list) ? list : null;
  }

  // The project hub's views, carried as ?tab= (overview is the default and never written), and their label keys.
  const PROJECT_TABS = ["overview", "features", "graph", "pipelines", "sessions", "memories"];
  const TAB_KEYS = { overview: "project.tab.overview", features: "project.tab.features", graph: "project.tab.graph",
    pipelines: "project.tab.pipelines", sessions: "project.tab.sessions", memories: "project.tab.memories" };
  function projectTab(route) { const v = route && route.query && route.query.tab; return PROJECT_TABS.includes(v) ? v : "overview"; }
  const projectHash = (name, tab) => routeHash({ kind: "project", id: name, query: tab && tab !== "overview" ? { tab } : {} });
  // An item that lives in one project: an ODD feature ("<project>/<name>"). A graph node ("<repo>::<id>") stays under Knowledge / Graph
  // like the #/node explorer it is opened from (D13).
  function ownerOf(r) {
    const id = String(r.id || ""), cut = r.kind === "feature" ? id.lastIndexOf("/") : -1;
    return cut > 0 ? { project: id.slice(0, cut), rest: id.slice(cut + 1), tab: "features" } : null;
  }
  // Settings: preferences (default, never written), projects and siblings, appearance; carried as ?tab= like the project hub.
  const SETTINGS_TABS = ["preferences", "projects", "appearance"];
  function settingsTab(route) { const v = route && route.query && route.query.tab; return SETTINGS_TABS.includes(v) ? v : "preferences"; }
  const PROJECT_BASE = [{ key: "nav.group.work" }, { key: "nav.project", hash: "#/project" }];
  function projectCrumbs(r) {
    const owner = ownerOf(r);
    if (owner) return [...PROJECT_BASE, { text: owner.project, hash: projectHash(owner.project, owner.tab) }, { text: owner.rest }];
    return [...PROJECT_BASE, { text: r.id }]; // whatever its tab: the tab bar names the tab
  }

  // The trail from the group to the page: [{key | text, hash?}]. List pages stop at their hub, never naming the open tab
  // (the tab bar does); item pages go through the list that shows them (a tab), then the item. Project pages and items
  // of a project (features) go through the project hub (Work / Projects / <project> / <item>).
  function crumbs(route) {
    const r = route || {}, item = itemOf(r.kind);
    if (!item || r.kind === "unknown") return [];
    if (r.kind === "settings") return [{ key: "nav.settings", hash: "#/settings" }]; // a crumb never names the open tab
    if (r.id && (r.kind === "project" || ownerOf(r))) return projectCrumbs(r);
    if (catalogItem(r)) return [{ key: "nav.group.harnessWiki" }, { key: "nav.catalog", hash: "#/component" },
      { key: `catalog.kind.${r.kind}`, hash: routeHash({ kind: "component", id: "", query: { kind: r.kind } }) }, { text: r.id }];
    const out = item.group.foot ? [] : [{ key: item.group.key }];
    if (!r.id) return [...out, { key: item.key, hash: item.hash }];
    const list = listOf(r.kind), tabbed = (item.tabs || []).find((t) => t.kind === list.kind);
    const listHash = list.kind === item.kind && !list.query ? item.hash : routeHash({ kind: list.kind, id: "", query: list.query });
    // An item under a tab of its hub goes hub, tab, item: the hub is the entry the sidebar highlights (T15 A14).
    const trail = tabbed && tabbed.key !== item.key ? [{ key: item.key, hash: item.hash }, { key: tabbed.key, hash: listHash }]
      : [{ key: item.key, hash: listHash }];
    return [...out, ...trail, { text: r.id }];
  }

  // ---- hashes ---------------------------------------------------------------------------------------------------
  // Old hashes keep working: they parse to their new route and redirectOf() names the hash to rewrite them to.
  const LEGACY = { overview: "home", usage: "usage", sessions: "session", memories: "memory", harness: "harness", diagrams: "harness" };
  const ACTIVITY_TABS = { usage: { kind: "usage" }, sessions: { kind: "session" }, tools: { kind: "tool" }, mcp: LIST_OF.mcp };
  const MOVED_LISTS = { diagrams: { kind: "harness" }, mcp: LIST_OF.mcp, skill: LIST_OF.skill,
    themes: { kind: "settings", query: { tab: "appearance" } } }; // list routes folded into another page
  // The Tools and skills segments: hash value -> /api/tools field.
  const SEGMENTS = { skills: "skills", tools: "tools", mcp: "mcp_servers", mcptools: "mcp_tools", subagents: "subagents" };
  const SOURCES = ["engram"]; // stores besides the default one ("own") that a memory page can be read from
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const QUERY = { seg: (v) => own(SEGMENTS, v), kind: (v) => CATALOG_KINDS.includes(v), source: (v) => SOURCES.includes(v),
    tab: (v) => (v !== "overview" && PROJECT_TABS.includes(v)) || (v !== "preferences" && SETTINGS_TABS.includes(v)) };

  function decode(part) {
    try { return decodeURIComponent(part); } catch (_) { return part; }
  }
  function readQuery(text) {
    const out = {};
    for (const pair of String(text || "").split("&")) {
      const [k, v = ""] = pair.split("=");
      if (own(QUERY, k) && QUERY[k](decode(v))) out[k] = decode(v);
    }
    return out;
  }
  const withQuery = (route, query) => (Object.keys(query).length ? { ...route, query } : route);
  const moved = (target, extra) => ({ route: withQuery({ kind: target.kind, id: "" }, { ...target.query, ...extra }), moved: true });

  // -> {route, moved}: `moved` marks a hash that only survives as a redirect.
  function resolve(hash) {
    const full = String(hash || "").replace(/^#/, "");
    const qi = full.startsWith("/") ? full.indexOf("?") : -1;
    const raw = qi < 0 ? full : full.slice(0, qi);
    const query = readQuery(qi < 0 ? "" : full.slice(qi + 1));
    if (raw === "" || raw === "/") return { route: withQuery({ kind: "home", id: "" }, query), moved: false };
    if (!raw.startsWith("/")) return LEGACY[raw] ? moved({ kind: LEGACY[raw] }) : { route: { kind: "unknown", id: raw }, moved: false };
    const [first, ...rest] = raw.slice(1).split("/");
    if (first === "activity") {
      const name = rest.length === 0 ? "usage" : rest.length === 1 ? rest[0] : "";
      const target = own(ACTIVITY_TABS, name) ? ACTIVITY_TABS[name] : null;
      return target ? moved(target) : { route: { kind: "unknown", id: raw }, moved: false };
    }
    if ((rest.length === 0 || first === "diagrams") && own(MOVED_LISTS, first)) return moved(MOVED_LISTS[first], query);
    const NO_ITEMS = ["home", "usage", "harness", "settings", "lint", "security", "pipelines", "component"]; // pages without item pages
    if (!own(KINDS, first) || (rest.length && NO_ITEMS.includes(first))) return { route: { kind: "unknown", id: raw }, moved: false };
    const out = { kind: first, id: rest.length ? decode(rest.join("/")) : "" };
    if (out.id && query.source) out.source = query.source;
    return { route: withQuery(out, query), moved: false };
  }
  // "#/memory/arch%2Fwidgets" -> {kind: "memory", id: "arch/widgets"}; "" -> home; unknown kinds -> {kind: "unknown", id: <raw>}.
  // Known query params (?seg=, ?kind=, ?source=, ?tab=) ride along as route.query; anything else is dropped.
  function parseHash(hash) { return resolve(hash).route; }
  // The hash an old one should be rewritten to (history.replaceState), or null when the hash is current.
  function redirectOf(hash) { const r = resolve(hash); return r.moved ? routeHash(r.route) : null; }

  // The inverse of parseHash: ids are fully percent-encoded so slashes, '#', '?' and '::' survive a round trip. A non-default source rides after '?'.
  function formatHash(kind, id, opts) {
    const base = id ? `#/${kind}/${encodeURIComponent(id)}` : `#/${kind}`;
    return id && opts && SOURCES.includes(opts.source) ? `${base}?source=${opts.source}` : base;
  }
  // A whole route (kind, id, query) as its canonical hash; Home is "#/".
  function routeHash(route) {
    const r = route || {};
    const q = { ...(r.query || {}) };
    if (r.source) q.source = r.source;
    const pairs = Object.keys(QUERY).filter((k) => q[k] && QUERY[k](q[k])).map((k) => `${k}=${encodeURIComponent(q[k])}`);
    const base = r.kind === "home" && !r.id ? "#/" : `#/${r.kind}${r.id ? "/" + encodeURIComponent(r.id) : ""}`;
    return pairs.length ? `${base}?${pairs.join("&")}` : base;
  }
  // The /api/tools field the Tools and skills page shows, from ?seg= (Tools when absent), and the hash of each segment.
  function usageSegment(route) { const seg = route && route.query && route.query.seg; return SEGMENTS[seg] || "tools"; }
  function segmentHash(seg) { return routeHash({ kind: "tool", id: "", query: { seg } }); }

  // ---- number and date formatting (one place, used by every page) ----------------------------------------------
  // Numbers group thousands through Intl (the locale follows the UI language). Dates are ALWAYS YYYY-MM-DD; date-times are
  // YYYY-MM-DD HH:MM on a 24h clock in the viewer's local time. Anything unusable shows "-", never a raw value.
  let LOCALE = "en-US";
  function setLocale(locale) {
    try { LOCALE = new Intl.NumberFormat(String(locale)).resolvedOptions().locale; } catch (_) { /* keep the previous locale */ }
    return LOCALE;
  }
  function fmtNumber(n) {
    if (n == null || n === "" || typeof n === "boolean" || typeof n === "object") return "-";
    const v = Number(n);
    return Number.isFinite(v) ? new Intl.NumberFormat(LOCALE, { useGrouping: "always" }).format(v) : "-";
  }
  // A number with a fixed count of decimals in the UI locale ("1,234.5" or "1.234,5"); a percentage from a ratio (0.125 -> "12.5%" or "12,5 %").
  function fmtDecimal(n, digits) {
    if (n == null || n === "" || typeof n === "boolean" || typeof n === "object") return "-";
    const v = Number(n);
    const d = digits == null ? 1 : digits;
    return Number.isFinite(v) ? new Intl.NumberFormat(LOCALE, { useGrouping: "always", minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : "-";
  }
  function fmtPercent(r, digits = 1) {
    const v = Number(r);
    return r == null || r === "" || typeof r === "boolean" || !Number.isFinite(v) ? "-" : new Intl.NumberFormat(LOCALE, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  }
  const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const ISO_DT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
  const p2 = (n) => String(n).padStart(2, "0");
  function realDate(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  // The Date a value stands for, or null. A naive "YYYY-MM-DD HH:MM" is read as local time, like the browser does for the T form.
  function toDate(v) {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") { const d = new Date(v); return Number.isFinite(v) && !Number.isNaN(d.getTime()) ? d : null; }
    if (typeof v !== "string") return null;
    const m = ISO_DT.exec(v.trim());
    if (!m || !realDate(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || (m[6] && +m[6] > 59)) return null;
    const d = new Date(v.trim().replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(v) {
    if (typeof v === "string") {
      const m = ISO_DATE.exec(v.trim());
      if (m) return realDate(+m[1], +m[2], +m[3]) ? v.trim() : "-"; // a calendar date has no time zone: never shifted
    }
    const d = toDate(v);
    return d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : "-";
  }
  function fmtDateTime(v) {
    if (typeof v === "string" && ISO_DATE.test(v.trim())) return fmtDate(v);
    const d = toDate(v);
    return d ? `${fmtDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : "-";
  }
  // Rewrites a value only when the WHOLE string is an ISO date or date-time; every other value is returned untouched.
  function fmtIso(v) {
    if (typeof v !== "string") return v;
    const t = v.trim();
    if (ISO_DATE.test(t)) return fmtDate(t) === "-" ? v : fmtDate(t);
    if (ISO_DT.test(t)) { const out = fmtDateTime(t); return out === "-" ? v : out; }
    return v;
  }
  // A page-meta or section value: the server marks numbers with fmt "number"; ISO dates are recognised by shape.
  function fmtMeta(m) {
    const v = m && m.value;
    return m && m.fmt === "number" ? fmtNumber(v) : fmtIso(v);
  }
  // Dates and date-times as rendered by fmtDate/fmtDateTime inside any text: splitDates(text) -> [{text, date}] so a page can keep each one in a nowrap span.
  const DATE_TOKEN = /(?<![\d-])\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?(?![\d-])/g;
  function splitDates(text) {
    const s = String(text), out = [];
    let last = 0;
    for (const m of s.matchAll(DATE_TOKEN)) {
      if (m.index > last) out.push({ text: s.slice(last, m.index), date: false });
      out.push({ text: m[0], date: true });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ text: s.slice(last), date: false });
    return out;
  }
  // A file path (absolute, ~/ or ./): shown as mono text that may break only after a slash.
  function isPathLike(v) { return typeof v === "string" && /^(?:\/|~\/|\.{1,2}\/)\S+$/.test(v); }
  // "/a/b" -> ["/", "a", "/", "b"]: the slashes are their own pieces so the page can put a <wbr> after each.
  function pathSegments(v) { return String(v).split(/(\/)/).filter((p) => p !== ""); }
  // One unbroken run of characters (path, id, hash): the only text allowed to break anywhere.
  function isLongToken(v) { return typeof v === "string" && v.length >= 24 && !/\s/.test(v); }

  // Skill catalog filter: a case-insensitive substring over id, description and trigger; groups left empty disappear.
  function filterSkills(groups, query) {
    const q = String(query || "").trim().toLowerCase();
    const out = [];
    for (const g of Array.isArray(groups) ? groups : []) {
      const items = (g.items || []).filter((i) => !q || [i.id, i.description, i.trigger].some((t) => String(t || "").toLowerCase().includes(q)));
      if (items.length) out.push({ ...g, items });
    }
    return out;
  }

  // Component catalog filter: a case-insensitive substring over title, id, description and source; groups left empty disappear.
  function filterComponents(groups, query) {
    const q = String(query || "").trim().toLowerCase();
    const out = [];
    for (const g of Array.isArray(groups) ? groups : []) {
      const items = (g.items || []).filter((i) => !q || [i.title, i.id, i.description, i.source, g.kind].some((t) => String(t || "").toLowerCase().includes(q)));
      if (items.length) out.push({ ...g, items });
    }
    return out;
  }

  // Search groups -> one flat list (keyboard order) with a header marker before each group.
  function flattenResults(groups) {
    const flat = [];
    for (const g of groups || []) for (const item of g.items || []) flat.push({ group: g.kind, count: g.count, kind: item.kind, id: item.id, title: item.title, snippet: item.snippet || null });
    return flat;
  }

  // Graph nodes can match almost any word: their group goes after every other kind and shows at most NODE_SEARCH_CAP items.
  const NODE_SEARCH_CAP = 5;
  function rankResults(groups) {
    const list = Array.isArray(groups) ? groups : [];
    const cap = (g) => ({ ...g, items: (g.items || []).slice(0, NODE_SEARCH_CAP) });
    return [...list.filter((g) => g.kind !== "node"), ...list.filter((g) => g.kind === "node").map(cap)];
  }

  // Wrapping selection for arrow keys over `n` options (-1 = nothing selected yet).
  function moveIndex(index, delta, n) {
    if (n <= 0) return -1;
    if (index < 0) return delta > 0 ? 0 : n - 1;
    return (index + delta + n) % n;
  }

  // Line diff rows from the server: a visible mark (never color alone) and a style name.
  const DIFF = { "+": ["+ ", "add"], "-": ["- ", "del"], " ": ["  ", "same"], "=": ["... ", "gap"] };
  function diffRow(line) {
    const [mark, name] = DIFF[line && line.op] || DIFF[" "];
    return { mark, name, text: String((line && line.text) ?? "") };
  }

  // Done/total for the progress bar of an ODD feature: a whole percent and the text label.
  function progress(done, total) {
    const d = Math.max(0, Number(done) || 0), t = Math.max(0, Number(total) || 0);
    return { percent: t ? Math.min(100, Math.round((d / t) * 100)) : 0, label: `${d} of ${t} done` };
  }

  // Bars for a small per-day chart: [{day, value}] -> [{day, value, x, y, width, height}] inside a W x H box (at least 1px tall when value > 0).
  function dailyBars(daily, W, H) {
    const rows = Array.isArray(daily) ? daily : [];
    const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0));
    const bw = rows.length ? W / rows.length : W;
    return rows.map((r, i) => {
      const v = Math.max(0, Number(r.value) || 0);
      const height = v > 0 ? Math.max(1, (v / max) * H) : 0;
      return { day: String(r.day), value: v, x: i * bw, y: H - height, width: Math.max(bw - 1, 1), height };
    });
  }

  // The Range, Project and Runtime filters belong to the Activity list routes (Usage, Sessions, Tools and skills), never an item.
  function showsFilters(route) {
    const r = route || {};
    return !r.id && r.kind !== "unknown" && hubOf(r.kind) === "usage";
  }

  // Skill impact: direction is always shown as a shape plus words (lower is better for every metric), never by color alone.
  function deltaMark(m) {
    if (!m || m.suppressed || m.delta == null || !m.verdict) return { mark: "–", text: "not enough data", name: "na" };
    if (m.verdict === "no clear difference") return { mark: "■", text: "no clear difference", name: "flat" };
    return m.delta < 0 ? { mark: "▼", text: "lower, better", name: "better" } : { mark: "▲", text: "higher, worse", name: "worse" };
  }
  // The unit words (n/a, tokens, pp) come from the caller so the page can show them in its language; the defaults are English.
  const WORDS = { na: "n/a", tokens: "tokens", pp: "pp" };
  function fmtMetric(name, v, words) {
    const w = { ...WORDS, ...words };
    if (v == null || !Number.isFinite(Number(v))) return w.na;
    return name === "tokens_per_turn" ? `${fmtNumber(Math.round(v))} ${w.tokens}` : fmtPercent(v);
  }
  function fmtDelta(name, d, words) {
    const w = { ...WORDS, ...words };
    if (d == null || !Number.isFinite(Number(d))) return "";
    if (name === "tokens_per_turn") return `${d < 0 ? "-" : "+"}${fmtNumber(Math.abs(Math.round(d)))} ${w.tokens}`;
    return `${d < 0 ? "-" : "+"}${fmtDecimal(Math.abs(d * 100), 1)} ${w.pp}`;
  }

  // Settings editor (pure). `current` and `draft` have the shape of GET /api/settings `current`.
  const SETTING_LABELS = { persona: "Persona", review_mode: "Review mode", telemetry: "Telemetry", privacy: "Privacy hook",
    checks: "Checks" };
  const MODULE_NAMES = ["sdd", "rea", "context7", "impeccable", "archify"];
  function settingsChanges(current, draft) {
    const out = [];
    for (const key of Object.keys(SETTING_LABELS)) if (draft[key] !== current[key]) out.push({ key, label: SETTING_LABELS[key], from: current[key], to: draft[key] });
    for (const name of MODULE_NAMES) if ((draft.modules || {})[name] !== (current.modules || {})[name]) out.push({ key: `module:${name}`, label: `Module ${name}`, from: current.modules[name], to: draft.modules[name] });
    return out;
  }
  // Request body for preview: only what changed (the server keeps every other value), plus repair when asked.
  function settingsBody(current, draft, repair) {
    const body = {};
    const modules = {};
    for (const c of settingsChanges(current, draft)) {
      if (c.key.startsWith("module:")) modules[c.key.slice(7)] = c.to;
      else body[c.key] = c.to;
    }
    if (Object.keys(modules).length) body.modules = modules;
    if (repair) body.repair = true;
    return body;
  }
  // What to tell the person after a failed write: the next step, and whether a fresh preview fixes it.
  // `key` is the i18n key of the same text (the page shows the translated one; `text` is the English reference).
  function settingsAdvice(status) {
    if (status === 403) return { key: "advice.403", text: "The portal refused the request. Reload this page (it gets a new session token) and try again.", again: false };
    if (status === 409) return { key: "advice.409", text: "Something changed since you previewed, or another change is running. Preview again to see the current plan.", again: true };
    if (status === 429) return { key: "advice.429", text: "Too many previews are running at once. Wait a moment and preview again.", again: true };
    if (status === 400) return { key: "advice.400", text: "The preview is no longer valid (used or older than 5 minutes). Preview again.", again: true };
    if (status === 413 || status === 415) return { key: "advice.413", text: "The portal could not accept that request. Reload the page and try again.", again: false };
    if (status === 502 || status === 503 || status === 504) return { key: "advice.502", text: "The installer did not finish. Nothing was reported as changed; run amauta status in a terminal, then try again or run amauta install there.", again: false };
    return { key: "advice.other", text: "Try again. If it keeps failing, run amauta install in a terminal.", again: false };
  }

  globalThis.AmautaRoute = {
    NAV, SEGMENTS, CATALOG_KINDS,
    PROJECT_TABS, TAB_KEYS, projectTab, SETTINGS_TABS, settingsTab, hubOf, tabOf, crumbs, redirectOf, routeHash, usageSegment, segmentHash,
    filterSkills, filterComponents, setLocale, fmtNumber, fmtDecimal, fmtPercent, fmtDate, fmtDateTime, fmtIso,
    fmtMeta, isLongToken, splitDates, isPathLike, pathSegments, showsFilters, settingsChanges, settingsBody, settingsAdvice,
    KINDS, parseHash, formatHash, flattenResults, moveIndex, diffRow, progress, dailyBars, deltaMark, fmtMetric, fmtDelta,
    rankResults, NODE_SEARCH_CAP, NODE_CAP: 30
  };
})();
