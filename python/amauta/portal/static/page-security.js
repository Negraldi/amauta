"use strict";
// Security page (#/security, plan D14): what protects this machine's work, in counts and names, never values.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

const yesNo = (v) => (v ? t("common.yes") : t("common.no"));
const SEC_COLUMNS = {
  checkers: () => [{ key: "name", label: t("sec.checker") }, { key: "installed", label: t("sec.installed"), render: yesNo },
    { key: "needs_trust", label: t("sec.runs"), render: (v) => (v ? t("sec.trustedOnly") : t("sec.always")) }],
  trusted: () => [{ key: "name", label: t("kind.project") }, { key: "path", label: t("sec.path") },
    { key: "since", label: t("sec.since") }],
  selected: () => [{ key: "project", label: t("kind.project") }, { key: "profile", label: t("sec.profile") }],
  redacted: () => [{ key: "kind", label: t("col.kind") }, { key: "n", label: t("sec.count"), num: true }],
};

async function viewSecurity() {
  const r = await api("security");
  const p = r.protections;
  const state = (v) => (v === "on" ? t("common.on") : t("common.off"));
  const redacted = Object.entries(r.redacted).map(([kind, n]) => ({ kind, n }));
  const pr = r.profiles;
  const drafts = pr.drafts ? ` ${tn("sec.drafts", pr.drafts, { n: fmt(pr.drafts) })}` : null;
  const trusted = r.trusted.length ? table("sec-trusted", SEC_COLUMNS.trusted(), r.trusted) : empty(codeSpans(t("sec.noTrusted")));
  return [
    pageHead(t("nav.security"), t("sec.lead", { privacy: state(p.privacy), checks: state(p.checks) })),
    p.installed ? null : h("p", { class: "notice" }, t("set.notInstalled")),
    panel(t("sec.checkers"), h("p", { class: "muted" }, t("sec.checkersHelp")), table("sec-checkers", SEC_COLUMNS.checkers(), r.checkers)),
    panel(t("sec.trusted"), trusted),
    panel(t("sec.profiles"), h("p", null, `${pr.names.join(", ")}.`, drafts),
      pr.selected.length ? table("sec-profiles", SEC_COLUMNS.selected(), pr.selected) : empty(t("sec.noSelection"))),
    panel(t("sec.redacted"), h("p", { class: "muted" }, t("sec.redactedHelp")),
      redacted.length ? table("sec-redacted", SEC_COLUMNS.redacted(), redacted) : empty(t("sec.noRedactions"))),
  ].filter(Boolean);
}
