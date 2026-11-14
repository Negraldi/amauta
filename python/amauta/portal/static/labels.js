"use strict";
// Labels for the raw values the server sends (T15 class 4): enum words in a page's details (memory type, scope, hook type, MCP
// transport), graph relation names and kinds. An unknown value is shown as sent. Shares the globals of app.js (enumLabel, t, I).

// (page kind, detail label) -> dictionary prefix of that value's labels. "*" matches every page kind.
const META_ENUMS = {
  memory: { Type: "memtype", Scope: "memscope", Source: "memsource" },
  hook: { "Hook type": "hooktype", Scope: "scope" },
  mcp: { Type: "transport" },
  "*": { Scope: "scope" },
};
// The label of one detail value, or null when that detail is free text.
function metaEnumLabel(kind, label, value) {
  if (kind === "node" && label === "Kind") return nodeKind(value);
  if (label === "Models" && typeof value === "string") return groupDigits(modelsText(value));
  const prefix = (META_ENUMS[kind] || {})[label] || META_ENUMS["*"][label];
  return prefix && typeof value === "string" ? enumLabel(prefix, value) : null;
}

// ---- graph relations (D7) -----------------------------------------------------------------------------------------------
const humanRelation = (rel) => String(rel).replace(/_/g, " ");
// A relation name inside a table cell or a diagram edge: lower-case words.
const edgeRelation = (rel) => (`rel.edge.${rel}` in I.dict.en ? t(`rel.edge.${rel}`) : humanRelation(rel));
// "Imported by" / "Calls": a relation seen from the node it points to (incoming) or from (outgoing). Unknown: the words and the direction.
function relationHeading(rel, direction) {
  const key = `rel.${direction === "incoming" ? "in" : "out"}.${rel}`;
  return key in I.dict.en ? t(key) : `${humanRelation(rel)} (${t(`rel.dir.${direction === "incoming" ? "incoming" : "outgoing"}`)})`;
}
// A diagram's Mermaid source as the server builds it (raw relation names on the edges, "(kind)" after a node label), in the UI language.
// Parentheses are entity codes there (#40; #41;), as the server writes every label syntax character.
function localizeGraphSource(source) {
  return String(source)
    .replace(/-->\|"([\w-]+)"\|/g, (m, rel) => `-->|"${edgeRelation(rel)}"|`)
    .replace(/ #40;([\w-]+)#41;"\]/g, (m, kind) => ` #40;${nodeKind(kind)}#41;"]`);
}

// ---- models (A5, D15) ---------------------------------------------------------------------------------------------------
// "<synthetic>" is what Claude Code records for a message it wrote itself: not a model.
const modelName = (v) => (v === "<synthetic>" ? t("model.synthetic") : v ?? "-");
// A list of "model (count)" the server joined with commas, with the synthetic one labelled.
const modelsText = (v) => String(v).replace(/<synthetic>/g, t("model.synthetic"));

// The persona as Settings spells it ("Gentleman"), on every page that names it (E6).
const personaLabel = (v) => (v === "gentleman" || v === "neutral" ? t(`set.${v}`) : v || "-");

// A pipeline mode: "process" and "preview" are words; any other name is the user's own and stays as written (D16).
const modeName = (m) => enumLabel("pipemode", m);

// ---- explanation notes (C6) -----------------------------------------------------------------------------------------------
// The agent writes a note in English with fixed headings. Those are shown in the UI language, and the first two get words of their own
// so the page does not carry "What it does" twice (the portal's summary above already has it).
const EXPLAIN_HEADINGS = { "what it does": "explain.h.what", "when it runs": "explain.h.when", "when claude uses it": "explain.h.when",
  "worth knowing": "explain.h.worth" };
function localizeExplain(md) {
  const heading = (m, hashes, title) => {
    const key = EXPLAIN_HEADINGS[title.toLowerCase()];
    return key ? `${hashes} ${t(key)}` : m;
  };
  const basedOn = (m, mark) => `${mark || ""}${t("explain.basedOn")}`;
  return String(md).replace(/^(#{1,6})[ \t]+(.+?)[ \t]*$/gm, heading).replace(/^(_|\*)?Based on:/gm, basedOn);
}

// ---- cutting long text (C12) ---------------------------------------------------------------------------------------------------
// At most `max` characters, ending on a sentence when one ends in the second half of the cut, else on a word with an ellipsis.
function clipText(text, max) {
  const s = String(text);
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (stop >= max / 2) return head.slice(0, stop + 1);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[,;:\s]+$/, "")}…`;
}
