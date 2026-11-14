"use strict";
// Security page (#/security, plan D14): what protects this machine's work, in counts and names, never values.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

const yesNo = (v) => stateChip(v, v ? t("common.yes") : t("common.no")); // the Harness wiki chip vocabulary (page-harness.js)
const SEC_COLUMNS = {
  checkers: () => [{ key: "name", label: t("sec.checker") }, { key: "installed", label: t("sec.installed"), render: yesNo },
    { key: "needs_trust", label: t("sec.runs"), render: (v) => (v ? t("sec.trustedOnly") : t("sec.always")) }],
  trusted: () => [{ key: "name", label: t("kind.project") }, { key: "path", label: t("sec.path") },
    { key: "since", label: t("sec.since") }],
  selected: () => [{ key: "project", label: t("kind.project") }, { key: "profile", label: t("sec.profile") }],
  redacted: () => [{ key: "kind", label: t("col.kind"), render: (v) => enumLabel("redact", v) },
    { key: "n", label: t("sec.count"), num: true }],
};

const PROTECTIONS = [["memory_guard", "sec.memoryGuard"], ["privacy", "sec.privacy"], ["checks", "sec.checks"]];
// One sentence first: how many protections are on and how many checkers were found; then one chip per protection.
function securitySummary(r) {
  const on = PROTECTIONS.filter(([k]) => r.protections[k] === "on").length;
  const found = r.checkers.filter((c) => c.installed).length;
  return t("sec.summary", { on: fmt(on), total: fmt(PROTECTIONS.length), found: fmt(found), checkers: fmt(r.checkers.length) });
}
// The three protections side by side for the two runtimes (T15 E12): the state of each, and where Codex does less and why.
const RUNTIME_ROWS = [["memory_guard", "sec.memoryGuard", "sec.note.memory", "sec.note.memory"],
  ["privacy", "sec.privacy", "sec.note.privacy.claude", "sec.note.privacy.codex"],
  ["checks", "sec.checks", "sec.note.checks.claude", "sec.note.checks.codex"]];
function runtimeCell(on, note) {
  return h("td", null, stateChip(on, t(on ? "common.on" : "common.off")), h("div", { class: "muted" }, t(note)));
}
function runtimesPanel(r) {
  const p = r.protections, c = r.codex && r.codex.found && r.codex.installed ? r.codex : null;
  const codexCell = (key, note) => (c ? runtimeCell((key === "memory_guard" ? "on" : c[key]) === "on", note)
    : h("td", { class: "muted" }, t("sec.notThere")));
  const rows = RUNTIME_ROWS.map(([key, label, claudeNote, codexNote]) => h("tr", null, h("th", { scope: "row" }, t(label)),
    runtimeCell(p[key] === "on", claudeNote), codexCell(key, codexNote)));
  const head = h("tr", null, [t("sec.protection"), t("runtime.claude"), t("runtime.codex")].map((x) => h("th", null, x)));
  const why = !r.codex || !r.codex.found ? t("sec.noCodex") : !r.codex.installed ? t("sec.codexNotInstalled") : t("sec.why");
  const grid = scrollBox(h("table", null, h("thead", null, head), h("tbody", null, rows)));
  return panel(t("sec.byRuntime"), grid, h("p", { class: "muted" }, why));
}

async function viewSecurity() {
  const r = await api("security");
  const p = r.protections;
  const redacted = Object.entries(r.redacted).map(([kind, n]) => ({ kind, n }));
  const pr = r.profiles;
  const drafts = pr.drafts ? ` ${tn("sec.drafts", pr.drafts, { n: fmt(pr.drafts) })}` : null;
  for (const [id, key] of [["sec-checkers", "name"], ["sec-trusted", "name"], ["sec-profiles", "project"]]) sortOnce(id, key, 1); // A to Z
  const trusted = r.trusted.length ? table("sec-trusted", SEC_COLUMNS.trusted(), r.trusted) : empty(codeSpans(t("sec.noTrusted")));
  return [
    pageHead(t("nav.security"), securitySummary(r)), h("p", { class: "muted" }, t("sec.lead")),
    p.installed ? null : h("p", { class: "notice" }, t("set.notInstalled")),
    runtimesPanel(r),
    panel(t("sec.checkers"), h("p", { class: "muted" }, t("sec.checkersHelp")), table("sec-checkers", SEC_COLUMNS.checkers(), r.checkers)),
    panel(t("sec.trusted"), trusted),
    panel(t("sec.profiles"), h("p", null, `${pr.names.join(", ")}.`, drafts),
      pr.selected.length ? table("sec-profiles", SEC_COLUMNS.selected(), pr.selected) : empty(t("sec.noSelection"))),
    panel(t("sec.redacted"), h("p", { class: "muted" }, t("sec.redactedHelp")),
      redacted.length ? table("sec-redacted", SEC_COLUMNS.redacted(), redacted) : empty(t("sec.noRedactions"))),
  ].filter(Boolean);
}
