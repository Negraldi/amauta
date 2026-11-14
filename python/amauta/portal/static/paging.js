"use strict";
// Paging helper: every list the portal cuts for length says "Showing N of M" and offers the rest (T15 rule: no silent caps).
// Shares the globals of app.js, loaded before the page scripts.

// A list of `rows` that shows `page` of them, then "Showing N of M." with a Show more button until all are on the page.
// `renderRow(row)` returns one element; `extra` adds attributes to the <ul>. `total` is the real size when the rows
// themselves are only a part (then no button, only the honest sentence).
function pagedList(rows, page, renderRow, extra) {
  const list = h("ul", extra || { class: "items" }, rows.slice(0, page).map(renderRow));
  if (rows.length <= page) return list;
  const box = h("div", null);
  let shown = page;
  const button = h("button", { type: "button", class: "show-more" }, t("more.button"));
  const draw = () => {
    const note = h("p", { class: "muted" }, t("more.showing", { shown: fmt(shown), total: fmt(rows.length) }));
    box.replaceChildren(list, ...(shown < rows.length ? [note, button] : []));
  };
  button.addEventListener("click", () => {
    const added = rows.slice(shown, shown + page).map(renderRow);
    list.append(...added);
    shown += added.length;
    draw();
    if (added[0] && added[0].setAttribute) { added[0].setAttribute("tabindex", "-1"); if (added[0].focus) added[0].focus(); }
    if (shown < rows.length && button.focus) button.focus();
  });
  draw();
  return box;
}
