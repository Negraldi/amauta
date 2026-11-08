"use strict";
// Pipelines (#/pipelines, plan S1b, ADR 0010): a project's pipelines as cards; a run asks first, starts as a separate
// process on the server and its output arrives in a live console by polling the run's events. Output is text only.
// Plan S1b': a summary line, category pills and a search, the flow row with Only this, recent runs as marks, the first
// failure, outputs, the schedule and its state, and Check. The run side is in page-pipeline-run.js.
// Part of the portal UI split by page (plan N11); shares the globals of app.js, loaded before boot.js.

const pipeFilter = { category: "", query: "" };

async function viewPipelines() {
  const d = await api("pipelines");
  if (!d.available) return [teach(t("nav.pipelines"), t("pipe.notInstalled"))];
  if (!d.projects.length) return [pageHead(t("nav.pipelines")), empty(codeSpans(t("pipe.none")))];
  const sections = d.projects.map(projectPipelines);
  return [pageHead(t("nav.pipelines"), t("pipe.lead")), pipeSummary(d.projects), pipeControls(d.projects, sections), ...sections];
}

// "3 pipelines · 1 failed last time · 1 running · 1 missed a scheduled run": only the parts that are not zero.
function pipeSummaryText(projects) {
  const all = projects.flatMap((pr) => pr.pipelines);
  const count = (f) => all.filter(f).length;
  const parts = [[all.length, all.length === 1 ? "pipe.sumOne" : "pipe.sumTotal"],
    [count((p) => p.last && ["failed", "timeout", "abandoned"].includes(p.last.status)), "pipe.sumFailed"],
    [count((p) => p.last && p.last.status === "running"), "pipe.sumRunning"],
    [count((p) => (p.schedules || []).some((sc) => sc.state === "missed")), "pipe.sumMissed"]];
  return parts.filter(([n], i) => i === 0 || n).map(([n, key]) => t(key, { n: fmt(n) })).join(" · ");
}

function pipeSummary(projects) {
  return h("p", { class: "pipe-summary", role: "status" }, pipeSummaryText(projects));
}

// The home page's rail: the same summary with a link, when any project has pipelines (null otherwise).
async function pipelinesRail() {
  const d = await api("pipelines").catch(() => null);
  if (!d || !d.available || !d.projects.length) return null;
  return h("div", null, h("p", null, pipeSummaryText(d.projects)), h("a", { href: "#/pipelines" }, t("pipe.open")));
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
  const notify = typeof Notification !== "undefined" && Notification.permission === "default"
    ? h("button", { type: "button", onclick: (e) => { Notification.requestPermission(); e.target.hidden = true; } }, t("pipe.notify"))
    : null;
  return h("div", { class: "controls" }, group, search, notify);
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

function lastRunText(last) {
  if (!last) return t("pipe.never");
  const base = { status: t(`pipe.s.${last.status}`), at: R.fmtDateTime(last.started) };
  if (last.seconds == null || !last.trigger) return t("pipe.last", base);
  return t("pipe.lastFull", { ...base, seconds: R.fmtDecimal(last.seconds, 1), trigger: t(`pipe.t.${last.trigger}`) });
}

// "Mondays, Thursdays at 07:30", "On day 1 of each month at 06:00", "Every 30 minutes".
function scheduleText(s) {
  const n = s.every_minutes;
  if (n) return n < 60 ? t("pipe.sched.minutes", { n }) : n === 60 ? t("pipe.sched.hour") : t("pipe.sched.hours", { n: n / 60 });
  if (s.days) return t("pipe.sched.days", { days: s.days.map((d) => t(`pipe.day.${d}`)).join(", "), at: s.at });
  if (s.day_of_month) return t("pipe.sched.month", { day: s.day_of_month, at: s.at });
  return t("pipe.sched.daily", { at: s.at });
}

// One line per schedule: when, the mode it runs in, and whether its last run happened.
function scheduleLines(p) {
  return (p.schedules || []).map((sc) => {
    const state = sc.state === "missed" ? h("span", { class: "warn" }, ` ▲ ${t("pipe.missed")}`)
      : sc.state === "never" ? h("span", { class: "muted" }, " ", codeSpans(t("pipe.neverScheduled", { id: p.id }))) : null;
    return h("p", null, `⏲ ${scheduleText(sc)}${sc.mode ? ` · ${sc.mode}` : ""}.`, state);
  });
}

// The steps by level: a level's steps need only earlier levels, so they may run side by side (ADR 0011).
function flowRow(p, items) {
  const ids = p.ids || p.steps.map((_, i) => String(i));
  const levels = p.levels || [ids];
  const cols = levels.map((level) => h("ol", { class: "pipe-level" }, level.map((id) => items[ids.indexOf(id)])));
  return h("div", { class: "pipe-steps", role: "group", "aria-label": t("pipe.steps") }, cols);
}

// The mode picker; `apply(mode)` marks the steps outside it.
function modePicker(p, apply) {
  if (!p.modes || !p.modes.length) return null;
  const pick = h("select", { "aria-label": t("pipe.mode") }, p.modes.map((m) => h("option", { value: m }, m)));
  pick.value = p.default_mode;
  pick.addEventListener("change", (e) => apply(e.target.value));
  return h("label", { class: "pipe-mode" }, `${t("pipe.mode")} `, pick);
}

// Recent runs as marks, oldest first; a mark replays that run in the console.
function historyStrip(p, open) {
  if (!p.history || !p.history.length) return null;
  const marks = [...p.history].reverse().map((r) => {
    const label = t("pipe.histLabel", { status: t(`pipe.s.${r.status}`), at: R.fmtDateTime(r.started),
      seconds: r.seconds == null ? "?" : R.fmtDecimal(r.seconds, 1), trigger: t(`pipe.t.${r.trigger}`) }) + (r.mode ? ` · ${r.mode}` : "");
    const attrs = { type: "button", class: "hist-mark", "data-status": r.status, "aria-label": label, title: label };
    const b = h("button", attrs, STEP_MARK[r.status] || "?");
    b.addEventListener("click", () => open(r.run));
    return h("li", null, b);
  });
  return h("div", { class: "pipe-history" }, h("span", { class: "muted" }, `${t("pipe.history")}: `),
    h("ol", { "aria-label": t("pipe.history") }, marks));
}

function lastDetails(p) {
  const r = p.history && p.history[0];
  if (!r) return [];
  const bad = r.steps.find((s) => s.status === "failed" || s.status === "timeout");
  const failure = bad && r.failure ? h("p", { class: "warn" }, `▲ ${t("pipe.failedAt", { step: bad.name, text: r.failure })}`) : null;
  const size = (b) => (b >= 1048576 ? `${R.fmtDecimal(b / 1048576, 1)} MB` : b >= 1024 ? `${R.fmtDecimal(b / 1024, 1)} KB` : `${fmt(b)} B`);
  const outputs = r.outputs && r.outputs.length ? h("p", { class: "muted" }, `${t("pipe.outputs")} `,
    r.outputs.flatMap((o, i) => [i ? ", " : "", h("code", null, o.path), ` (${size(o.bytes)}, ${R.fmtDateTime(o.modified)})`])) : null;
  return [failure, outputs];
}

function checkButton(pr, p, result) {
  const b = h("button", { type: "button" }, t("pipe.check"));
  b.addEventListener("click", async () => {
    result.replaceChildren(h("p", { class: "muted", role: "status" }, t("pipe.checking")));
    const r = await api("pipelines/check", { project: pr.path, id: p.id }).catch((e) => ({ error: e.message }));
    if (r.error) { result.replaceChildren(h("p", { class: "warn", role: "status" }, `▲ ${ts(r.error)}`)); return; }
    const item = (f) => (f.level === "error" ? h("li", { class: "warn" }, `✗ ${f.step}: ${f.message}`)
      : h("li", { class: "muted" }, `ℹ ${f.step}: ${f.message}`));
    const found = r.findings.map(item);
    result.replaceChildren(found.length ? h("ul", { role: "status" }, found) : h("p", { role: "status" }, `✓ ${t("pipe.checkOk")}`));
  });
  return b;
}

function pipelineCard(pr, p) {
  const con = pipeConsole(p.steps);
  const line = h("p", { class: "muted" }, lastRunText(p.last));
  const actions = h("div", { class: "actions" });
  const checked = h("div", { class: "pipe-check" });
  const last = p.history && p.history[0] && p.history[0].steps;
  const ids = p.ids || [];
  const byId = (i) => last.find((st) => st.id && st.id === ids[i]) || (last[i] && !last[i].id ? last[i] : null); // older runs: no id
  const recent = last && p.steps.map((_, i) => byId(i));
  const items = p.steps.map((name, i) => stepItem({ name, n: i + 1, id: (p.ids || [])[i], type: (p.types || [])[i], enabled: pr.trusted,
    seconds: recent && recent[i] && recent[i].status !== "skipped" ? recent[i].seconds : null, onlyThis: (n, step) => ask(n, step) }));
  if (recent) recent.forEach((st, i) => st && items[i] && items[i].setStatus(st.status));
  let mode = p.default_mode || null;
  const applyMode = (m) => {
    mode = m;
    const outside = (i) => Boolean(m && p.step_modes && p.step_modes[i] && !p.step_modes[i].includes(m));
    items.forEach((li, i) => li.setAttribute("data-off", String(outside(i))));
  };
  applyMode(mode);
  const parts = { items, con, line, actions, idle: () => idle() };
  const card = h("article", { class: "pipe-card" }, p.category ? h("span", { class: "badge" }, p.category) : null, h("h3", null, p.name),
    p.description ? h("p", null, p.description) : null, modePicker(p, applyMode), flowRow(p, items), ...scheduleLines(p), line,
    ...lastDetails(p), historyStrip(p, (run) => followRun(pr, p, run, parts, false)), actions, checked, con.box);
  card.pipeline = p;
  parts.card = card;
  const idle = () => {
    const run = h("button", { type: "button", class: "primary", disabled: !pr.trusted }, t("pipe.run"));
    run.addEventListener("click", () => ask(null));
    actions.replaceChildren(run, checkButton(pr, p, checked));
  };
  const ask = (n, step) => {
    const yes = h("button", { type: "button", class: "primary" }, t("pipe.runNow"));
    const no = h("button", { type: "button" }, t("common.goBack"));
    yes.addEventListener("click", () => start(n));
    no.addEventListener("click", idle);
    const question = n ? t("pipe.confirmStep", { n, step, name: p.name })
      : mode ? t("pipe.confirmMode", { name: p.name, mode }) : t("pipe.confirm", { name: p.name });
    actions.replaceChildren(h("p", null, question), yes, no);
    yes.focus();
  };
  const start = async (n) => {
    actions.replaceChildren(h("p", { role: "status", class: "muted" }, t("pipe.starting")));
    const failed = (err) => ({ ok: false, data: { error: String(err.message || err) } });
    const body = n ? { project: pr.path, id: p.id, step: n } : { project: pr.path, id: p.id, ...(mode ? { mode } : {}) };
    const res = await postJson("/api/pipelines/run", body).catch(failed);
    if (res.ok) { followRun(pr, p, res.data.run, parts); return; }
    const back = h("button", { type: "button" }, t("common.goBack"));
    back.addEventListener("click", idle);
    actions.replaceChildren(h("p", { class: "warn", role: "alert" }, `▲ ${ts(res.data.error || "")}`), back);
  };
  idle();
  if (p.last && p.last.status === "running") followRun(pr, p, p.last.run, parts);
  return card;
}
