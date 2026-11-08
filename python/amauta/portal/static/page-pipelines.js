"use strict";
// Pipelines (#/pipelines, plan S1b, ADR 0010): a project's pipelines as cards; a run asks first, starts as a separate
// process on the server and its output arrives in a live console by polling the run's events. Output is text only.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

const PIPE_POLL_MS = 700;
const STEP_MARK = { ok: "✓", failed: "✗", timeout: "⏱", cancelled: "■", skipped: "–", running: "…", idle: "○" };

async function viewPipelines() {
  const d = await api("pipelines");
  if (!d.available) return [teach(t("nav.pipelines"), t("pipe.notInstalled"))];
  if (!d.projects.length) return [pageHead(t("nav.pipelines")), empty(codeSpans(t("pipe.none")))];
  return [pageHead(t("nav.pipelines"), t("pipe.lead")), ...d.projects.map(projectPipelines)];
}

function projectPipelines(pr) {
  return h("section", { class: "page-section" }, h("h2", null, pr.name), h("p", { class: "muted tok" }, pr.path),
    pr.error ? h("p", { class: "warn" }, `▲ ${ts(pr.error)}`) : null,
    pr.trusted ? null : h("p", { class: "muted" }, codeSpans(t("pipe.untrusted"))),
    h("div", { class: "pipe-cards" }, pr.pipelines.map((p) => pipelineCard(pr, p))));
}

function stepItem(name) {
  const li = h("li", { "data-status": "idle" }, `${STEP_MARK.idle} ${name}`);
  li.setStatus = (status) => { li.setAttribute("data-status", status); li.textContent = `${STEP_MARK[status] || "?"} ${name}`; };
  return li;
}

function pipelineCard(pr, p) {
  const items = p.steps.map(stepItem);
  const out = h("pre", { class: "console", role: "log", "aria-label": t("pipe.console"), hidden: true });
  const lastRun = p.last ? t("pipe.last", { status: t(`pipe.s.${p.last.status}`), at: R.fmtDateTime(p.last.started) }) : t("pipe.never");
  const line = h("p", { class: "muted" }, lastRun);
  const actions = h("div", { class: "actions" });
  const card = h("article", { class: "pipe-card" }, h("h3", null, p.name), p.description ? h("p", null, p.description) : null,
    h("ol", { class: "pipe-steps" }, items), line, actions, out);
  const follow = (run) => followRun(pr, run, { items, out, line, actions, idle });
  const idle = () => {
    const run = h("button", { type: "button", class: "primary", disabled: !pr.trusted }, t("pipe.run"));
    run.addEventListener("click", ask);
    actions.replaceChildren(run);
  };
  const ask = () => {
    const yes = h("button", { type: "button", class: "primary" }, t("pipe.runNow"));
    const no = h("button", { type: "button" }, t("common.goBack"));
    yes.addEventListener("click", start);
    no.addEventListener("click", idle);
    actions.replaceChildren(h("p", null, t("pipe.confirm", { name: p.name })), yes, no);
  };
  const start = async () => {
    actions.replaceChildren(h("p", { role: "status", class: "muted" }, t("pipe.starting")));
    const failed = (err) => ({ ok: false, data: { error: String(err.message || err) } });
    const res = await postJson("/api/pipelines/run", { project: pr.path, id: p.id }).catch(failed);
    if (!res.ok) { actions.replaceChildren(h("p", { class: "warn", role: "alert" }, `▲ ${ts(res.data.error || "")}`)); return; }
    follow(res.data.run);
  };
  idle();
  if (p.last && p.last.status === "running") follow(p.last.run);
  return card;
}

// Show a run as it happens: a cancel button, the step marks and the console, polling the run's events until it ends.
function followRun(pr, run, { items, out, line, actions, idle }) {
  const stop = h("button", { type: "button" }, t("pipe.cancel"));
  stop.addEventListener("click", () => postJson("/api/pipelines/cancel", { project: pr.path, run }).catch(() => {}));
  actions.replaceChildren(stop);
  items.forEach((li) => li.setStatus("idle"));
  out.removeAttribute("hidden");
  out.replaceChildren();
  line.textContent = t("pipe.s.running");
  let seen = 0;
  const poll = async () => {
    let r;
    try {
      r = await api("pipelines/events", { project: pr.path, run, after: seen });
    } catch (_) {
      setTimeout(poll, PIPE_POLL_MS * 3); // the server may be restarting: try again later
      return;
    }
    for (const e of r.events) {
      seen++;
      if (e.kind === "line") out.append(document.createTextNode(`[${e.name}] ${e.text}\n`));
      if (e.kind === "step-start") items[e.step]?.setStatus("running");
      if (e.kind === "step-end") items[e.step]?.setStatus(e.status);
      const ended = () => t("pipe.ended", { status: t(`pipe.s.${e.status}`), seconds: R.fmtDecimal(e.seconds, 1) });
      if (e.kind === "run-end") line.textContent = ended();
    }
    if (r.done) { idle(); return; }
    setTimeout(poll, PIPE_POLL_MS);
  };
  poll();
}
