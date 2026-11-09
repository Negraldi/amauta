"use strict";
// Sibling projects (plan S1d, ADR 0001): projects beside amauta that the portal only links and health-checks, never
// runs. A card on the Projects page per sibling (last commit, uncommitted changes, its MCP server in Claude and Codex,
// the age of a watched file) and a form under Settings that edits portal.json `siblings`. Text only, never markup.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

const SIB_MARK = { ok: "✓", attention: "▲", missing: "✗" };
const sibMark = (v) => (v ? "✓" : "✗");

function siblingCard(s) {
  const lines = [];
  if (!s.exists) lines.push(h("p", { class: "warn" }, t("sib.missing", { path: s.path })));
  if (s.exists && !s.git) lines.push(h("p", { class: "muted" }, t("sib.noGit")));
  if (s.git) {
    lines.push(h("p", null, t("sib.commit", { at: R.fmtDateTime(s.git.date), subject: s.git.subject })));
    if (s.git.dirty) lines.push(h("p", { class: "warn" }, `▲ ${tn("sib.dirty", s.git.dirty, { n: fmt(s.git.dirty) })}`));
  }
  if (s.mcp) {
    const off = !s.mcp.claude && !s.mcp.codex;
    const text = t("sib.mcp", { name: s.mcp.name, claude: sibMark(s.mcp.claude), codex: sibMark(s.mcp.codex) });
    lines.push(h("p", { class: off ? "warn" : null }, text));
  }
  if (s.watch) {
    const w = s.watch;
    const text = w.state === "missing" ? t("sib.watchMissing", { file: w.file })
      : w.max_age_days ? t("sib.watchLimit", { file: w.file, age: fmt(w.age_days), max: fmt(w.max_age_days) })
        : t("sib.watch", { file: w.file, age: fmt(w.age_days) });
    lines.push(h("p", { class: w.state === "ok" ? null : "warn" }, `${w.state === "ok" ? "" : "▲ "}${text}`));
  }
  return h("article", { class: "pipe-card", "data-state": s.state },
    h("h3", null, `${SIB_MARK[s.state] || "?"} ${s.name}`), h("p", { class: "muted tok" }, s.path), ...lines);
}

// The Projects page block; null when no sibling is configured or the portal cannot tell.
async function siblingsBlock() {
  let d;
  try { d = await api("siblings"); } catch (_) { return null; }
  if (!d.siblings || !d.siblings.length) return null;
  return h("section", { class: "page-section" }, h("h2", null, t("sib.title")), h("p", { class: "muted" }, t("sib.lead")),
    h("div", { class: "pipe-cards" }, d.siblings.map(siblingCard)));
}

// Settings: the list with Remove, and a form that adds one. Saved through the projects config (a closed schema).
async function siblingsSection() {
  let data;
  try { data = await api("projects"); } catch (_) { return null; }
  const root = h("section", { class: "projects" }), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const send = async (list) => {
    out.replaceChildren(h("p", { role: "status", class: "muted" }, t("common.saving")));
    const failed = (e) => ({ ok: false, data: { error: e.message } });
    const res = await postJson("/api/projects/config", { siblings: list }).catch(failed);
    if (!res.ok) { out.replaceChildren(h("p", { class: "warn", role: "alert" }, `▲ ${ts((res.data && res.data.error) || "")}`)); return; }
    data = res.data;
    paint();
    out.replaceChildren(h("p", { role: "status" }, "✓ " + t("common.saved")));
  };
  const field = (id, label, placeholder) => [h("label", { for: id }, label),
    h("input", { type: "text", id, placeholder, autocomplete: "off", spellcheck: "false" })];
  const paint = () => {
    const list = data.siblings || [];
    const fields = [field("sibling-name", t("sib.name"), ""), field("sibling-path", t("sib.path"), "/home/you/code/catalog"),
      field("sibling-mcp", t("sib.mcpLabel"), "oga-catalog"), field("sibling-watch", t("sib.watchLabel"), "cuts/ACTIVE"),
      field("sibling-age", t("sib.ageLabel"), "35")];
    const value = (i) => String(fields[i][1].value || "").trim();
    const add = h("button", { type: "button" }, t("sib.add"));
    add.addEventListener("click", () => {
      if (!value(0) || !value(1)) return;
      const entry = { name: value(0), path: value(1), ...(value(2) ? { mcp: value(2) } : {}), ...(value(3) ? { watch: value(3) } : {}),
        ...(value(4) ? { max_age_days: Number(value(4)) } : {}) };
      send([...list, entry]);
    });
    const remove = (s) => {
      const b = h("button", { type: "button", "aria-label": t("sib.remove", { name: s.name }) }, t("common.remove"));
      b.addEventListener("click", () => send(list.filter((x) => x !== s)));
      return h("li", null, h("strong", null, s.name), " ", h("code", { class: "tok" }, s.path), " ", b);
    };
    root.replaceChildren(h("h2", null, t("sib.title")), h("p", { class: "muted" }, t("sib.settingsLead")),
      list.length ? h("ul", { class: "plain-list" }, list.map(remove)) : h("p", { class: "muted" }, t("sib.none")),
      h("div", { class: "sibling-form" }, fields.flat(), add));
  };
  paint();
  return h("div", null, root, out);
}
