"use strict";
// Pipelines, the run side (plan S1b'): a step in the flow row, the console (error lines marked, first error, a filter by
// step, follow output, copy, clear), following a run by polling its events with a timer against the usual duration,
// and the notice when a run ends. Output is text only, never markup. Shares the globals of app.js and page-pipelines.js.

const PIPE_POLL_MS = 700;
const STEP_MARK = { ok: "✓", failed: "✗", timeout: "⏱", cancelled: "■", skipped: "–", running: "…", idle: "○", abandoned: "⚠" };
const LINE_LEVEL = [["error", /\b(error|exception|traceback|failed|fatal)\b/i], ["warn", /\bwarn(ing)?\b|^retrying in /i]];

// "1:15", or "1:02:03" past an hour.
function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const two = (n) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

// A step in the flow row: mark (never color alone), number and name, its kind, its last duration, and Only this.
function stepItem({ name, n, id, type, seconds, enabled, onlyThis }) {
  const mark = h("span", { class: "pipe-mark", "aria-hidden": "true" }, STEP_MARK.idle);
  const state = h("span", { class: "sr-only" }, ` (${t("pipe.s.idle")})`);
  const time = h("span", { class: "muted" }, seconds == null ? "" : ` ${R.fmtDecimal(seconds, 1)} s`);
  const onlyLabel = t("pipe.onlyLabel", { n, step: name });
  const only = h("button", { type: "button", class: "link", disabled: !enabled, "aria-label": onlyLabel }, t("pipe.only"));
  only.addEventListener("click", () => onlyThis(n, name));
  const kind = type ? h("span", { class: "pipe-kind" }, t(`pipe.type.${type}`)) : null;
  const label = h("span", null, `${n}. ${name}`);
  const li = h("li", { "data-status": "idle", "data-id": id || String(n) }, mark, " ", label, state, " ", kind, time, " ", only);
  li.setStatus = (status) => {
    li.setAttribute("data-status", status);
    mark.textContent = STEP_MARK[status] || "?";
    state.textContent = ` (${t(`pipe.s.${status}`)})`;
  };
  li.setSeconds = (s) => { time.textContent = s == null ? "" : ` ${R.fmtDecimal(s, 1)} s`; };
  return li;
}

function consoleTools(out, lines, stepNames) {
  const copy = h("button", { type: "button" }, t("pipe.copy"));
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(out.textContent);
      copy.textContent = t("pipe.copied");
    } catch (_) {
      copy.textContent = t("pipe.copyFailed");
    }
    setTimeout(() => { copy.textContent = t("pipe.copy"); }, 1500);
  });
  const clear = h("button", { type: "button" }, t("pipe.clear"));
  clear.addEventListener("click", () => { out.replaceChildren(); lines.length = 0; });
  const first = h("button", { type: "button", disabled: true }, t("pipe.firstError"));
  first.addEventListener("click", () => {
    const e = lines.find((l) => l.getAttribute("data-level") === "error");
    if (!e) return;
    e.setAttribute("tabindex", "-1");
    e.focus();
    if (e.scrollIntoView) e.scrollIntoView({ block: "center" });
  });
  const options = [h("option", { value: "" }, t("pipe.allSteps")), ...stepNames.map((n, i) => h("option", { value: String(i) }, n))];
  const filter = h("select", { "aria-label": t("pipe.showLines") }, options);
  filter.addEventListener("change", (ev) => {
    const v = ev.target.value;
    for (const l of lines) l.hidden = Boolean(v) && l.getAttribute("data-step") !== v;
  });
  const follow = h("input", { type: "checkbox", checked: true });
  follow.checked = true;
  follow.addEventListener("change", (ev) => { follow.checked = ev.target.checked; });
  const tools = h("div", { class: "actions" }, filter, first, h("label", null, follow, " ", t("pipe.follow")), copy, clear);
  return { tools, first, filter, follow };
}

// The console of one card. `add(e)` appends a line event; `reset()` empties it for another run.
function pipeConsole(stepNames) {
  const out = h("pre", { class: "console", role: "log", "aria-label": t("pipe.console") });
  const lines = [];
  const { tools, first, filter, follow } = consoleTools(out, lines, stepNames);
  const box = h("div", { class: "pipe-console", hidden: true }, tools, out);
  const add = (e) => {
    const level = (LINE_LEVEL.find(([, re]) => re.test(e.text)) || ["info"])[0];
    const span = h("span", { "data-step": String(e.step), "data-level": level });
    span.append(document.createTextNode(`[${e.name}] ${e.text}\n`));
    span.hidden = Boolean(filter.value) && filter.value !== String(e.step);
    lines.push(span);
    out.append(span);
    if (level === "error") { first.removeAttribute("disabled"); first.disabled = false; }
    if (follow.checked) out.scrollTop = out.scrollHeight;
  };
  const reset = () => {
    out.replaceChildren();
    lines.length = 0;
    first.setAttribute("disabled", "");
    first.disabled = true;
    box.hidden = false;
  };
  return { box, add, reset };
}

// The end of a run: a notice on the page, the tab title marked while the page is hidden, a desktop notice if allowed.
let pipeTitle = null;
function pipeNotice(name, status, seconds) {
  const mark = STEP_MARK[status] || "?";
  const text = `${mark} ${t("pipe.notice", { name, status: t(`pipe.s.${status}`), seconds: R.fmtDecimal(seconds, 1) })}`;
  const host = document.getElementById("toasts");
  const toast = h("div", { class: `toast toast-${status === "ok" ? "ok" : "bad"}`, role: "status" }, text);
  host.append(toast);
  setTimeout(() => toast.remove && toast.remove(), 8000);
  if (!document.hidden) return;
  if (pipeTitle === null) pipeTitle = document.title;
  document.title = `${mark} ${name} · ${pipeTitle}`;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification(text); } catch (_) { /* a notice is a convenience */ }
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && pipeTitle !== null) { document.title = pipeTitle; pipeTitle = null; }
});

// Cancel: says it is cancelling, and shows why if the server refuses.
function cancelButton(pr, run, actions) {
  const stop = h("button", { type: "button" }, t("pipe.cancel"));
  stop.addEventListener("click", async () => {
    stop.setAttribute("disabled", "");
    stop.disabled = true;
    stop.textContent = t("pipe.cancelling");
    const failed = (e) => ({ ok: false, data: { error: e.message } });
    const res = await postJson("/api/pipelines/cancel", { project: pr.path, run }).catch(failed);
    if (!res.ok) actions.append(h("p", { class: "warn", role: "alert" }, `▲ ${ts(res.data.error || "")}`));
  });
  return stop;
}

// Show a run: the step marks, durations and console, polling its events until it ends. `live` is a run started from
// this page (a cancel button, the timer, a notice at the end); otherwise a past run is replayed into the console.
function followRun(pr, p, run, parts, live = true) {
  const { items, con, line, actions, idle } = parts;
  const mine = (parts.token = (parts.token || 0) + 1); // a newer follow on this card, or leaving the page, ends this one
  const current = () => parts.token === mine && parts.card?.isConnected !== false;
  if (live) actions.replaceChildren(cancelButton(pr, run, actions));
  items.forEach((li) => { li.setStatus("idle"); li.setSeconds(null); });
  // A step by its id (the pipeline may have been reordered since an old run); by its index for runs without ids.
  const itemFor = (e) => (e.id && items.find((li) => li.getAttribute("data-id") === e.id)) || items[e.step];
  con.reset();
  const began = Date.now();
  let cursor = 0; // a byte offset into the run's events file, returned by the server as `next`
  const poll = async () => {
    if (!current()) return;
    let r;
    try {
      r = await api("pipelines/events", { project: pr.path, run, after: cursor });
    } catch (_) {
      setTimeout(poll, PIPE_POLL_MS * 3); // the server may be restarting: try again later
      return;
    }
    if (!current()) return;
    cursor = r.next ?? cursor;
    for (const e of r.events) {
      if (e.kind === "line") con.add(e);
      const li = itemFor(e);
      if (e.kind === "step-start" && li) li.setStatus("running");
      if (e.kind === "step-end" && li) {
        li.setStatus(e.status);
        li.setSeconds(e.status === "skipped" ? null : e.seconds);
      }
      if (e.kind === "run-end") {
        line.textContent = t("pipe.ended", { status: t(`pipe.s.${e.status}`), seconds: R.fmtDecimal(e.seconds, 1) });
        if (live) { pipeNotice(p.name, e.status, e.seconds); if (parts.refresh) parts.refresh(); }
      }
    }
    if (r.done) {
      if (r.error) line.textContent = `▲ ${ts(r.error)}`;
      if (live) {
        idle();
        if (r.error && parts.refresh) parts.refresh(); // an abandoned run ends here, without a run-end event
      }
      return;
    }
    if (live) {
      const elapsed = fmtClock((Date.now() - began) / 1000);
      line.textContent = p.typical ? t("pipe.runningUsual", { elapsed, typical: fmtClock(p.typical) }) : t("pipe.runningFor", { elapsed });
    }
    setTimeout(poll, PIPE_POLL_MS);
  };
  poll();
}
