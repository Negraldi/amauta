"use strict";
// Settings (#/settings): three tabs in ?tab= (Preferences, Projects and siblings, Appearance). This file holds the page shell and the
// Preferences editor: a closed list of options, preview -> confirm -> apply, with undo. Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

// ---- Settings editor: a closed list of options, always preview -> confirm -> apply, with undo ----------------------------------------
// Labels and help are i18n keys (resolved with t() when the page is built).
const ON_OFF = [["on", "set.on"], ["off", "set.off"]]; // one order for every switch (T14 l)
const SETTING_OPTIONS = [
  ["persona", "set.persona", [["gentleman", "set.gentleman"], ["neutral", "set.neutral"]], "set.persona.help"],
  ["review_mode", "set.review", ON_OFF, "set.review.help"],
  ["telemetry", "set.telemetry", ON_OFF, "set.telemetry.help"],
  ["privacy", "set.privacy", ON_OFF, "set.privacy.help"],
  ["checks", "set.checks", ON_OFF, "set.checks.help"],
];
const SETTING_MODULES = [
  ["sdd", "set.mod.sdd", "set.mod.sdd.help"],
  ["rea", "set.mod.rea", "set.mod.rea.help"],
  ["context7", "set.mod.context7", "set.mod.context7.help"],
  ["impeccable", "set.mod.impeccable", "set.mod.impeccable.help"],
  ["archify", "set.mod.archify", "set.mod.archify.help"],
];
const SETTING_GROUPS = [["set.group.behavior", ["persona", "review_mode"]], ["set.group.hooks", ["telemetry", "privacy", "checks"], "set.group.hooks.help"]];
const PERSONA_LABELS = Object.fromEntries(SETTING_OPTIONS[0][2]); // "now Gentleman" matches the select (plan N12h)
// The plan's lifetime in whole minutes ("valid for 5 minutes", or "1 minute").
const minutesOf = (plan) => Math.round((plan.expires_in || 300) / 60);
const valueLabel = (v) => (v === "on" ? t("common.on") : v === "off" ? t("common.off") : PERSONA_LABELS[v] ? t(PERSONA_LABELS[v]) : v);
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
    list(t("plan.filesWritten"), files), list(t("plan.filesRemoved"), removed), list(t("plan.kept"), skipped), codexPlan(p.codex, list));
}
// The Codex part of a plan (T10): its own counts and files, or one plain sentence when no Codex home was found.
function codexPlan(c, list) {
  if (!c) return h("p", { class: "muted" }, t("plan.codexNone"));
  const files = c.files || [], removed = c.removed || [], skipped = c.skipped || [];
  const counts = { written: fmt(files.length), removed: fmt(removed.length), kept: fmt(skipped.length) };
  return h("div", null, h("p", null, t("plan.codexCounts", counts)),
    list(t("plan.codexFiles"), files));
}
// What an apply or undo did on the Codex side, when Codex was a target.
const codexDone = (c) => c ? [
  h("p", null, "✓ " + t("set.codexWritten", { files: fmt((c.files || []).length), removed: fmt((c.removed || []).length) })),
  c.backup ? h("p", null, t("set.codexBackup", { id: c.backup })) : null] : [];
function settingLabel(key) {
  if (key.startsWith("module:")) return t("set.moduleN", { name: key.slice(7) });
  const labels = { persona: "set.persona", review_mode: "set.review", telemetry: "set.telemetry", privacy: "set.privacy",
    checks: "set.checks" };
  return labels[key] ? t(labels[key]) : key;
}

// A plan's result panel: its heading takes focus and is scrolled into view, so the buttons below it are reachable (T15 E3).
function showPlanPanel(out, titleKey, plan, valid, buttons, confirmBox) {
  const title = h("h2", { tabindex: -1 }, t(titleKey));
  out.replaceChildren(h("section", { class: "panel" }, title, planBlock(plan), h("p", { class: "muted" }, valid),
    h("div", { class: "actions" }, ...buttons), confirmBox));
  title.focus();
  if (title.scrollIntoView) title.scrollIntoView({ block: "start" });
}

// A request that failed: the reason, what to do next and, when a new preview can help, the button for it.
function failNote(out, res, retry) {
  const adv = R.settingsAdvice(res.status);
  out.replaceChildren(h("div", { class: "notice warn", role: "alert" }, h("p", null, `▲ ${res.data && res.data.error ? ts(res.data.error) : t("common.requestFailed", { status: res.status })}`),
    res.data && res.data.detail ? h("p", { class: "muted" }, h("code", null, res.data.detail)) : null, h("p", null, t(adv.key)),
    adv.again ? (() => { const b = h("button", { type: "button" }, t("set.previewAgain")); b.addEventListener("click", () => retry()); return b; })() : null));
}
// A question with the accent button and Go back, in the row of the thing it confirms.
function askConfirm(text, yes, onYes, onNo) {
    const ok = h("button", { type: "button", class: "primary" }, yes), no = h("button", { type: "button" }, t("common.goBack"));
    ok.addEventListener("click", onYes); no.addEventListener("click", onNo);
    return h("div", { class: "confirm", role: "group", "aria-label": t("common.confirm") }, h("p", null, text), h("div", { class: "actions" }, ok, no));
}


async function preferencesTab() {
  let info = await api("settings");
  let draft = null;
  const root = h("div", { class: "settings" });
  const formBox = h("div", null), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const marks = new Map(), controls = new Map();
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
    select.value = value; controls.set(key, select);
    select.addEventListener("change", (e) => {
      const v = e.target.value;
      if (key.startsWith("module:")) draft.modules[key.slice(7)] = v; else draft[key] = v;
      refreshMarks();
    });
    return h("div", { class: "option" }, h("label", { for: id }, t(label)), select, h("span", { class: "current" }, t("set.now", { value: valueLabel(value) })), mark, h("p", { id: `${id}-help`, class: "option-help muted" }, t(help)));
  };
  const optionGroup = (title, items, lead) => h("section", { class: "option-group" }, h("h2", null, t(title)),
    lead ? h("p", { class: "muted" }, t(lead)) : null, ...items);
  const prefOption = (key) => {
    const [, label, choices, help] = SETTING_OPTIONS.find((o) => o[0] === key);
    return option(key, `set-${key.replace("_", "-")}`, label, choices, info.current[key], help);
  };
  const buildForm = () => {
    draft = copy(info.current);
    marks.clear(); controls.clear();
    previewBtn = h("button", { type: "button", disabled: true }, t("set.preview"));
    previewBtn.addEventListener("click", () => runPreview(false));
    repairBtn = h("button", { type: "button" }, t("set.previewRepair"));
    repairBtn.addEventListener("click", () => runPreview(true));
    formBox.replaceChildren(...[
      info.installed ? null : h("p", { class: "notice" }, t("set.notInstalled")),
      h("div", { class: "options" }, ...SETTING_GROUPS.map(([title, keys, lead]) => optionGroup(title, keys.map(prefOption), lead)),
        optionGroup("set.modules", SETTING_MODULES.map(([name, label, help]) =>
          option(`module:${name}`, `set-module-${name}`, label, ON_OFF, info.current.modules[name], help)))),
      h("div", { class: "actions" }, previewBtn),
      h("section", { class: "repair" }, h("h2", null, t("set.repairTitle")),
        h("p", { class: "muted" }, t("set.repairHelp")), h("div", { class: "actions" }, repairBtn))].filter(Boolean));
    refreshMarks();
  };

  const busy = (key) => { out.replaceChildren(h("p", { role: "status", class: "muted" }, t(key))); };
  const fail = (res, retry) => failNote(out, res, retry);

  async function runPreview(repair) {
    const body = R.settingsBody(info.current, draft, repair);
    setDisabled(previewBtn, true); setDisabled(repairBtn, true);
    busy("set.checking");
    let res;
    try { res = await postJson("/api/settings/preview", body); } catch (err) { res = { ok: false, status: 0, data: { error: netError(err) } }; }
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
    cancel.addEventListener("click", () => discardPreview(repair));
    const valid = tn("set.validFor", minutesOf(plan), { n: fmt(minutesOf(plan)) });
    showPlanPanel(out, "set.previewTitle", plan, valid, [apply, cancel], confirmBox);
  }
  // Discard drops the draft: the form goes back to the saved values and focus returns to the first control that had been changed.
  function discardPreview(repair) {
    const first = R.settingsChanges(info.current, draft)[0];
    out.replaceChildren(); buildForm();
    (repair || !first ? repairBtn : controls.get(first.key)).focus();
  }
  async function runApply(plan) {
    busy("set.applying");
    let res;
    try { res = await postJson("/api/settings/apply", { apply_token: plan.apply_token, confirm: true }); } catch (err) { res = { ok: false, status: 0, data: { error: netError(err) } }; }
    if (!res.ok) return fail(res, () => runPreview(false));
    const d = res.data;
    const undo = d.undo_available ? h("button", { type: "button" }, t("set.undo")) : null;
    if (undo) undo.addEventListener("click", () => { setDisabled(undo, true); runUndoPreview(); });
    out.replaceChildren(h("section", { class: "panel", role: "status" }, h("h2", null, t("set.applied")),
      h("p", null, "✓ " + t("set.written", { files: fmt(d.files.length), removed: fmt(d.removed.length) })), d.backup ? h("p", null, t("set.backup", { id: d.backup })) : h("p", { class: "muted" }, t("set.noBackup")), ...codexDone(d.codex),
      d.skipped.length ? h("p", { class: "muted" }, tn("set.keptEdited", d.skipped.length, { n: fmt(d.skipped.length) })) : null,
      d.impeccable && d.impeccable.engine === "failed" ? h("p", { class: "warn" }, "▲ " + t("set.engineFailed", { detail: d.impeccable.detail || t("set.npmFailed") })) : null,
      h("div", { class: "actions" }, undo)));
    await reload();
  }
  async function runUndoPreview() {
    busy("set.checkingUndo");
    let res;
    try { res = await postJson("/api/settings/undo/preview", {}); } catch (err) { res = { ok: false, status: 0, data: { error: netError(err) } }; }
    if (!res.ok) return fail(res, () => runUndoPreview());
    const plan = res.data, confirmBox = h("div", null);
    const revert = h("button", { type: "button", class: "primary" }, t("set.revert"));
    revert.addEventListener("click", () => {
      setDisabled(revert, true);
      confirmBox.replaceChildren(askConfirm(t("set.undoConfirm"), t("set.undoYes"), () => runUndo(plan), () => { setDisabled(revert, false); confirmBox.replaceChildren(); }));
    });
    const cancel = h("button", { type: "button" }, t("set.discard"));
    cancel.addEventListener("click", () => out.replaceChildren());
    const valid = tn("set.undoValid", minutesOf(plan), { n: fmt(minutesOf(plan)) });
    showPlanPanel(out, "set.undoPreviewTitle", plan, valid, [revert, cancel], confirmBox);
  }
  async function runUndo(plan) {
    busy("set.undoing");
    let res;
    try { res = await postJson("/api/settings/undo", { apply_token: plan.apply_token, confirm: true }); } catch (err) { res = { ok: false, status: 0, data: { error: netError(err) } }; }
    if (!res.ok) return fail(res, () => runUndoPreview());
    const d = res.data;
    out.replaceChildren(h("section", { class: "panel", role: "status" }, h("h2", null, t("set.undone")), h("p", null, "✓ " + t("set.written", { files: fmt(d.files.length), removed: fmt(d.removed.length) })),
      d.backup ? h("p", null, t("set.backup", { id: d.backup })) : h("p", { class: "muted" }, t("set.noBackup")), ...codexDone(d.codex),
      h("p", { class: "muted" }, t("set.undoneNote"))));
    await reload();
  }
  async function reload() {
    try { info = await api("settings"); buildForm(); } catch (_) { /* the page keeps what it shows */ }
  }

  buildForm();
  return [h("p", { class: "muted" }, t("set.intro")), formBox, out];
}

// The language choice: the same setting as the Display popover; changing it builds the page again in the new language.
const LANGUAGES = [["en", "lang.en"], ["es", "lang.es"]]; // each language is named in itself in both dictionaries
function languageSection() {
  const pick = h("select", { id: "set-lang", "aria-labelledby": "set-lang-title", "aria-describedby": "set-lang-help" }, LANGUAGES.map(([v, l]) => h("option", { value: v }, t(l))));
  pick.value = I.lang();
  pick.addEventListener("change", (e) => setLanguage(e.target.value));
  const title = h("h2", { id: "set-lang-title" }, t("chrome.language")); // the heading names the control: no second visible label
  return h("section", { class: "option-group" }, title,
    h("div", { class: "option" }, pick, h("p", { id: "set-lang-help", class: "option-help muted" }, t("set.lang.help"))));
}
async function appearanceTab() {
  const editor = await viewThemes(); // loads the themes first: the picker below lists them
  return [h("p", { class: "muted" }, t("theme.intro")), themeSection(), ...editor, languageSection()];
}

// The page: one title, the tabs (links that keep the tab in the URL) and the active tab's body, loaded inside its own panel.
const SETTINGS_BODIES = () => ({ preferences: preferencesTab, projects: projectsTab, appearance: appearanceTab });
async function viewSettings(route) {
  const current = R.settingsTab(route);
  const link = (x) => h("a", { href: R.routeHash({ kind: "settings", id: "", query: { tab: x } }), "aria-current": x === current ? "page" : false },
    t(`set.tab.${x}`));
  return [h("div", { class: "settings" }, pageHead(t("nav.settings"), t("set.lead")), h("nav", { class: "tabs", "aria-label": t("nav.tabs") }, R.SETTINGS_TABS.map(link)),
    tabPanel(t(`set.tab.${current}`), SETTINGS_BODIES()[current]))];
}
