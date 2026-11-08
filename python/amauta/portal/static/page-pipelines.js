"use strict";
// Pipelines (#/pipelines, plan S1b, ADR 0010): a project's pipelines as cards; a run asks first, starts as a separate
// process on the server and its output arrives in a live console by polling the run's events. Output is text only.
// Category pills, a search, run-one-step, the flow row and the last run's duration and trigger: plan S1b'.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

const PIPE_POLL_MS = 700;
const STEP_MARK = { ok: "✓", failed: "✗", timeout: "⏱", cancelled: "■", skipped: "–", running: "…", idle: "○" };

const pipeFilter = { category: "", query: "" };

async function viewPipelines() {
  const d = await api("pipelines");
  if (!d.available) return [teach(t("nav.pipelines"), t("pipe.notInstalled"))];
  if (!d.projects.length) return [pageHead(t("nav.pipelines")), empty(codeSpans(t("pipe.none")))];
  const sections = d.projects.map(projectPipelines);
  return [pageHead(t("nav.pipelines"), t("pipe.lead")), pipeControls(d.projects, sections), ...sections];
}

// Category pills with counts and a search over names, descriptions and step names (the cards stay; they are hidden).
function pipeControls(projects, sections) {
  const all = projects.flatMap((pr) => pr.pipelines);
  const cats = [...new Set(all.map((p) => p.category).filter(Boolean))].sort();
  const count = (c) => all.filter((p) => !c || p.category === c).length;
  const pills = ["", ...cats].map((c) => h("button", { type: "button", "aria-pressed": String(pipeFilter.category === c),
    onclick: () => { pipeFilter.category = c; apply(); } }, `${c || t("pipe.all")} (${fmt(count(c))})`));
  const search = h("input", { type: "search", "aria-label": t("pipe.search"), placeholder: t("pipe.search"), value: pipeFilter.query,
    oninput: (e) => { pipeFilter.query = e.target.value; apply(); } });
  const apply = () => {
    ["", ...cats].forEach((c, i) => pills[i].setAttribute("aria-pressed", String(pipeFilter.category === c)));
    const q = pipeFilter.query.trim().toLowerCase();
    for (const sec of sections) {
      for (const card of sec.cards) {
        const p = card.pipeline;
        const text = [p.name, p.description, ...p.steps].join(" ").toLowerCase();
        card.hidden = Boolean((pipeFilter.category && p.category !== pipeFilter.category) || (q && !text.includes(q)));
      }
      sec.hidden = sec.cards.every((c) => c.hidden);
    }
  };
  queueMicrotask(apply);
  const group = cats.length ? h("div", { class: "segmented", role: "group", "aria-label": t("pipe.category") }, pills) : null;
  return h("div", { class: "controls" }, group, search);
}

function projectPipelines(pr) {
  const cards = pr.pipelines.map((p) => pipelineCard(pr, p));
  const sec = h("section", { class: "page-section" }, h("h2", null, pr.name), h("p", { class: "muted tok" }, pr.path),
    pr.error ? h("p", { class: "warn" }, `▲ ${ts(pr.error)}`) : null,
    pr.trusted ? null : h("p", { class: "muted" }, codeSpans(t("pipe.untrusted"))),
    h("div", { class: "pipe-cards" }, cards));
  sec.cards = cards;
  return sec;
}

// A step in the flow row: its mark (never color alone), its name and a button that runs only it.
function stepItem(name, n, onlyThis, enabled) {
  const mark = h("span", { class: "pipe-mark", "aria-hidden": "true" }, STEP_MARK.idle);
  const label = h("span", null, `${n}. ${name}`);
  const state = h("span", { class: "sr-only" }, t("pipe.s.idle"));
  const onlyLabel = t("pipe.onlyLabel", { n, step: name });
  const only = h("button", { type: "button", class: "link", disabled: !enabled, "aria-label": onlyLabel }, t("pipe.only"));
  only.addEventListener("click", () => onlyThis(n, name));
  const li = h("li", { "data-status": "idle" }, mark, " ", label, state, " ", only);
  li.setStatus = (status) => {
    li.setAttribute("data-status", status);
    mark.textContent = STEP_MARK[status] || "?";
    state.textContent = ` (${t(`pipe.s.${status}`)})`;
  };
  return li;
}

function lastRunText(last) {
  if (!last) return t("pipe.never");
  const base = { status: t(`pipe.s.${last.status}`), at: R.fmtDateTime(last.started) };
  if (last.seconds == null || !last.trigger) return t("pipe.last", base);
  return t("pipe.lastFull", { ...base, seconds: R.fmtDecimal(last.seconds, 1), trigger: t(`pipe.t.${last.trigger}`) });
}

// The console with its own Copy and Clear (output is text only, never markup).
function pipeConsole() {
  const out = h("pre", { class: "console", role: "log", "aria-label": t("pipe.console") });
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
  clear.addEventListener("click", () => out.replaceChildren());
  const box = h("div", { class: "pipe-console", hidden: true }, h("div", { class: "actions" }, copy, clear), out);
  return { box, out };
}

function pipelineCard(pr, p) {
  const { box, out } = pipeConsole();
  const line = h("p", { class: "muted" }, lastRunText(p.last));
  const actions = h("div", { class: "actions" });
  const items = p.steps.map((name, i) => stepItem(name, i + 1, (n, step) => ask(n, step), pr.trusted));
  const head = h("h3", null, p.name);
  const card = h("article", { class: "pipe-card" }, p.category ? h("span", { class: "badge" }, p.category) : null, head,
    p.description ? h("p", null, p.description) : null, h("ol", { class: "pipe-steps", "aria-label": t("pipe.steps") }, items),
    line, actions, box);
  card.pipeline = p;
  const follow = (run) => followRun(pr, run, { items, out, box, line, actions, idle });
  const idle = () => {
    const run = h("button", { type: "button", class: "primary", disabled: !pr.trusted }, t("pipe.run"));
    run.addEventListener("click", () => ask(null));
    actions.replaceChildren(run);
  };
  const ask = (n, step) => {
    const yes = h("button", { type: "button", class: "primary" }, t("pipe.runNow"));
    const no = h("button", { type: "button" }, t("common.goBack"));
    yes.addEventListener("click", () => start(n));
    no.addEventListener("click", idle);
    const question = n ? t("pipe.confirmStep", { n, step, name: p.name }) : t("pipe.confirm", { name: p.name });
    actions.replaceChildren(h("p", null, question), yes, no);
    yes.focus();
  };
  const start = async (n) => {
    actions.replaceChildren(h("p", { role: "status", class: "muted" }, t("pipe.starting")));
    const failed = (err) => ({ ok: false, data: { error: String(err.message || err) } });
    const body = n ? { project: pr.path, id: p.id, step: n } : { project: pr.path, id: p.id };
    const res = await postJson("/api/pipelines/run", body).catch(failed);
    if (!res.ok) { actions.replaceChildren(h("p", { class: "warn", role: "alert" }, `▲ ${ts(res.data.error || "")}`)); return; }
    follow(res.data.run);
  };
  idle();
  if (p.last && p.last.status === "running") follow(p.last.run);
  return card;
}

// Show a run as it happens: a cancel button, the step marks and the console, polling the run's events until it ends.
function followRun(pr, run, { items, out, box, line, actions, idle }) {
  const stop = h("button", { type: "button" }, t("pipe.cancel"));
  stop.addEventListener("click", () => postJson("/api/pipelines/cancel", { project: pr.path, run }).catch(() => {}));
  actions.replaceChildren(stop);
  items.forEach((li) => li.setStatus("idle"));
  box.hidden = false;
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
