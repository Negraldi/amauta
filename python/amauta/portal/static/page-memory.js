"use strict";
// Memory pages: the memory browser and the lint report (#/memory, #/lint).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

async function viewMemories() {
  const q = h("input", { type: "search", placeholder: t("mem.search"), "aria-label": t("mem.search"), value: state.memQuery || "" });
  const type = h("select", { "aria-label": t("col.type") }, h("option", { value: "" }, t("mem.allTypes")));
  const mine = h("div", null);
  const source = state.memSource;
  const load = guarded(async () => {
    state.memQuery = q.value;
    const r = await api("memories", { source, q: q.value, project: $("project").value, type: type.value });
    if (r.available && !type.dataset.ready) { r.facets.types.forEach((t) => type.append(h("option", { value: t }, t))); type.dataset.ready = "1"; }
    // A title is a link to the memory's wiki page (keyboard and middle-click work); the source rides along for other stores.
    mine.replaceChildren(r.available ? (r.items.length ? table("mem", [{ key: "title", label: t("col.title"), href: (row) => R.formatHash("memory", String(row.id), { source }) }, { key: "type", label: t("col.type") }, { key: "project", label: t("kind.project") }, { key: "topic_key", label: t("col.topic") }, { key: "revision", label: t("col.rev"), num: true }, { key: "updated_at", label: t("col.updated") }], r.items) : empty(t("mem.noMatch"))) : empty(source === "engram" ? t("mem.noEngram") : t("mem.noDb")));
  }, mine);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  type.addEventListener("change", load);
  await load();
  const files = await api("memory-files");
  return [
    h("div", { class: "tabs" }, [["own", t("mem.own")], ["engram", t("mem.engram")]].map(([k, l]) => h("button", { type: "button", "aria-pressed": state.memSource === k, onclick: () => { state.memSource = k; state.memQuery = ""; render(); } }, l))),
    panel(t("mem.searchPanel"), h("div", { class: "filters" }, q, type, h("button", { type: "button", onclick: load }, t("common.search"))), mine),
    panel(t("mem.files", { n: fmt(files.items.length) }), files.items.length ? table("mfiles", [{ key: "name", label: t("col.file"), href: (f) => R.formatHash("memfile", f.id) }, { key: "project", label: t("kind.project") }, { key: "size", label: t("col.bytes"), num: true }, { key: "mtime", label: t("col.modified") }], files.items) : empty(t("mem.noFiles"))),
    await graphifyPanel(),
  ];
}


function lintItem(it) {
  const people = Array.isArray(it.members) && it.members.length > 1
    ? h("ul", { class: "refs" }, it.members.map((m) => h("li", null, link(m.kind, m.id, m.title), m.topic_key ? h("span", { class: "muted" }, ` ${m.topic_key}`) : null)))
    : null;
  return h("li", null, people ? h("span", null, t("lint.group") + " ") : link(it.kind, it.id, it.title), it.detail ? h("span", { class: "muted" }, ` ${ts(it.detail)}`) : null, people);
}
function lintCategory(c) {
  return h("section", { class: "page-section lint-cat" }, h("h2", null, `${ts(c.title)} (${fmt(c.count)})`), h("p", { class: "muted" }, ts(c.note)),
    c.items.length ? h("ul", { class: "items" }, c.items.map(lintItem)) : h("p", null, t("lint.nothing")),
    c.truncated ? h("p", { class: "muted" }, t("lint.showing", { shown: fmt(c.items.length), total: fmt(c.count) })) : null);
}
async function viewLint() {
  const l = await api("wiki/lint");
  const sc = l.scanned || {};
  return [h("div", { class: "page" }, h("article", { class: "doc" }, h("h1", null, t("nav.lint")),
    h("p", { class: "muted" }, t("lint.intro", { n: fmt(sc.memories), capped: sc.capped ? t("lint.capped") : "" })),
    l.categories.map(lintCategory)))];
}
