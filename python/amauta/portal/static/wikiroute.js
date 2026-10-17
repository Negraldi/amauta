"use strict";
// Pure helpers for the wiki shell (no DOM): hash routing and the search palette's list handling.
(function () {
  // kind -> label shown in the sidebar and as the page's kind label
  const KINDS = {
    home: "Home", memory: "Memory", skill: "Skill", tool: "Tool", mcp: "MCP server", session: "Session", feature: "ODD feature",
    node: "Graph node", harness: "Harness", usage: "Usage", settings: "Settings", diagrams: "Diagrams", lint: "Lint",
  };
  // Hashes of the previous tabbed portal keep working.
  const LEGACY = { overview: "home", usage: "usage", sessions: "session", memories: "memory", harness: "harness", diagrams: "diagrams" };

  function decode(part) {
    try { return decodeURIComponent(part); } catch (_) { return part; }
  }

  // "#/memory/arch%2Fwidgets" -> {kind: "memory", id: "arch/widgets"}; "" -> home; unknown kinds -> {kind: "unknown", id: <raw>}.
  function parseHash(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    if (raw === "" || raw === "/") return { kind: "home", id: "" };
    if (!raw.startsWith("/")) return LEGACY[raw] ? { kind: LEGACY[raw], id: "" } : { kind: "unknown", id: raw };
    const [kind, ...rest] = raw.slice(1).split("/");
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) return { kind: "unknown", id: raw };
    return { kind, id: rest.length ? decode(rest.join("/")) : "" };
  }

  // The inverse of parseHash: ids are fully percent-encoded so slashes, '#', '?' and '::' survive a round trip.
  function formatHash(kind, id) {
    return id ? `#/${kind}/${encodeURIComponent(id)}` : `#/${kind}`;
  }


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
    return Number.isFinite(v) ? new Intl.NumberFormat(LOCALE).format(v) : "-";
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
  // One unbroken run of characters (path, id, hash): the only text allowed to break anywhere.
  function isLongToken(v) { return typeof v === "string" && v.length >= 24 && !/\s/.test(v); }

  // Search groups -> one flat list (keyboard order) with a header marker before each group.
  function flattenResults(groups) {
    const flat = [];
    for (const g of groups || []) for (const item of g.items || []) flat.push({ group: g.kind, count: g.count, kind: item.kind, id: item.id, title: item.title, snippet: item.snippet || null });
    return flat;
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

  // The Range and Project filters belong to the usage views: Usage itself and the list routes that read them (never a single page).
  const FILTERED_LISTS = ["session", "skill", "tool", "mcp"];
  function showsFilters(route) {
    const r = route || {};
    return r.kind === "usage" || (FILTERED_LISTS.includes(r.kind) && !r.id);
  }

  // Skill impact: direction is always shown as a shape plus words (lower is better for every metric), never by color alone.
  function deltaMark(m) {
    if (!m || m.suppressed || m.delta == null || !m.verdict) return { mark: "–", text: "not enough data", name: "na" };
    if (m.verdict === "no clear difference") return { mark: "■", text: "no clear difference", name: "flat" };
    return m.delta < 0 ? { mark: "▼", text: "lower, better", name: "better" } : { mark: "▲", text: "higher, worse", name: "worse" };
  }
  function fmtMetric(name, v) {
    if (v == null || !Number.isFinite(Number(v))) return "n/a";
    return name === "tokens_per_turn" ? `${Math.round(v)} tokens` : `${(v * 100).toFixed(1)}%`;
  }
  function fmtDelta(name, d) {
    if (d == null || !Number.isFinite(Number(d))) return "";
    if (name === "tokens_per_turn") return `${d < 0 ? "-" : "+"}${Math.abs(Math.round(d))} tokens`;
    return `${d < 0 ? "-" : "+"}${Math.abs(d * 100).toFixed(1)} pp`;
  }

  // Settings editor (pure). `current` and `draft` have the shape of GET /api/settings `current`.
  const SETTING_LABELS = { persona: "Persona", review_mode: "Review mode", telemetry: "Telemetry" };
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
  function settingsAdvice(status) {
    if (status === 403) return { text: "The portal refused the request. Reload this page (it gets a new session token) and try again.", again: false };
    if (status === 409) return { text: "Something changed since you previewed, or another change is running. Preview again to see the current plan.", again: true };
    if (status === 429) return { text: "Too many previews are running at once. Wait a moment and preview again.", again: true };
    if (status === 400) return { text: "The preview is no longer valid (used or older than 5 minutes). Preview again.", again: true };
    if (status === 413 || status === 415) return { text: "The portal could not accept that request. Reload the page and try again.", again: false };
    if (status === 502 || status === 503 || status === 504) return { text: "The installer did not finish. Nothing was reported as changed; run amauta status in a terminal, then try again or run amauta install there.", again: false };
    return { text: "Try again. If it keeps failing, run amauta install in a terminal.", again: false };
  }

  globalThis.AmautaRoute = { setLocale, fmtNumber, fmtDate, fmtDateTime, fmtIso, fmtMeta, isLongToken, showsFilters, settingsChanges, settingsBody, settingsAdvice, KINDS, parseHash, formatHash, flattenResults, moveIndex, diffRow, progress, dailyBars, deltaMark, fmtMetric, fmtDelta, NODE_CAP: 30 };
})();
