"use strict";
// Errors in the portal's words: a request that never arrived, a part of a page that failed (with Retry), and a page that failed
// to load (it still names itself and keeps its tabs). Shares the globals of app.js; loaded right after it.

// A request that never reached the server, in words; the browser's own reason ("Failed to fetch") stays out of the sentence.
const netError = (err) => {
  if (err && !err.net && console.debug) console.debug(err);
  return err && err.net ? plainReason(err) : t("error.network"); // api() already said it
};
const rerender = () => { state.shown = null; render(); };
// A part of a page that failed (a diagram, a list): one translated line naming it (`what`, when known), the raw reason as a muted
// detail. `retry` adds a Retry button: a function that returns the part's nodes again (it replaces the note, and a new failure
// shows the note again), or `true` when the part cannot be drawn alone and the route is built again.
function errorNote(err, what, retry) {
  const text = `▲ ${what ? t("error.partNamed", { part: what }) : t("error.part")} `;
  if (!retry) return h("p", { class: "warn", role: "alert" }, text, err ? h("span", { class: "muted tok" }, plainReason(err)) : null);
  const box = h("div", { class: "part-error" });
  const run = async () => {
    if (retry === true) return rerender();
    try { box.replaceChildren(...[].concat(await retry()).filter(Boolean)); } catch (e) { box.replaceChildren(errorNote(e, what, retry)); }
  };
  box.append(h("p", { class: "warn", role: "alert" }, text, err ? h("span", { class: "muted tok" }, `${plainReason(err)} `) : null,
    h("button", { type: "button", onclick: run }, t("error.retry"))));
  return box;
}
// A page that failed to load: what happened, where, and two ways on (try again, or go to Today).
function errorPanel(route, err) {
  const retry = h("button", { type: "button", onclick: rerender }, t("error.retry"));
  return h("section", { class: "panel error-panel", role: "alert" }, h("h2", null, t("common.error")),
    h("p", { class: "warn" }, t("error.lead")),
    h("p", { class: "muted" }, h("span", { class: "tok" }, plainReason(err))),
    h("div", { class: "controls" }, retry, h("a", { href: "#/", class: "button" }, t("error.home"))));
}
// A readable name from an id, for a detail page that failed: a node is the part after "::", a session its short id, a file its name.
function readableId(kind, id) {
  if (kind === "node") return id.split("::").pop() || id;
  if (kind === "session") return `${kindLabel("session")} ${id.replace(/^.*:/, "").slice(0, 8)}`;
  if (kind === "memfile") return id.split("/").pop() || id;
  return id;
}
// The name a page has when its data is unknown: a project says its id, a guide page its own title (else the Guide), a list page its own.
function failedName(route) {
  if (route.id && route.kind === "project") return route.id;
  if (route.id) return state.pageTitle || (route.kind === "guide" ? t("nav.guide") : readableId(route.kind, route.id));
  return t(PAGE_TITLES[route.kind] ?? `nav.${route.kind}`);
}
// The page-level failure: the same heading, browser title and tabs the page would have had, with the error where its content goes.
function errorPage(route, err) {
  const name = failedName(route), project = route.kind === "project" && route.id;
  state.pageTitle = state.pageTitle || name; // the crumb ends with the name, not a slug
  document.title = `${project ? `${kindLabel(route.kind)} ${name}` : name} - amauta`;
  const tabs = project ? hubTabs(route.id, R.projectTab(route)) : tabBar(route);
  return [pageHead(name), tabs, errorPanel(route, err)];
}
