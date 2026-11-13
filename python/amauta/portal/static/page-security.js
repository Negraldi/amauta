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
const protectionChip = (p) => ([k, key]) => stateChip(p[k] === "on", t(p[k] === "on" ? "sec.chipOn" : "sec.chipOff", { name: t(key) }));
const protectionChips = (p) => h("p", { class: "chips" }, PROTECTIONS.map(protectionChip(p)));

// The Codex side (T10): the same two switches from its own install, and what they do differently there.
function codexPanel(c) {
  if (!c || !c.found) return h("p", { class: "muted" }, t("sec.noCodex"));
  const word = (v) => t(v === "on" ? "common.on" : "common.off");
  return panel(t("sec.codex"), c.installed ? h("p", null, t("sec.codexLine", { privacy: word(c.privacy), checks: word(c.checks) }))
    : h("p", null, t("sec.codexNotInstalled")), h("p", { class: "muted" }, t("sec.codexNote")));
}

async function viewSecurity() {
  const r = await api("security");
  const p = r.protections;
  const redacted = Object.entries(r.redacted).map(([kind, n]) => ({ kind, n }));
  const pr = r.profiles;
  const drafts = pr.drafts ? ` ${tn("sec.drafts", pr.drafts, { n: fmt(pr.drafts) })}` : null;
  const trusted = r.trusted.length ? table("sec-trusted", SEC_COLUMNS.trusted(), r.trusted) : empty(codeSpans(t("sec.noTrusted")));
  return [
    pageHead(t("nav.security"), securitySummary(r)), protectionChips(p), h("p", { class: "muted" }, t("sec.lead")),
    p.installed ? null : h("p", { class: "notice" }, t("set.notInstalled")),
    codexPanel(r.codex),
    panel(t("sec.checkers"), h("p", { class: "muted" }, t("sec.checkersHelp")), table("sec-checkers", SEC_COLUMNS.checkers(), r.checkers)),
    panel(t("sec.trusted"), trusted),
    panel(t("sec.profiles"), h("p", null, `${pr.names.join(", ")}.`, drafts),
      pr.selected.length ? table("sec-profiles", SEC_COLUMNS.selected(), pr.selected) : empty(t("sec.noSelection"))),
    panel(t("sec.redacted"), h("p", { class: "muted" }, t("sec.redactedHelp")),
      redacted.length ? table("sec-redacted", SEC_COLUMNS.redacted(), redacted) : empty(t("sec.noRedactions"))),
  ].filter(Boolean);
}
