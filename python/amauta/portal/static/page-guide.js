"use strict";
// The guide (#/guide[/slug], odd/tasks/portal-guide.md): pages that explain each part of amauta, shipped as Markdown
// with the portal and shown in its language, with their Mermaid diagrams. A tab of Harness; the list of pages first,
// then the page (the overview when none is named). Rendered by the safe Markdown subset: page text is never markup.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

const GUIDE_DIAGRAMS = 12; // diagrams drawn per page; more are shown as their source

async function viewGuide(route) {
  const lang = I.lang();
  const slug = (route && route.id) || "overview";
  const [index, page] = await Promise.all([api("guide", { lang }), api("guide/page", { slug, lang })]);
  let drawn = 0;
  const mermaid = (src) => (++drawn <= GUIDE_DIAGRAMS ? diagramBox(src, t("diagram.mermaid"))
    : h("pre", { class: "code" }, h("code", null, src)));
  const body = MD.toDom(MD.parse(page.markdown), document, { known: () => true, mermaid, headingOffset: 0,
    labels: { missing: (kind, id) => t("md.missing", { kind, id }), table: t("table.label") } });
  const contents = h("nav", { class: "guide-nav", "aria-label": t("guide.contents") },
    h("h2", null, t("guide.contents")),
    h("ol", null, index.pages.map((p) => h("li", null,
      link("guide", p.slug, p.title, { "aria-current": p.slug === page.slug ? "page" : false })))));
  return [h("div", { class: "guide" }, contents, h("article", { class: "doc guide-page" }, body))];
}
