"use strict";
// Memory pages: the memory browser, the memory files and the quality report (#/memory, #/memfile, #/lint).
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

// Memories tab: the store is part of the hash (?source=engram), so a reload or a shared link keeps it.
const memSourceOf = (route) => (route && route.query && route.query.source === "engram" ? "engram" : "own");
function memSourceSwitch(source) {
  const item = ([k, l]) => h("a", { href: R.routeHash({ kind: "memory", id: "", query: k === "own" ? {} : { source: k } }),
    "aria-current": k === source ? "true" : false }, l);
  return h("nav", { class: "segmented", "aria-label": t("mem.sourceLabel") }, [["own", t("mem.own")], ["engram", t("mem.engram")]].map(item));
}
function memTable(r, source, query) {
  if (!r.available) return empty(source === "engram" ? t("mem.noEngram") : t("mem.noDb"));
  if (!r.items.length) return query ? empty(t("mem.noMatch")) : h("div", { class: "teach" }, h("p", null, codeSpans(t("mem.teach"))));
  // A title is a link to the memory's wiki page (keyboard and middle-click work); the source rides along for other stores.
  return table("mem", [{ key: "title", label: t("col.title"), href: (row) => R.formatHash("memory", String(row.id), { source }) },
    { key: "type", label: t("col.type"), render: memType },
    { key: "project", label: t("kind.project") }, { key: "topic_key", label: t("col.topic") },
    { key: "revision", label: t("col.rev"), num: true }, { key: "updated_at", label: t("col.updated") }], r.items);
}
// "Showing 50 of 728." under the table, with Show more while rows remain (the server pages with an offset).
function memMore(r, more) {
  if (!r.available || !r.items.length || r.total == null) return null;
  const line = h("p", { class: "muted" }, t("mem.showing", { shown: fmt(r.items.length), total: fmt(r.total) }));
  if (r.items.length >= r.total) return line;
  return h("div", null, line, h("button", { type: "button", class: "mem-more", onclick: more }, t("mem.showMore")));
}
async function viewMemories(route) {
  sortOnce("mem", "updated_at"); // newest first until a header is clicked
  const source = memSourceOf(route);
  if (state.memSource !== source) { state.memSource = source; state.memQuery = ""; }
  const q = h("input", { type: "search", placeholder: t("mem.search"), "aria-label": t("mem.search"), value: state.memQuery || "" });
  const type = h("select", { "aria-label": t("col.type") }, h("option", { value: "" }, t("mem.allTypes")));
  const mine = h("div", { "aria-live": "polite" });
  let seq = 0, timer = null, shown = null;
  const load = guarded(async (more) => {
    const mySeq = ++seq;
    state.memQuery = q.value;
    const r = await api("memories", { source, q: q.value, type: type.value, offset: more ? shown.items.length : 0 });
    if (mySeq !== seq) return; // a newer search is on its way
    if (r.available && !type.dataset.ready) {
      r.facets.types.forEach((v) => type.append(h("option", { value: v }, memType(v))));
      type.dataset.ready = "1";
    }
    shown = more ? { ...r, items: [...shown.items, ...r.items] } : r;
    mine.replaceChildren(...[memTable(shown, source, q.value || type.value), memMore(shown, () => load(true))].filter(Boolean));
    const next = mine.querySelector && mine.querySelector("button.mem-more");
    if (more && next && next.focus) next.focus(); // focus stays on the control, never lost with a re-rendered list
  }, mine);
  // Filters as you type: one request after a 200 ms pause; Enter searches at once.
  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => load(false), 200); });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); load(false); } });
  type.addEventListener("change", () => load(false));
  await load();
  return [pageHead(t("nav.memory"), t("mem.lead")), memSourceSwitch(source), h("div", { class: "controls" }, q, type), mine];
}

// Memory files tab: Claude's file memories (MEMORY.md and its notes), one table.
async function viewMemoryFiles() {
  const files = await api("memory-files");
  if (!files.items.length) return [pageHead(t("nav.memfile")), h("div", { class: "teach" }, h("p", null, codeSpans(t("mem.filesTeach"))))];
  return [pageHead(t("nav.memfile"), tn("mem.filesN", files.items.length, { n: fmt(files.items.length) })),
    table("mfiles", [{ key: "name", label: t("col.file"), href: (f) => R.formatHash("memfile", f.id) }, { key: "project", label: t("kind.project") },
      { key: "size", label: t("col.bytes"), num: true, render: bytes }, { key: "mtime", label: t("col.modified") }], files.items)];
}


// The server sends every item; a category opens on LINT_PAGE rows and a duplicate group on MEMBER_PAGE members.
const LINT_PAGE = 50, MEMBER_PAGE = 6;
function lintItem(it) {
  const people = Array.isArray(it.members) && it.members.length > 1
    ? pagedList(it.members, MEMBER_PAGE, (m) => h("li", null, link(m.kind, m.id, m.title), m.topic_key ? h("span", { class: "muted" }, ` ${m.topic_key}`) : null), { class: "refs" })
    : null;
  return h("li", null, people ? h("span", null, t("lint.group") + " ") : link(it.kind, it.id, it.title), it.detail ? h("span", { class: "muted" }, ` ${ts(it.detail)}`) : null, people);
}
function lintCategory(c) {
  return h("section", { class: "page-section lint-cat" }, h("h2", null, `${ts(c.title)} (${fmt(c.count)})`), h("p", { class: "muted" }, ts(c.note)),
    c.items.length ? pagedList(c.items, LINT_PAGE, lintItem) : h("p", null, t("lint.nothing")),
    c.truncated ? h("p", { class: "muted" }, t("lint.showing", { shown: fmt(c.items.length), total: fmt(c.count) })) : null);
}
async function viewLint() {
  const l = await api("wiki/lint");
  const sc = l.scanned || {};
  const scope = tn("lint.intro", sc.memories, { n: fmt(sc.memories), capped: sc.capped ? t("lint.capped") : "" });
  return [pageHead(t("lint.title"), `${t("lint.prompts")} ${scope}`), h("div", { class: "page" }, h("article", { class: "doc" },
    l.categories.map(lintCategory)))];
}
