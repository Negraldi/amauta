"use strict";
// Paging helper: every list the portal cuts for length says "Showing N of M" and offers the rest (T15 rule: no silent caps).
// Shares the globals of app.js, loaded before the page scripts.

// A list of `rows` that shows `page` of them, then "Showing N of M." with a Show more button until all are on the page.
// `renderRow(row)` returns one element; `extra` adds attributes to the <ul>. `total` is the real size when the rows
// themselves are only a part (the server cut them): the sentence keeps saying so after every row sent is on the page.
function pagedList(rows, page, renderRow, extra, total) {
  const list = h("ul", extra || { class: "items" }, rows.slice(0, page).map(renderRow));
  const all = Math.max(total || 0, rows.length);
  if (all <= page) return list;
  const box = h("div", null);
  let shown = Math.min(page, rows.length);
  const button = h("button", { type: "button", class: "show-more" }, t("more.button"));
  const draw = () => {
    const note = h("p", { class: "muted" }, t("more.showing", { shown: fmt(shown), total: fmt(all) }));
    box.replaceChildren(list, ...(shown < all ? [note] : []), ...(shown < rows.length ? [button] : []));
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
