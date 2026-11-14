"use strict";
// The guide (#/guide[/slug], odd/tasks/portal-guide.md): pages that explain each part of amauta, shipped as Markdown
// with the portal and shown in its language, with their Mermaid diagrams. A tab of Harness; the list of pages first,
// then the page (the overview when none is named): a page selector above it, previous / next below.
// Rendered by the safe Markdown subset: page text is never markup.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

const GUIDE_DIAGRAMS = 12; // diagrams drawn per page; more are shown as their source

// The selector above the article: every page as "n. Title", the current one marked, and where it sits in the list.
function picker(index, page) {
  const at = index.pages.findIndex((p) => p.slug === page.slug);
  const select = h("select", { id: "guide-pick", onchange: (e) => { location.hash = `#/guide/${e.target.value}`; } },
    index.pages.map((p, n) => h("option", { value: p.slug, selected: p.slug === page.slug }, `${n + 1}. ${p.title}`)));
  return h("div", { class: "guide-pick" }, h("label", { for: "guide-pick" }, t("guide.pick")), select,
    h("span", { class: "muted" }, t("guide.position", { n: at + 1, total: index.pages.length })));
}
// Previous / next below the article: a small label over the page title; the first and last page have one link.
function pager(index, page) {
  const at = index.pages.findIndex((p) => p.slug === page.slug);
  const side = (p, cls, key) => (p ? h("a", { class: cls, href: `#/guide/${p.slug}` }, h("small", null, t(key)), p.title) : null);
  return h("nav", { class: "guide-pager", "aria-label": t("guide.pager") },
    side(index.pages[at - 1], "prev", "guide.prev"), side(index.pages[at + 1], "next", "guide.next"));
}

async function viewGuide(route) {
  const lang = I.lang();
  const slug = (route && route.id) || "overview";
  const [index, page] = await Promise.all([api("guide", { lang }), api("guide/page", { slug, lang })]);
  state.pageTitle = page.title; // the breadcrumb ends with the page's title, not its slug
  let drawn = 0;
  const mermaid = (src) => (++drawn <= GUIDE_DIAGRAMS ? adaptiveDiagram(src, t("diagram.mermaid"))
    : h("pre", { class: "code" }, h("code", null, src)));
  const body = MD.toDom(MD.parse(page.markdown), document, { known: () => true, mermaid, headingOffset: 0,
    labels: { missing: (kind, id) => t("md.missing", { kind, id }), table: t("table.label") } });
  return [picker(index, page), h("article", { class: "doc guide-page prose" }, body), pager(index, page)];
}
