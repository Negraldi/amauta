"use strict";
// Portal text in English and Spanish. Three layers, used consistently:
//   t(key, params)   portal chrome written in app.js (labels, headings, buttons, empty states, errors): keys in i18n/en.json and es.json.
//   tn(key, n, ...)  plurals: key.one / key.other.
//   ts(text)         text the SERVER sends. The Python side stays English and authoritative (page meta labels, section headings, notes, lint
//                    titles, refusals ...). The client translates it by its exact English text through the catalog i18n/srv-es.json, where `{name}`
//                    stands for a variable part of the sentence. Text that is not in the catalog (user content, new server text) is shown as sent.
//                    A test pins the catalog against the strings defined in python/amauta/portal.
// Missing keys fall back to English, then to the key itself. User content (memories, SKILL.md, ODD documents, file names) is never translated.
// Dates are never localized (YYYY-MM-DD, YYYY-MM-DD HH:MM everywhere); numbers follow the locale chosen here through wikiroute.js.
(function () {
  // The dictionaries are data, one JSON file each (plan N11b): i18n/en.json, i18n/es.json and i18n/srv-es.json (the server
  // catalog). boot.js waits for load() before the first render; until then t() shows keys.
  const dict = { en: {}, es: {}, srv: {} };
  const en = dict.en, srv = dict.srv;
  const FILES = { en: "en.json", es: "es.json", srv: "srv-es.json" };
  function install(d) {
    for (const k of Object.keys(FILES)) if (d && d[k]) Object.assign(dict[k], d[k]);
    templates = null;
  }
  async function load(fetchFn) {
    const get = async (f) => { const r = await fetchFn(`/static/i18n/${f}`); return r.ok ? r.json() : {}; };
    const parts = await Promise.all(Object.values(FILES).map((f) => get(f).catch(() => ({}))));
    install(Object.fromEntries(Object.keys(FILES).map((k, i) => [k, parts[i]])));
  }
  const LANGS = ["en", "es"];
  const KEY = "amauta-lang";
  let current = "en";

  const fill = (s, params) => String(s).replace(/\{(\w+)\}/g, (m, name) => (params && Object.prototype.hasOwnProperty.call(params, name) && params[name] != null ? String(params[name]) : m));
  function t(key, params) {
    const text = Object.prototype.hasOwnProperty.call(dict[current], key) ? dict[current][key] : Object.prototype.hasOwnProperty.call(en, key) ? en[key] : key;
    return fill(text, params);
  }
  function tn(key, n, params) {
    const form = Number(n) === 1 ? "one" : "other";
    const k = `${key}.${form}`;
    return t(Object.prototype.hasOwnProperty.call(en, k) ? k : `${key}.other`, params);
  }

  // Placeholders that stand for counts match digits only, so a template such as "{n} calls" or "{done} of {total}" never rewrites ordinary text.
  const NUMERIC = new Set(["n", "m", "done", "total", "days", "nodes", "edges"]);
  // Templates of the server catalog, compiled once: the English text with {x} turned into a lazy capture, anchored at both ends.
  let templates = null;
  function compile() {
    templates = Object.keys(srv).filter((k) => /\{\w+\}/.test(k)).sort((a, b) => b.length - a.length).map((k) => {
      const names = [];
      const source = k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, (m, name) => { names.push(name); return NUMERIC.has(name) ? "(\\d+)" : "(.+?)"; });
      return { re: new RegExp(`^${source}$`, "s"), names, to: srv[k] };
    });
  }
  function ts(text) {
    if (typeof text !== "string" || !text || current === "en") return text;
    if (Object.prototype.hasOwnProperty.call(srv, text)) return srv[text];
    if (!templates) compile();
    for (const tpl of templates) {
      const m = tpl.re.exec(text);
      if (m) return fill(tpl.to, Object.fromEntries(tpl.names.map((n, i) => [n, m[i + 1]])));
    }
    return text;
  }

  // ---- choosing the language -----------------------------------------------------------------------------------
  const lang = () => current;
  function setLang(l) {
    current = LANGS.includes(l) ? l : "en";
    return current;
  }
  // Browser language -> UI language: es, es-MX, es_CL ... give Spanish; everything else English.
  const detect = (nav) => (typeof nav === "string" && /^es([-_]|$)/i.test(nav) ? "es" : "en");
  // Locale for numbers: the browser's own tag when it speaks the chosen language (so es-MX keeps its separators), else a default.
  function locale(l, nav) {
    const fallback = l === "es" ? "es-ES" : "en-US";
    if (typeof nav === "string" && nav.split(/[-_]/)[0].toLowerCase() === l) {
      try { return new Intl.NumberFormat(nav.replace("_", "-")).resolvedOptions().locale; } catch (_) { /* unusable tag */ }
    }
    return fallback;
  }
  function browserLanguage() {
    try { return globalThis.navigator.language; } catch (_) { return ""; }
  }
  // The one place the page touches browser storage for the language: undefined when the browser refuses it.
  function storage() {
    try { return globalThis.localStorage; } catch (_) { return undefined; }
  }
  function loadLang(store) {
    try { const v = store.getItem(KEY); return LANGS.includes(v) ? v : null; } catch (_) { return null; }
  }
  function saveLang(store, l) {
    if (!LANGS.includes(l)) return false;
    try { store.setItem(KEY, l); return true; } catch (_) { return false; }
  }

  globalThis.AmautaI18n = { dict, FILES, install, load, LANGS, t, tn, ts, lang, setLang, detect, locale, browserLanguage, storage, loadLang, saveLang };
})();
