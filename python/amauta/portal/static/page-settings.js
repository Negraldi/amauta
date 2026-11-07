"use strict";
// Settings editor: a closed list of options, preview -> confirm -> apply, with undo (#/settings).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

// ---- Settings editor: a closed list of options, always preview -> confirm -> apply, with undo ----------------------------------------
// Labels and help are i18n keys (resolved with t() when the page is built).
const SETTING_OPTIONS = [
  ["persona", "set.persona", [["gentleman", "set.gentleman"], ["neutral", "set.neutral"]], "set.persona.help"],
  ["review_mode", "set.review", [["off", "set.off"], ["on", "set.on"]], "set.review.help"],
  ["telemetry", "set.telemetry", [["on", "set.on"], ["off", "set.off"]], "set.telemetry.help"],
];
const SETTING_MODULES = [
  ["sdd", "set.mod.sdd", "set.mod.sdd.help"],
  ["rea", "set.mod.rea", "set.mod.rea.help"],
  ["context7", "set.mod.context7", "set.mod.context7.help"],
  ["impeccable", "set.mod.impeccable", "set.mod.impeccable.help"],
  ["archify", "set.mod.archify", "set.mod.archify.help"],
];
const valueLabel = (v) => (v === "on" ? t("common.on") : v === "off" ? t("common.off") : v);
const setDisabled = (el, on) => { if (on) el.setAttribute("disabled", ""); else el.removeAttribute("disabled"); };

async function postJson(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Portal-Token": token, Accept: "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function planBlock(res) {
  const p = res.plan || {}, files = p.files || [], removed = p.removed || [], skipped = p.skipped || [];
  const list = (title, items) => items.length ? h("details", null, h("summary", null, `${title} (${fmt(items.length)})`), h("ul", { class: "plain-list" }, items.slice(0, 40).map((f) => h("li", null, h("code", null, f))), items.length > 40 ? h("li", { class: "muted" }, t("plan.more", { n: fmt(items.length - 40) })) : null)) : null;
  return h("div", { class: "plan" },
    res.changes.length ? h("ul", { class: "plain-list" }, res.changes.map((c) => h("li", null, `${settingLabel(c.key)}: ${valueLabel(c.from)} → ${valueLabel(c.to)}`)))
      : h("p", null, res.repair ? t("plan.noChangesRepair") : t("plan.noChanges")),
    h("p", null, t("plan.counts", { written: fmt(files.length), removed: fmt(removed.length), kept: fmt(skipped.length) })),
    p.changed === false ? h("p", { class: "muted" }, t("plan.inPlace")) : null,
    p.impeccable && p.impeccable.engine === "would-install" ? h("p", null, t("plan.npm")) : null,
    list(t("plan.filesWritten"), files), list(t("plan.filesRemoved"), removed), list(t("plan.kept"), skipped));
}
function settingLabel(key) {
  if (key.startsWith("module:")) return t("set.moduleN", { name: key.slice(7) });
  return { persona: t("set.persona"), review_mode: t("set.review"), telemetry: t("set.telemetry") }[key] || key;
}

// Settings > Projects: the paths saved in portal.json and the auto-discover switch. Every change is one guarded POST; the server validates the paths.
async function projectsSection() {
  let data;
  try { data = await api("projects"); } catch (_) { return null; }
  const root = h("section", { class: "projects" }), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const send = async (body) => {
    out.replaceChildren(h("p", { role: "status", class: "muted" }, t("common.saving")));
    let res;
    try { res = await postJson("/api/projects/config", body); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) { out.replaceChildren(h("div", { class: "notice warn", role: "alert" }, `▲ ${res.data && res.data.error ? ts(res.data.error) : t("common.requestFailed", { status: res.status })}`, h("p", null, t(R.settingsAdvice(res.status).key)))); return; }
    data = res.data;
    paint();
    out.replaceChildren(h("p", { role: "status" }, "✓ " + t("common.saved")));
  };
  const paint = () => {
    const input = h("input", { type: "text", id: "project-path", placeholder: "/home/you/code/my-project", "aria-label": t("sp.pathLabel"), autocomplete: "off", spellcheck: "false" });
    const add = h("button", { type: "button" }, t("sp.add"));
    add.addEventListener("click", () => { const v = String(input.value || "").trim(); if (v) send({ repos: [...data.config_repos, v] }); });
    const box = h("input", { type: "checkbox", id: "project-auto", checked: data.auto_discover });
    box.addEventListener("change", (e) => send({ auto_discover: !!e.target.checked }));
    const found = data.projects.filter((p) => p.origin.includes("discovered") && !p.origin.includes("config") && !p.origin.includes("flag"));
    root.replaceChildren(h("h2", null, t("nav.project")),
      h("p", { class: "muted" }, t("sp.intro")),
      data.config_repos.length ? h("ul", { class: "plain-list" }, data.config_repos.map((p) => { const b = h("button", { type: "button" }, t("common.remove")); b.addEventListener("click", () => send({ repos: data.config_repos.filter((x) => x !== p) })); return h("li", null, h("code", { class: "tok" }, p), " ", b); })) : h("p", { class: "muted" }, t("sp.none")),
      h("div", { class: "actions" }, h("label", { for: "project-path" }, t("sp.addPath")), input, add),
      h("p", null, box, h("label", { for: "project-auto" }, " " + t("sp.auto"))),
      h("div", null, found.length ? h("p", { class: "muted" }, t("sp.found", { names: found.map((p) => p.name).join(", ") })) : null)); // replaceChildren(null) would write the text "null" in a browser
  };
  paint();
  return h("div", null, root, out);
}

async function viewSettings() {
  let info = await api("settings");
  let draft = null;
  const root = h("div", { class: "settings" });
  const formBox = h("div", null), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const marks = new Map();
  let previewBtn = null, repairBtn = null;
  const copy = (c) => ({ ...c, modules: { ...c.modules } });

  const refreshMarks = () => {
    const changes = R.settingsChanges(info.current, draft);
    for (const [key, el] of marks) { const c = changes.find((x) => x.key === key); el.textContent = c ? "◆ " + t("set.changed", { from: valueLabel(c.from) }) : ""; }
    if (previewBtn) setDisabled(previewBtn, changes.length === 0);
  };
  const option = (key, id, label, choices, value, help) => {
    const mark = h("span", { class: "changed" });
    marks.set(key, mark);
    const select = h("select", { id, "aria-describedby": `${id}-help` }, choices.map(([v, l]) => h("option", { value: v, selected: v === value }, t(l))));
    select.value = value;
    select.addEventListener("change", (e) => {
      const v = e.target.value;
      if (key.startsWith("module:")) draft.modules[key.slice(7)] = v; else draft[key] = v;
      refreshMarks();
    });
    return h("div", { class: "option" }, h("label", { for: id }, t(label)), select, h("span", { class: "current" }, t("set.now", { value: valueLabel(value) })), mark, h("p", { id: `${id}-help`, class: "option-help muted" }, t(help)));
  };
  const buildForm = () => {
    draft = copy(info.current);
    marks.clear();
    previewBtn = h("button", { type: "button", disabled: true }, t("set.preview"));
    previewBtn.addEventListener("click", () => runPreview(false));
    repairBtn = h("button", { type: "button" }, t("set.previewRepair"));
    repairBtn.addEventListener("click", () => runPreview(true));
    formBox.replaceChildren(...[
      info.installed ? null : h("p", { class: "notice" }, t("set.notInstalled")),
      h("div", { class: "options" },
        ...SETTING_OPTIONS.map(([key, label, choices, help]) => option(key, `set-${key.replace("_", "-")}`, label, choices, info.current[key], help)),
        h("h2", null, t("set.modules")),
        ...SETTING_MODULES.map(([name, label, help]) => option(`module:${name}`, `set-module-${name}`, label, [["off", "set.off"], ["on", "set.on"]], info.current.modules[name], help))),
      h("div", { class: "actions" }, previewBtn),
      h("section", { class: "repair" }, h("h2", null, t("set.repairTitle")),
        h("p", { class: "muted" }, t("set.repairHelp")), h("div", { class: "actions" }, repairBtn))].filter(Boolean));
    refreshMarks();
  };

  const busy = (key) => { out.replaceChildren(h("p", { role: "status", class: "muted" }, t(key))); };
  const fail = (res, retry) => {
    const adv = R.settingsAdvice(res.status);
    out.replaceChildren(h("div", { class: "notice warn", role: "alert" }, h("p", null, `▲ ${res.data && res.data.error ? ts(res.data.error) : t("common.requestFailed", { status: res.status })}`),
      res.data && res.data.detail ? h("p", { class: "muted" }, h("code", null, res.data.detail)) : null, h("p", null, t(adv.key)),
      adv.again ? (() => { const b = h("button", { type: "button" }, t("set.previewAgain")); b.addEventListener("click", () => retry()); return b; })() : null));
  };
  const askConfirm = (text, yes, onYes, onNo) => {
    const ok = h("button", { type: "button", class: "primary" }, yes), no = h("button", { type: "button" }, t("common.goBack"));
    ok.addEventListener("click", onYes); no.addEventListener("click", onNo);
    return h("div", { class: "confirm", role: "group", "aria-label": t("common.confirm") }, h("p", null, text), h("div", { class: "actions" }, ok, no));
  };

  async function runPreview(repair) {
    const body = R.settingsBody(info.current, draft, repair);
    setDisabled(previewBtn, true); setDisabled(repairBtn, true);
    busy("set.checking");
    let res;
    try { res = await postJson("/api/settings/preview", body); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    setDisabled(repairBtn, false); refreshMarks();
    if (!res.ok) return fail(res, () => runPreview(repair));
    showPlan(res.data, repair);
  }
  function showPlan(plan, repair) {
    const confirmBox = h("div", null);
    const apply = h("button", { type: "button", class: "primary" }, t("set.apply"));
    apply.addEventListener("click", () => {
      setDisabled(apply, true);
      confirmBox.replaceChildren(askConfirm(t("set.applyConfirm"), t("set.applyYes"), () => runApply(plan), () => { setDisabled(apply, false); confirmBox.replaceChildren(); }));
    });
    const cancel = h("button", { type: "button" }, t("set.discard"));
    cancel.addEventListener("click", () => out.replaceChildren());
    out.replaceChildren(h("section", { class: "panel" }, h("h2", null, t("set.previewTitle")), planBlock(plan), h("p", { class: "muted" }, t("set.validFor", { n: fmt(Math.round((plan.expires_in || 300) / 60)) })), h("div", { class: "actions" }, apply, cancel), confirmBox));
  }
  async function runApply(plan) {
    busy("set.applying");
    let res;
    try { res = await postJson("/api/settings/apply", { apply_token: plan.apply_token, confirm: true }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runPreview(false));
    const d = res.data;
    const undo = d.undo_available ? h("button", { type: "button" }, t("set.undo")) : null;
    if (undo) undo.addEventListener("click", () => { setDisabled(undo, true); runUndoPreview(); });
    out.replaceChildren(h("section", { class: "panel", role: "status" }, h("h2", null, t("set.applied")),
      h("p", null, "✓ " + t("set.written", { files: fmt(d.files.length), removed: fmt(d.removed.length) })), d.backup ? h("p", null, t("set.backup", { id: d.backup })) : h("p", { class: "muted" }, t("set.noBackup")),
      d.skipped.length ? h("p", { class: "muted" }, t("set.keptEdited", { n: fmt(d.skipped.length) })) : null,
      d.impeccable && d.impeccable.engine === "failed" ? h("p", { class: "warn" }, "▲ " + t("set.engineFailed", { detail: d.impeccable.detail || t("set.npmFailed") })) : null,
      h("div", { class: "actions" }, undo)));
    await reload();
  }
  async function runUndoPreview() {
    busy("set.checkingUndo");
    let res;
    try { res = await postJson("/api/settings/undo/preview", {}); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runUndoPreview());
    const plan = res.data, confirmBox = h("div", null);
    const revert = h("button", { type: "button", class: "primary" }, t("set.revert"));
    revert.addEventListener("click", () => {
      setDisabled(revert, true);
      confirmBox.replaceChildren(askConfirm(t("set.undoConfirm"), t("set.undoYes"), () => runUndo(plan), () => { setDisabled(revert, false); confirmBox.replaceChildren(); }));
    });
    const cancel = h("button", { type: "button" }, t("set.discard"));
    cancel.addEventListener("click", () => out.replaceChildren());
    out.replaceChildren(h("section", { class: "panel" }, h("h2", null, t("set.undoPreviewTitle")), planBlock(plan),
      h("p", { class: "muted" }, t("set.undoValid", { n: fmt(Math.round((plan.expires_in || 300) / 60)) })),
      h("div", { class: "actions" }, revert, cancel), confirmBox));
  }
  async function runUndo(plan) {
    busy("set.undoing");
    let res;
    try { res = await postJson("/api/settings/undo", { apply_token: plan.apply_token, confirm: true }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return fail(res, () => runUndoPreview());
    const d = res.data;
    out.replaceChildren(h("section", { class: "panel", role: "status" }, h("h2", null, t("set.undone")), h("p", null, "✓ " + t("set.written", { files: fmt(d.files.length), removed: fmt(d.removed.length) })),
      d.backup ? h("p", null, t("set.backup", { id: d.backup })) : h("p", { class: "muted" }, t("set.noBackup")),
      h("p", { class: "muted" }, t("set.undoneNote"))));
    await reload();
  }
  async function reload() {
    try { info = await api("settings"); buildForm(); } catch (_) { /* the page keeps what it shows */ }
  }

  buildForm();
  const projectsBox = await projectsSection();
  root.append(h("h1", null, t("nav.settings")),
    h("p", { class: "muted" }, t("set.intro")),
    formBox, out, ...(projectsBox ? [projectsBox] : []));
  return [root];
}
