import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { STATIC } from './helpers/portalboot.js';

const read = (f) => readFile(path.join(STATIC, f), 'utf8');
const ctx = {};
vm.runInNewContext(await read('i18n.js'), ctx);
const I = ctx.AmautaI18n;
const rctx = {};
vm.runInNewContext(await read('wikiroute.js'), rctx);
const R = rctx.AmautaRoute;
const app = await read('app.js');
const html = await read('index.html');
const plain = (x) => JSON.parse(JSON.stringify(x));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const EN = I.dict.en, ES = I.dict.es, SRV = I.dict.srv;

test.afterEach(() => I.setLang('en'));

// ---- the dictionaries stay in step -----------------------------------------------------------------------------------
test('every en key exists in es and vice versa', () => {
  const missingInEs = Object.keys(EN).filter((k) => !(k in ES));
  const missingInEn = Object.keys(ES).filter((k) => !(k in EN));
  assert.deepEqual(missingInEs, [], 'keys without a Spanish text');
  assert.deepEqual(missingInEn, [], 'Spanish keys without an English text');
  assert.ok(Object.keys(EN).length > 250);
});

test('both languages carry the same {placeholders} for every key, and no value is empty', () => {
  for (const k of Object.keys(EN)) {
    assert.ok(typeof EN[k] === 'string' && EN[k].length > 0, `en ${k}`);
    assert.ok(typeof ES[k] === 'string' && ES[k].length > 0, `es ${k}`);
    assert.equal(placeholders(ES[k]), placeholders(EN[k]), `placeholders of ${k}`);
  }
});

test('Spanish is neutral and professional: no voseo, no slang, no emoji', () => {
  const voseo = /\b(vos|tenés|podés|querés|sabés|hacé|elegí|mirá|andá|fijate|acordate|dale|che|boludo|chévere|guay)\b/i;
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const [k, v] of [...Object.entries(ES), ...Object.entries(SRV)]) {
    assert.doesNotMatch(v, voseo, k);
    assert.doesNotMatch(v, emoji, k);
  }
});

test('most Spanish texts are really translated (only short names and code may equal the English)', () => {
  const same = Object.keys(EN).filter((k) => EN[k] === ES[k] && /[a-z]{4,} [a-z]{3,}/i.test(EN[k]));
  assert.deepEqual(same, [], 'untranslated sentences: ' + same.join(', '));
});

test('the server-text catalog has a Spanish text with the same placeholders for every entry', () => {
  assert.ok(Object.keys(SRV).length > 80);
  for (const [k, v] of Object.entries(SRV)) {
    assert.ok(typeof v === 'string' && v.length > 0, k);
    assert.equal(placeholders(v), placeholders(k), `placeholders of "${k}"`);
  }
});

// ---- the keys app.js uses exist, and none is dead ---------------------------------------------------------------------
const DYNAMIC = /^(kind|hint|status|delta|themeErr|advice|origin|palette\.group)\./;
test('every key that app.js uses exists in en; every en key is used', () => {
  const literals = [...app.matchAll(/"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)"/g)].map((m) => m[1]);
  const used = new Set(literals);
  for (const k of used) assert.ok(k in EN || k + '.other' in EN, `app.js uses ${k}, which is not in en`);
  for (const k of Object.keys(EN)) {
    if (DYNAMIC.test(k)) continue;
    const base = k.replace(/\.(one|other)$/, '');
    assert.ok(used.has(k) || used.has(base), `en key ${k} is never used`);
  }
  for (const kind of Object.keys(R.KINDS)) assert.ok(`kind.${kind}` in EN, `kind.${kind}`);
  for (const v of ['done', 'pending', 'warning']) assert.ok(`status.${v}` in EN);
  for (const v of ['na', 'flat', 'better', 'worse']) assert.ok(`delta.${v}` in EN);
  for (const kind of ['memory', 'skill', 'tool', 'mcp', 'session', 'feature', 'project', 'node']) assert.ok(`hint.${kind}` in EN);
  for (const code of ['shape', 'name', 'base', 'token', 'value', 'slug', 'limit', 'dir', 'symlink', 'toolarge', 'json', 'unreadable', 'notfound', 'write']) assert.ok(`themeErr.${code}` in EN);
  for (const k of ['advice.403', 'advice.409', 'advice.429', 'advice.400', 'advice.413', 'advice.502', 'advice.other']) assert.ok(k in EN, k);
});

// ---- t, tn, ts -----------------------------------------------------------------------------------------------------------
test('t resolves in the chosen language, falls back to English, then to the key', () => {
  assert.equal(I.lang(), 'en');
  assert.equal(I.t('nav.home'), 'Home');
  I.setLang('es');
  assert.equal(I.t('nav.home'), 'Inicio');
  assert.equal(I.t('no.such.key'), 'no.such.key');
  const saved = ES['nav.home'];
  delete ES['nav.home'];
  try { assert.equal(I.t('nav.home'), 'Home', 'a key missing in es shows the English text'); } finally { ES['nav.home'] = saved; }
});

test('t fills {params} and leaves unknown placeholders visible', () => {
  assert.equal(I.t('progress.label', { done: 2, total: 5 }), '2 of 5 done');
  I.setLang('es');
  assert.equal(I.t('progress.label', { done: 2, total: 5 }), '2 de 5 hechas');
  assert.equal(I.t('progress.label', { done: 2 }), '2 de {total} hechas');
  assert.equal(I.t('progress.label'), '{done} de {total} hechas');
  assert.equal(I.t('common.http', { status: '<b>' }), 'HTTP <b>', 'values are inserted as text, never interpreted');
});

test('tn picks the singular for exactly one and the plural otherwise', () => {
  const p = { done: 1, total: 2, percent: 50, n: 1 };
  assert.match(I.tn('project.odd', 1, p), /in 1 feature$/);
  assert.match(I.tn('project.odd', 3, { ...p, n: 3 }), /in 3 features$/);
  assert.match(I.tn('project.odd', 0, { ...p, n: 0 }), /in 0 features$/);
  I.setLang('es');
  assert.match(I.tn('project.odd', 1, p), /en 1 funcionalidad$/);
  assert.match(I.tn('project.odd', 2, { ...p, n: 2 }), /en 2 funcionalidades$/);
});

test('ts translates the English text the server sends, exact or by template, and leaves everything else alone', () => {
  assert.equal(I.ts('Built into Claude Code'), 'Built into Claude Code', 'English: untouched');
  I.setLang('es');
  assert.equal(I.ts('Built into Claude Code'), 'Incluida en Claude Code');
  assert.equal(I.ts('Plugin superpowers'), 'Plugin superpowers');
  assert.equal(I.ts('3 of 5 tasks done'), '3 de 5 tareas hechas');
  assert.equal(I.ts('12 calls'), '12 llamadas');
  assert.equal(I.ts('memory revised (revision 3)'), 'memoria revisada (revisión 3)');
  assert.equal(I.ts('A memory titled however the user likes'), 'A memory titled however the user likes');
  assert.equal(I.ts(''), '');
  assert.equal(I.ts(null), null);
  assert.equal(I.ts(5), 5);
  assert.equal(I.ts('12 calls and then some'), '12 calls and then some', 'a template must match the whole text');
});

// ---- choosing the language ---------------------------------------------------------------------------------------------
test('the default comes from the browser language: es* gives Spanish, anything else English', () => {
  for (const [nav, lang] of [['es', 'es'], ['es-MX', 'es'], ['ES-ar', 'es'], ['es_CL', 'es'], ['en-US', 'en'], ['en', 'en'], ['fr-FR', 'en'], ['de', 'en'], ['esperanto', 'en'], ['', 'en'], [undefined, 'en'], [null, 'en'], [5, 'en']]) assert.equal(I.detect(nav), lang, String(nav));
});

test('the number locale follows the language, and the browser region when it matches', () => {
  assert.equal(I.locale('es', 'es-MX'), 'es-MX');
  assert.equal(I.locale('es', 'en-US'), 'es-ES');
  assert.equal(I.locale('es', undefined), 'es-ES');
  assert.equal(I.locale('en', 'en-GB'), 'en-GB');
  assert.equal(I.locale('en', 'es-MX'), 'en-US');
  assert.equal(I.locale('es', 'es-@@'), 'es-ES', 'an unusable tag falls back');
});

test('the stored choice survives garbage and a storage that throws', () => {
  const store = (v) => ({ getItem: () => v });
  assert.equal(I.loadLang(store('es')), 'es');
  assert.equal(I.loadLang(store('en')), 'en');
  for (const bad of [null, '', 'fr', 'ES', 'es-MX', '<script>']) assert.equal(I.loadLang(store(bad)), null, String(bad));
  assert.equal(I.loadLang({ getItem: () => { throw new Error('denied'); } }), null);
  assert.equal(I.loadLang(undefined), null);
  const saved = {};
  assert.equal(I.saveLang({ setItem: (k, v) => { saved[k] = v; } }, 'es'), true);
  assert.deepEqual(saved, { 'amauta-lang': 'es' });
  assert.equal(I.saveLang({ setItem: () => { throw new Error('quota'); } }, 'es'), false);
  assert.equal(I.saveLang(undefined, 'es'), false);
  assert.equal(I.saveLang({ setItem: () => assert.fail('no garbage') }, 'fr'), false);
  assert.equal(I.setLang('fr'), 'en', 'an unknown language means English');
});

// ---- formatting helpers (numbers follow the locale; dates never do) -------------------------------------------------------
test('numbers, decimals and percentages follow the locale', () => {
  R.setLocale('es-ES');
  assert.equal(R.fmtNumber(1234567), '1.234.567');
  assert.equal(R.fmtDecimal(1234.5, 1), '1234,5');
  assert.equal(R.fmtDecimal(4.4849, 1), '4,5');
  assert.match(R.fmtPercent(0.125), /^12,5\s?%$/);
  assert.equal(R.fmtDecimal(null, 1), '-');
  R.setLocale('en-US');
  assert.equal(R.fmtNumber(1234567), '1,234,567');
  assert.equal(R.fmtDecimal(1234.5, 1), '1,234.5');
  assert.equal(R.fmtDecimal(21, 0), '21');
  assert.equal(R.fmtPercent(0.125), '12.5%');
  assert.equal(R.fmtMetric('error_rate', 0.125), '12.5%');
});

test('dates and date-times keep their YYYY-MM-DD shape in every language', () => {
  for (const loc of ['es-ES', 'es-MX', 'en-GB', 'en-US']) {
    R.setLocale(loc);
    assert.equal(R.fmtDate('2026-10-16'), '2026-10-16', loc);
    const stamp = new Date(2026, 9, 16, 8, 5).getTime();
    assert.equal(R.fmtDate(stamp), '2026-10-16', loc);
    assert.equal(R.fmtDateTime(stamp), '2026-10-16 08:05', loc);
    assert.equal(R.fmtDateTime('2026-10-16T08:05:00'), '2026-10-16 08:05', loc);
  }
  R.setLocale('en-US');
});

test('metric and advice helpers take their words from the caller and carry a message key', () => {
  const words = { na: 'n/d', tokens: 'fichas', pp: 'pp' };
  assert.equal(R.fmtMetric('tokens_per_turn', 123.4, words), '123 fichas');
  assert.equal(R.fmtMetric('error_rate', null, words), 'n/d');
  assert.equal(R.fmtDelta('tokens_per_turn', -40.2, words), '-40 fichas');
  assert.equal(R.fmtDelta('error_rate', 0.15, { ...words, pp: 'pts' }), '+15.0 pts');
  for (const s of [400, 403, 409, 413, 415, 429, 502, 503, 504, 500]) assert.match(R.settingsAdvice(s).key, /^advice\.(\d+|other)$/, String(s));
  assert.equal(R.settingsAdvice(403).key, 'advice.403');
  assert.equal(R.settingsAdvice(418).key, 'advice.other');
});

// ---- no user-visible text escapes translation ----------------------------------------------------------------------------
// Scans app.js for string literals that read like text (a capitalized word or two words) outside the places that never show text.
function literals(source) {
  const out = [];
  const src = source.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length)).replace(/(^|[^:\w"'`\\])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length));
  const scan = (s, base) => {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
        out.push({ value: s.slice(i + 1, j), at: base + i, before: s.slice(Math.max(0, i - 70), i), after: s.slice(j + 1, j + 3), tpl: false });
        i = j + 1;
      } else if (c === '`') {
        let j = i + 1, part = '', start = i;
        while (j < s.length && s[j] !== '`') {
          if (s[j] === '\\') { part += s[j + 1]; j += 2; continue; }
          if (s[j] === '$' && s[j + 1] === '{') {
            out.push({ value: part, at: base + start, before: s.slice(Math.max(0, start - 70), start), after: '', tpl: true });
            part = ''; start = j;
            let depth = 1, k = j + 2;
            while (k < s.length && depth) { if (s[k] === '{') depth++; else if (s[k] === '}') depth--; else if (s[k] === '"' || s[k] === "'" || s[k] === '`') { const q = s[k]; k++; while (k < s.length && s[k] !== q) k += s[k] === '\\' ? 2 : 1; } k++; }
            scan(s.slice(j + 2, k - 1), base + j + 2);
            j = k;
            continue;
          }
          part += s[j]; j++;
        }
        out.push({ value: part, at: base + start, before: s.slice(Math.max(0, start - 70), start), after: '', tpl: true });
        i = j + 1;
      } else if (c === '/' && /[=(,:!&|?{};]\s*$/.test(s.slice(Math.max(0, i - 3), i)) && s[i + 1] !== '/' && s[i + 1] !== '*') {
        let j = i + 1;
        while (j < s.length && s[j] !== '/') { if (s[j] === '\\') j++; if (s[j] === '[') while (s[j] !== ']') j++; j++; }
        i = j + 1; // a regular expression literal
      } else i++;
    }
  };
  scan(src, 0);
  return out;
}
// Where a literal is never user-visible: attribute values that are identifiers, the first argument of lookups and listeners, object keys, comparisons.
const QUIET_BEFORE = new RegExp([
  String.raw`(?:\bclass|\bid|\btype|\brole|\bhref|\bsrc|\bfor|\bsandbox|\breferrerpolicy|\baccept|\bautocomplete|\bspellcheck|\bmaxlength|\bdownload|\bname|\bmethod|\bAccept|\bdata-[\w-]+|"data-[\w-]+"|"aria-(?:describedby|live|sort|current|pressed|expanded|selected|haspopup|controls|busy|invalid|activedescendant|keyshortcuts)"|\btabindex|"Content-Type"|"X-Portal-Token"|"text-anchor"|\battr)"?\s*[:=]\s*$`,
  String.raw`(?:\bapi|\blink|\bsetAttribute|\bgetAttribute|\bremoveAttribute|\baddEventListener|\bquerySelector|\bgetElementById|\$|\bsvg|\bh|\bcreateElement|\bcreateElementNS|\btest|\bstartsWith|\bincludes|\bmatch|\bsplit|\bpush|\bpostJson|\bfetch|\bimport|\bfind|\bdelete|\bhasOwnProperty\.call|\bformatHash|\bparseHash|\bcard|\bt|\btn|\bts|\bcss|\bstatusChip|\bsay|\bbusy|\bkindLabel|\bgroupLabel|\bthemeMsg|\bvalueLabel|\boption|\btable|\bguarded|\bsetItem|\bgetItem|\bdocument\.\w+)\(\s*$`,
  String.raw`\bh\("code",\s*(?:null|\{[^}]*\}),\s*$`,
  String.raw`(?:===|!==|==|!=|case|\bin|\?\?|\|\||&&)\s*$`,
].join('|'));
const ALLOW = new Set(['Tokens in the sessions that used it', 'use strict', 'Content-Type', 'X-Portal-Token', 'amauta', 'MCP', 'ODD', 'Source Serif 4']);
function visible(l) {
  const v = l.value;
  if (!/[A-Za-z]/.test(v) || ALLOW.has(v.trim())) return false;
  if (QUIET_BEFORE.test(l.before) || /^\s*:/.test(l.after)) return false;
  if (/^[a-z][A-Za-z.]*[.:]$/.test(v)) return false; // the fixed head of a dynamic key (kind., origin., custom:)
  return /\b[A-Z][a-z]{2,}/.test(v) || /[A-Za-z]{3,} [A-Za-z]{2,}/.test(v) || /[A-Za-z]{3,}[,.:;!?]$/.test(v);
}
test('app.js has no user-visible text outside t(), tn() and ts()', () => {
  const bad = literals(app).filter(visible).map((l) => `${JSON.stringify(l.value.slice(0, 60))} ...${l.before.slice(-30).replace(/\n/g, ' ')}`);
  assert.deepEqual(bad, [], `${bad.length} literal(s) look like untranslated text`);
});

test('navigation labels and page headings are keys, not literals', () => {
  assert.match(app, /const SECTIONS = \[\s*\["nav\.knowledge"/);
  for (const k of ['nav.home', 'nav.project', 'nav.memory', 'nav.feature', 'nav.node', 'nav.skill', 'nav.tool', 'nav.mcp', 'nav.session', 'nav.usage', 'nav.lint', 'nav.themes', 'nav.settings']) assert.match(app, new RegExp(`"${k.replace('.', '\\.')}"`), k);
  for (const heading of [/h\("h1", null, "/, /h\("h2", null, "/, /h\("h3", null, "/, /panel\("/, /teach\("/]) assert.doesNotMatch(app, heading, String(heading));
});

test('the scanner itself sees untranslated text (guards the guard)', () => {
  const sample = 'const a = h("p", { class: "muted" }, "Not translated yet"); const b = h("p", null, t("nav.home")); const c = `Loaded ${x} sessions`;';
  assert.deepEqual(literals(sample).filter(visible).map((l) => l.value), ['Not translated yet', 'Loaded ']);
});

// ---- index.html: every visible text is set from i18n --------------------------------------------------------------------
test('every text in index.html belongs to an element whose id app.js fills from the dictionary', () => {
  const ids = new Set([...app.matchAll(/\["([a-z][\w-]*)",\s*"(?:chrome|filters|palette)\.[\w.]+"/g)].map((m) => m[1]));
  const ignore = new Set(['recent', 'view', 'nav']); // replaced at runtime by rendered content
  const texts = [...html.matchAll(/<(\w+)([^>]*)>([^<>]+)<\/\1>/g)].filter((m) => m[3].trim() && !['title', 'script'].includes(m[1]) && !/<kbd/.test(m[0]));
  for (const [, tag, attrs, text] of texts) {
    const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1];
    if (id && ignore.has(id)) continue;
    if (/class="brand"/.test(attrs) || tag === 'kbd' || (tag === 'option' && /value="(en|es)"/.test(attrs))) continue; // language names are shown in their own language
    assert.ok(id && ids.has(id), `<${tag}> "${text.trim()}" has no id wired to a dictionary key`);
  }
  const attrsToTranslate = [...html.matchAll(/(?:aria-label|placeholder)="([^"]+)"[^>]*?(?:\bid="([^"]+)")?/g)];
  assert.ok(attrsToTranslate.length > 0);
  for (const m of html.matchAll(/<(\w+)([^>]*\b(?:aria-label|placeholder)="[^"]+"[^>]*)>/g)) {
    const id = (/\bid="([^"]+)"/.exec(m[2]) || [])[1];
    assert.ok(id && new RegExp(`\\["${id}",\\s*"(?:aria-label|placeholder)",\\s*"[\\w.]+"\\]`).test(app), `<${m[1]} ${id}> has an untranslated attribute`);
  }
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<select id="lang-picker"/);
  assert.match(html, /<option value="en">English<\/option>/);
  assert.match(html, /<option value="es">Español<\/option>/);
  assert.match(html, /<script src="\/static\/i18n\.js"><\/script>\s*<script src="\/static\/theme\.js">/);
});

// ---- markdown.js shows two fixed texts; the page passes them translated ------------------------------------------------
test('markdown rendering takes its tooltip and table label from the caller', async () => {
  const { makeEnv } = await import('./helpers/fakedom.js');
  const mctx = {};
  vm.runInNewContext(await read('markdown.js'), mctx);
  const MD = mctx.AmautaMarkdown;
  const doc = makeEnv({}).document;
  const walk = (nodes) => { const all = []; for (const n of nodes) n.walk((e) => all.push(e)); return all; };
  const src = '[[memory:x|Label]]\n\n| a |\n|---|\n| b |\n';
  const labels = { missing: (kind, id) => `Aún no hay ${kind}: ${id}`, table: 'Tabla desplazable' };
  const custom = walk(MD.toDom(MD.parse(src), doc, { known: () => false, labels }));
  assert.equal(custom.find((e) => /wikilink/.test(e.attrs.class)).attrs.title, 'Aún no hay memory: x');
  assert.equal(custom.find((e) => e.attrs.role === 'region').attrs['aria-label'], 'Tabla desplazable');
  const plainOut = walk(MD.toDom(MD.parse(src), doc, { known: () => false }));
  assert.equal(plainOut.find((e) => /wikilink/.test(e.attrs.class)).attrs.title, 'No page yet for memory: x');
  assert.equal(plainOut.find((e) => e.attrs.role === 'region').attrs['aria-label'], 'Table, scrollable');
});
