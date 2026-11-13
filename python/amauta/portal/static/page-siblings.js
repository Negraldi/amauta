"use strict";
// Sibling projects (plan S1d, ADR 0001): projects beside amauta that the portal only links and health-checks, never
// runs. A card on the Projects page per sibling (last commit, uncommitted changes, its MCP server in Claude and Codex,
// the age of a watched file) and a table and form under Settings > Projects and siblings that edit portal.json `siblings`.
// Text only, never markup.
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
    h("div", { class: "pipe-cards sib-cards" }, d.siblings.map(siblingCard)));
}

// ---- Settings > Projects and siblings: saved project paths, auto-discover and the sibling table -----------------------
// Both sections share one `store` (the /api/projects answer) so a change in one is never overwritten by the other.
// One guarded POST to the projects config (a closed schema, validated by the server); the answer replaces the store.
async function saveConfig(store, body, out, repaint) {
  out.replaceChildren(h("p", { role: "status", class: "muted" }, t("common.saving")));
  let res;
  try { res = await postJson("/api/projects/config", body); } catch (err) {
    res = { ok: false, status: 0, data: { error: String(err.message || err) } };
  }
  if (!res.ok) {
    const reason = res.data && res.data.error ? ts(res.data.error) : t("common.requestFailed", { status: res.status });
    const advice = h("p", null, t(R.settingsAdvice(res.status).key));
    out.replaceChildren(h("div", { class: "notice warn", role: "alert" }, `▲ ${reason}`, advice));
    return;
  }
  store.data = res.data;
  repaint();
  out.replaceChildren(h("p", { role: "status" }, "✓ " + t("common.saved")));
}

// The paths saved in portal.json and the auto-discover switch.
function projectsSection(store) {
  const root = h("section", { class: "projects" }), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const send = (body) => saveConfig(store, body, out, paint);
  function paint() {
    const data = store.data;
    const input = h("input", { type: "text", id: "project-path", placeholder: "/home/you/code/my-project",
      autocomplete: "off", spellcheck: "false" });
    const add = h("button", { type: "button" }, t("sp.add"));
    add.addEventListener("click", () => { const v = String(input.value || "").trim(); if (v) send({ repos: [...data.config_repos, v] }); });
    const box = h("input", { type: "checkbox", id: "project-auto", checked: data.auto_discover });
    box.addEventListener("change", (e) => send({ auto_discover: !!e.target.checked }));
    const only = (p) => p.origin.includes("discovered") && !p.origin.includes("config") && !p.origin.includes("flag");
    const found = data.projects.filter(only);
    const remove = (p) => {
      const b = h("button", { type: "button", "aria-label": t("sp.remove", { path: p }) }, t("common.remove"));
      b.addEventListener("click", () => send({ repos: data.config_repos.filter((x) => x !== p) }));
      return h("li", null, h("code", { class: "tok" }, p), " ", b);
    };
    root.replaceChildren(h("h2", null, t("nav.project")), h("p", { class: "muted" }, t("sp.intro")),
      data.config_repos.length ? h("ul", { class: "plain-list" }, data.config_repos.map(remove)) : h("p", { class: "muted" }, t("sp.none")),
      h("div", { class: "actions" }, h("label", { for: "project-path" }, t("sp.addPath")), input, add),
      h("label", { class: "check", for: "project-auto" }, box, t("sp.auto")),
      h("div", null, found.length ? h("p", { class: "muted" }, t("sp.found", { names: found.map((p) => p.name).join(", ") })) : null));
  }
  paint();
  return h("div", null, root, out);
}

// The siblings: a table with Remove, a teaching empty state, and the form that adds one.
function siblingsSection(store) {
  const root = h("section", { class: "projects" }), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const send = (list) => saveConfig(store, { siblings: list }, out, paint);
  const field = (id, label, placeholder) => [h("label", { for: id }, label),
    h("input", { type: "text", id, placeholder, autocomplete: "off", spellcheck: "false" })];
  function paint() {
    const list = store.data.siblings || [];
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
    const remove = (_v, s) => {
      const b = h("button", { type: "button", "aria-label": t("sib.remove", { name: s.name }) }, t("common.remove"));
      b.addEventListener("click", () => send(list.filter((x) => x !== s)));
      return b;
    };
    const text = (v) => v || "-";
    const watched = (v, s) => (v && s.max_age_days ? tn("sib.watchMax", s.max_age_days, { file: v, n: fmt(s.max_age_days) }) : text(v));
    const columns = [{ key: "name", label: t("sib.name"), render: text },
      { key: "path", label: t("sib.path"), render: (v) => h("code", { class: "tok" }, v) },
      { key: "mcp", label: t("sib.col.mcp"), render: text }, { key: "watch", label: t("sib.col.watch"), render: watched },
      { key: "remove", label: t("sib.col.actions"), render: remove }];
    root.replaceChildren(h("h2", null, t("sib.title")), h("p", { class: "muted" }, t("sib.settingsLead")),
      list.length ? table("siblings", columns, list) : h("p", { class: "teach" }, t("sib.empty")),
      h("div", { class: "sibling-form" }, fields.flat(), add));
  }
  paint();
  return h("div", null, root, out);
}

// The tab body: one fetch feeds both sections; a failure reaches the tab's error panel (with Retry).
async function projectsTab() {
  const store = { data: await api("projects") };
  return [projectsSection(store), siblingsSection(store)];
}
