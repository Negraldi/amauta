"use strict";
// Themes: the sidebar picker and the theme editor (#/themes).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

// ---- Themes: picker in the sidebar, and the editor page (list, live preview, save, import, export) ----------------------------------
// A theme reaches the page only through TH.applyChoice / TH.previewTheme (CSSOM custom properties and data-theme). The viewer's choice lives in
// browser storage through TH.storage() (try/catch: the page works without it); the theme files themselves are stored by the server through guarded writes.
const usableThemes = () => state.themes.filter((th) => !th.error && TH.validateTheme({ name: th.name, base: th.base, tokens: th.tokens }).ok);
const effectiveChoice = () => (state.themeChoice.startsWith("custom:") && !usableThemes().some((th) => `custom:${th.slug}` === state.themeChoice) ? "system" : state.themeChoice);
function applyTheme() { TH.applyChoice(document.documentElement, state.themeChoice, state.themes); }
function paintPicker() {
  const pick = $("theme-picker");
  pick.replaceChildren(...[["system", t("theme.system")], ["light", t("theme.light")], ["dark", t("theme.dark")], ...usableThemes().map((th) => [`custom:${th.slug}`, th.name])].map(([v, l]) => h("option", { value: v }, l)));
  pick.value = effectiveChoice();
}
async function loadThemes() {
  try { state.themes = (await api("themes")).themes || []; } catch (_) { state.themes = []; }
  paintPicker();
  applyTheme();
}
function chooseTheme(choice) {
  state.themeChoice = choice;
  TH.saveChoice(TH.storage(), choice);
  applyTheme();
  if (state.preview) state.preview(); // the editor keeps showing its draft
  paintPicker();
}

const THEME_CODES = ["shape", "name", "base", "token", "value", "slug", "limit", "dir", "symlink", "toolarge", "json", "unreadable", "notfound", "write"]; // the server sends "theme.<code>"; each has a themeErr.<code> text
// A known code gives the plain-language text; an unknown code, or a token-specific one without its token, shows the server's own message.
function themeMsg(e) {
  const code = String((e && e.code) || "").replace(/^theme\./, "");
  const known = THEME_CODES.includes(code);
  return known && (e.token || !/^(token|value)$/.test(code)) ? t(`themeErr.${code}`, { token: e.token || "" }) : e && e.error ? ts(e.error) : t("themeErr.invalid");
}
const MAX_THEME_FILE = 16384;

async function viewThemes() {
  await loadThemes();
  const draft = () => state.themeDraft;
  const rows = {};
  const root = h("div", { class: "theme-editor" });
  const listBox = h("div", null), formBox = h("div", null), out = h("div", { class: "settings-out", "aria-live": "polite" });
  const say = (...kids) => out.replaceChildren(...kids);
  const warn = (head, extra) => say(h("div", { class: "notice warn", role: "alert" }, h("p", null, `▲ ${head}`), extra));
  const badTokens = () => Object.entries(draft().tokens).filter(([, v]) => !TH.isValidValue(v)).map(([k]) => k);
  const validTokens = () => Object.fromEntries(Object.entries(draft().tokens).filter(([, v]) => TH.isValidValue(v)).map(([k, v]) => [k, TH.normalizeValue(v)]));
  const warnBox = h("div", { class: "notice warn", "aria-live": "polite", "data-contrast": "1", hidden: true });

  const refresh = () => {
    if (!draft()) return;
    TH.previewTheme(document.documentElement, draft().base, draft().tokens);
    const w = TH.contrastWarnings(draft().base, draft().tokens);
    warnBox.hidden = !w.length;
    warnBox.replaceChildren(...w.map((x) => h("p", null, "▲ " + t("theme.lowContrast", { fg: x.fg, bg: x.bg, ratio: R.fmtDecimal(x.ratio, 1), min: R.fmtDecimal(x.min, x.min % 1 ? 1 : 0) }))));
  };
  state.preview = refresh;
  const paintRow = (tok) => {
    const r = rows[tok], v = draft().tokens[tok] || "";
    const ok = !v || TH.isValidValue(v);
    r.msg.textContent = ok ? "" : "▲ " + t("theme.invalidValue");
    if (ok) r.text.removeAttribute("aria-invalid"); else r.text.setAttribute("aria-invalid", "true");
    r.text.setAttribute("placeholder", TH.BASES[draft().base][tok]);
    r.color.value = TH.toHex(ok && v ? v : TH.BASES[draft().base][tok]) || "#000000";
  };
  const tokenRow = (tok) => {
    const text = h("input", { type: "text", id: `tok-${tok}`, value: draft().tokens[tok] || "", "aria-describedby": `tok-${tok}-msg`, autocomplete: "off", spellcheck: "false" });
    const color = h("input", { type: "color", id: `tok-${tok}-color`, "aria-label": t("theme.picker", { token: tok }) });
    const msg = h("span", { class: "tok-msg", id: `tok-${tok}-msg` });
    rows[tok] = { text, color, msg };
    text.addEventListener("input", () => { const v = text.value.trim(); if (v) draft().tokens[tok] = v; else delete draft().tokens[tok]; paintRow(tok); refresh(); });
    color.addEventListener("input", (e) => { text.value = e.target.value; draft().tokens[tok] = String(e.target.value).toLowerCase(); paintRow(tok); refresh(); });
    return h("div", { class: "token-row" }, h("label", { for: `tok-${tok}` }, tok), color, text, msg);
  };

  const askConfirm = (text, yes, onYes) => {
    const ok = h("button", { type: "button", class: "primary" }, yes), no = h("button", { type: "button" }, t("common.goBack"));
    ok.addEventListener("click", onYes);
    no.addEventListener("click", () => paintForm());
    return h("div", { class: "confirm", role: "group", "aria-label": t("common.confirm") }, h("p", null, text), h("div", { class: "actions" }, ok, no));
  };
  const freeSlug = (base) => {
    const taken = new Set(state.themes.map((th) => th.slug));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) { const s = `${base.slice(0, 40 - String(n).length - 1).replace(/-+$/, "")}-${n}`; if (!taken.has(s)) return s; }
  };
  const saved = (data, note) => { state.themes = data.themes || []; paintPicker(); paintList(); say(h("p", { role: "status" }, note)); };
  const failed = (res) => warn(res.data && (res.data.code || res.data.error) ? themeMsg(res.data) : t("common.requestFailed", { status: res.status }), h("p", null, t(R.settingsAdvice(res.status).key)));

  async function save() {
    const d = draft();
    if (badTokens().length) return warn(t("theme.fixValues"));
    const v = TH.validateTheme({ name: d.name, base: d.base, tokens: d.tokens });
    if (!v.ok) return warn(t("theme.cannotSave"), h("ul", { class: "plain-list" }, v.errors.map((e) => h("li", null, themeMsg(e)))));
    const slug = d.isNew ? freeSlug(TH.slugify(d.name)) : d.slug;
    say(h("p", { role: "status", class: "muted" }, t("common.saving")));
    let res;
    try { res = await postJson("/api/themes", { slug, ...v.theme }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return failed(res);
    d.slug = slug; d.isNew = false;
    saved(res.data, "✓ " + t("common.saved"));
    paintForm();
  }
  async function remove() {
    const d = draft();
    say(h("p", { role: "status", class: "muted" }, t("theme.deleting")));
    let res;
    try { res = await postJson("/api/themes/delete", { slug: d.slug }); } catch (err) { res = { ok: false, status: 0, data: { error: String(err.message || err) } }; }
    if (!res.ok) return failed(res);
    if (state.themeChoice === `custom:${d.slug}`) chooseTheme("system");
    state.themeDraft = null; state.preview = null;
    applyTheme();
    saved(res.data, "✓ " + t("theme.deleted"));
    paintForm();
  }
  function exportTheme() {
    const d = draft();
    const data = { name: d.name.trim() || t("theme.untitled"), base: d.base, tokens: validTokens() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
    const a = h("a", { href: url, download: `${d.slug || TH.slugify(d.name)}.json` });
    if (document.body) document.body.append(a);
    a.click();
    if (a.remove) a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(input) {
    const file = (input.files || [])[0];
    if (!file) return;
    if (file.size > MAX_THEME_FILE) return warn(t("theme.fileTooLarge"));
    let data;
    try { data = JSON.parse(await file.text()); } catch (_) { return warn(t("theme.importNotJson")); }
    const v = TH.validateTheme(data);
    input.value = "";
    if (!v.ok) return warn(t("theme.importFailed"), h("ul", { class: "plain-list" }, v.errors.map((e) => h("li", null, themeMsg(e)))));
    state.themeDraft = { slug: null, isNew: true, name: v.theme.name, base: v.theme.base, tokens: { ...v.theme.tokens } };
    paintForm();
    say(h("p", { role: "status" }, t("theme.imported")));
  }

  function paintForm() {
    for (const k of Object.keys(rows)) delete rows[k];
    const d = draft();
    if (!d) { state.preview = null; applyTheme(); formBox.replaceChildren(h("p", { class: "muted" }, t("theme.choose"))); return; }
    state.preview = refresh;
    const name = h("input", { type: "text", id: "theme-name", value: d.name, maxlength: "60", autocomplete: "off" });
    name.addEventListener("input", () => { d.name = name.value; });
    const base = h("select", { id: "theme-base" }, h("option", { value: "light" }, t("theme.light")), h("option", { value: "dark" }, t("theme.dark")));
    base.value = d.base;
    base.addEventListener("change", (e) => { d.base = e.target.value === "dark" ? "dark" : "light"; for (const tok of TH.TOKENS) paintRow(tok); refresh(); });
    const btn = (label, fn, cls) => { const b = h("button", { type: "button", class: cls || false }, label); b.addEventListener("click", fn); return b; };
    const confirmBox = h("div", null);
    formBox.replaceChildren(h("section", { class: "theme-form", "aria-label": t("theme.editorLabel") },
      h("h2", null, d.isNew ? t("theme.new") : t("theme.edit", { name: d.name })),
      h("div", { class: "field" }, h("label", { for: "theme-name" }, t("col.name")), name),
      h("div", { class: "field" }, h("label", { for: "theme-base" }, t("theme.base")), base, h("span", { class: "muted" }, t("theme.emptyUsesBase"))),
      ...TH.TOKENS.map(tokenRow), warnBox,
      h("div", { class: "actions" }, btn(t("theme.save"), save, "primary"), btn(t("theme.export"), exportTheme),
        d.isNew ? null : btn(t("theme.delete"), () => confirmBox.replaceChildren(askConfirm(t("theme.deleteConfirm", { name: d.name }), t("theme.deleteYes"), remove))),
        btn(t("theme.close"), () => { state.themeDraft = null; paintForm(); })),
      confirmBox));
    for (const tok of TH.TOKENS) paintRow(tok);
    refresh();
  }
  function paintList() {
    const input = h("input", { type: "file", id: "theme-import", class: "visually-hidden", accept: ".json,application/json", tabindex: "-1" });
    input.addEventListener("change", () => importFile(input));
    const importButton = h("button", { type: "button" }, t("theme.import"));
    importButton.addEventListener("click", () => input.click());
    const create = h("button", { type: "button" }, t("theme.newButton"));
    create.addEventListener("click", () => { state.themeDraft = { slug: null, isNew: true, name: "", base: "light", tokens: {} }; paintForm(); say(); });
    const editButton = (th) => {
      const b = h("button", { class: "row-link", type: "button", "data-edit": th.slug }, th.name);
      b.addEventListener("click", () => { state.themeDraft = { slug: th.slug, isNew: false, name: th.name, base: th.base, tokens: { ...th.tokens } }; paintForm(); say(); });
      return b;
    };
    listBox.replaceChildren(
      state.themes.length ? h("ul", { class: "items" }, state.themes.map((th) => th.error
        ? h("li", null, h("code", null, th.slug), h("p", { class: "warn" }, "▲ " + t("theme.invalidFile", { reason: themeMsg(th) })))
        : h("li", null, editButton(th), h("span", { class: "muted" }, ` ${t(th.base === "dark" ? "theme.dark" : "theme.light")}${state.themeChoice === `custom:${th.slug}` ? ", " + t("theme.inUse") : ""}`))))
        : h("p", { class: "muted" }, t("theme.noneYet")),
      h("div", { class: "actions" }, create, importButton, input));
  }
  paintList();
  paintForm();
  root.append(h("h1", null, t("nav.themes")), h("p", { class: "muted" }, t("theme.intro")), listBox, formBox, out);
  return [root];
}

// Home: recent activity is the page; spending and harness health sit in the rail as plain text and a small table (no metric tiles).
// The server groups by UTC day; the page regroups by the viewer's local day so a time and its heading always agree.
