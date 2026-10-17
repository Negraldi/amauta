import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const XSS = '<img src=x onerror=alert(1)>';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const memoryStorage = (initial = {}) => { const data = { ...initial }; return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } }; };
const fire = (el, type, extra = {}) => { for (const fn of el.listeners[type] ?? []) fn({ target: el, ...extra }); };

const HOME = { activity: [], spending: { available: false }, impact: null, health: { installed: true, version: '0.3.0', hooks: 4, mcp_servers: 2, skills: 9, agents: 1, telemetry: true } };
const SKILL_PAGE = { kind: 'skill', id: 'artifact-capabilities', title: 'artifact-capabilities', body_md: '', progress: null, meta: [{ label: 'Source', value: 'Built into Claude Code' }, { label: 'Calls', value: 1234567, fmt: 'number' }, { label: 'Last used', value: '2026-10-05T10:00:00.000Z' }],
  summary: { description: null, trigger: null, source: 'Built into Claude Code', path: null, builtin: true, note: 'Built into Claude Code (no local file); description unavailable locally.' },
  sections: [{ heading: 'Tools of this server', items: [{ label: 'Read', value: '12 calls', kind: 'tool', id: 'Read' }] }], links: [], backlinks: [], missing: [], usage: null, history: null };
const MEMORY_PAGE = { kind: 'memory', id: '7', title: 'Decision about caching', body_md: 'We keep the **latest** revision only.', progress: null, meta: [{ label: 'Type', value: 'decision' }, { label: 'Revision', value: 3 }],
  sections: [], links: [], backlinks: [], missing: [], usage: null, history: { available: false, note: 'This store keeps the latest revision only: saving the same topic_key again overwrites the previous text, so there is no earlier text to list or compare.' } };
const PROJECTS = { auto_discover: true, config_repos: [], projects: [{ name: 'amauta', path: '/home/u/amauta', origin: ['config'], odd: { features: 2, done: 3, total: 5, percent: 60 }, sessions: 1234567, memories: 4, graph: { mirrored: true, nodes: 3, edges: 2, synced_at: '2026-10-05T10:00:00.000Z' } }] };

async function boot({ language = 'en-US', storage = memoryStorage(), hash = '#/', routes = {}, extra = {} } = {}) {
  const posts = [];
  const env = makeEnv({ '/api/wiki/home': HOME, '/api/wiki/recent': { items: [] }, '/api/sessions': { projects: [{ project: 'amauta' }] }, '/api/themes': { themes: [], tokens: [], max: 50 }, '/api/projects': PROJECTS,
    '/api/wiki/page': (opts, url) => (String(url).includes('kind=skill') ? SKILL_PAGE : MEMORY_PAGE), ...routes });
  env.location.hash = hash;
  await runPortal(env, { DOMParser: class {}, queueMicrotask, navigator: { language }, localStorage: storage, ...extra });
  await tick();
  return { env, storage, posts };
}
const $ = (env, id) => env.document.getElementById(id);
const view = (env) => $(env, 'view');
const nav = (env) => $(env, 'nav');
const lang = (env) => env.document.documentElement.attrs.lang;
const switchTo = async (env, value) => { const p = $(env, 'lang-picker'); p.value = value; fire(p, 'change'); await tick(); };

test('the default language comes from the browser: Spanish for es*, English otherwise, and <html lang> follows', async () => {
  const es = await boot({ language: 'es-MX' });
  assert.equal(lang(es.env), 'es');
  assert.match(nav(es.env).textContent, /Conocimiento/);
  assert.match(nav(es.env).textContent, /Proyectos/);
  assert.equal($(es.env, 'lang-picker').value, 'es');
  for (const language of ['en-GB', 'fr-FR', '']) {
    const en = await boot({ language });
    assert.equal(lang(en.env), 'en', language);
    assert.match(nav(en.env).textContent, /Knowledge/);
    assert.equal($(en.env, 'lang-picker').value, 'en');
  }
});

test('the page is complete in Spanish without a missing-key fallback on the home route', async () => {
  const { env } = await boot({ language: 'es-ES' });
  assert.match(view(env).textContent, /Actividad reciente/);
  assert.match(view(env).textContent, /Estado del harness/);
  assert.doesNotMatch(view(env).textContent, /\b(Recent activity|Harness health)\b/);
  assert.match($(env, 'refresh').textContent, /Actualizar uso/);
  assert.match($(env, 'search-text').textContent, /Buscar en la wiki/);
});

test('switching the language re-renders the current route and the static chrome without a reload', async () => {
  const { env, storage } = await boot({ language: 'en-US' });
  const before = env.calls.length;
  assert.match(view(env).textContent, /Recent activity/);
  await switchTo(env, 'es');
  assert.equal(lang(env), 'es');
  assert.match(view(env).textContent, /Actividad reciente/);
  assert.match(nav(env).textContent, /Inicio/);
  assert.equal($(env, 'refresh').textContent, 'Actualizar uso');
  assert.equal($(env, 'palette-input').attrs.placeholder.startsWith('Buscar'), true);
  assert.equal($(env, 'sidebar').attrs['aria-label'], 'Wiki');
  assert.equal($(env, 'prefs').attrs['aria-label'], 'Apariencia');
  assert.deepEqual(tree($(env, 'theme-picker')).filter((e) => e.tagName === 'option').map((o) => o.textContent), ['Sistema', 'Claro', 'Oscuro']);
  assert.equal(storage.data['amauta-lang'], 'es');
  assert.equal(env.location.hash, '#/', 'the address did not change');
  assert.ok(env.calls.length > before, 'the route reloaded its data (a re-render, not a page reload)');
  await switchTo(env, 'en');
  assert.equal(lang(env), 'en');
  assert.match(view(env).textContent, /Recent activity/);
  assert.equal(storage.data['amauta-lang'], 'en');
});

test('the stored choice wins over the browser language, and a throwing or missing storage never breaks the page', async () => {
  const stored = await boot({ language: 'en-US', storage: memoryStorage({ 'amauta-lang': 'es' }) });
  assert.equal(lang(stored.env), 'es');
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  for (const storage of [throwing, undefined]) {
    const { env } = await boot({ language: 'es-AR', storage, extra: storage === undefined ? { localStorage: undefined } : {} });
    assert.equal(lang(env), 'es');
    await switchTo(env, 'en');
    assert.equal(lang(env), 'en');
    assert.match(view(env).textContent, /Recent activity/);
  }
});

test('numbers follow the language and region; dates stay YYYY-MM-DD in both languages', async () => {
  const es = await boot({ language: 'es-ES', hash: '#/project' });
  assert.match(view(es.env).textContent, /1\.234\.567 sesiones/);
  assert.match(view(es.env).textContent, /grafo reflejado 2026-10-05/);
  assert.match(view(es.env).textContent, /3 de 5 tareas \(60 %\) en 2 funcionalidades/);
  const mx = await boot({ language: 'es-MX', hash: '#/project' });
  assert.match(view(mx.env).textContent, /1,234,567 sesiones/);
  const en = await boot({ language: 'en-US', hash: '#/project' });
  assert.match(view(en.env).textContent, /1,234,567 sessions/);
  assert.match(view(en.env).textContent, /graph mirrored 2026-10-05/);
  await switchTo(en.env, 'es');
  assert.match(view(en.env).textContent, /1\.234\.567 sesiones/, 'the chosen language brings its own separators when the browser region is not Spanish');
  assert.doesNotMatch(view(en.env).textContent, /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2} de \w+ de \d{4}/);
});

test('server text is translated, user content is left exactly as written', async () => {
  const skill = await boot({ language: 'es-ES', hash: '#/skill/artifact-capabilities' });
  const text = view(skill.env).textContent;
  assert.match(text, /Incluida en Claude Code/);
  assert.match(text, /Esta skill viene incluida|Incluida en Claude Code \(sin archivo local\)/);
  assert.match(text, /Origen: Incluida en Claude Code/);
  assert.match(text, /1\.234\.567/);
  assert.match(text, /2026-10-05 10:00|2026-10-0[45] \d\d:\d\d/);
  assert.match(text, /12 llamadas/);
  assert.match(text, /Herramientas de este servidor/);
  assert.ok(tree(view(skill.env)).some((e) => e.tagName === 'a' && e.textContent === 'Read'), 'a tool name is not translated');
  const mem = await boot({ language: 'es-ES', hash: '#/memory/7' });
  const mtext = view(mem.env).textContent;
  assert.match(mtext, /Decision about caching/);
  assert.match(mtext, /We keep the latest revision only\./);
  assert.match(mtext, /Este almacén conserva solo la última revisión/);
  assert.match(mtext, /decision/, 'a memory type is data');
  assert.ok(tree(view(mem.env)).some((e) => e.tagName === 'dt' && e.textContent === 'Tipo'));
});

test('text the server sends that has no translation is shown as sent, never dropped or broken', async () => {
  const { env } = await boot({ language: 'es-ES', hash: '#/memory/7', routes: { '/api/wiki/page': { ...MEMORY_PAGE, meta: [{ label: 'A brand new label', value: 'a brand new value' }], history: { available: false, note: 'A note nobody translated.' } } } });
  assert.match(view(env).textContent, /A brand new label/);
  assert.match(view(env).textContent, /a brand new value/);
  assert.match(view(env).textContent, /A note nobody translated\./);
});

test('hostile text stays text in both languages', async () => {
  for (const language of ['en-US', 'es-ES']) {
    const { env } = await boot({ language, hash: '#/memory/7', routes: { '/api/wiki/page': { ...MEMORY_PAGE, title: XSS, meta: [{ label: XSS, value: XSS }] } } });
    assert.equal(tree(view(env)).filter((e) => e.tagName === 'img').length, 0, language);
    assert.ok(tree(view(env)).some((e) => e.textContent === XSS), language);
  }
});

test('errors and refusals are explained in the chosen language', async () => {
  const { env } = await boot({ language: 'es-ES', hash: '#/memory/99', routes: { '/api/wiki/page': { __status: 404, error: 'not found' } } });
  assert.match(view(env).textContent, /No hay página de tipo memoria/);
  assert.match(view(env).textContent, /Las memorias aparecen aquí/);
  const s = await boot({ language: 'es-ES', hash: '#/settings', routes: {
    '/api/settings': { installed: true, current: { persona: 'gentleman', review_mode: 'off', telemetry: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } }, allowed: {}, undo: { available: false } },
    '/api/settings/preview': { __status: 403, error: 'missing or wrong token' } } });
  const sel = tree(view(s.env)).find((e) => e.attrs.id === 'set-persona');
  sel.value = 'neutral'; fire(sel, 'change');
  tree(view(s.env)).find((e) => e.tagName === 'button' && e.textContent === 'Vista previa de cambios').click();
  await tick();
  assert.match(view(s.env).textContent, /Falta el token o es incorrecto/);
  assert.match(view(s.env).textContent, /Recargue esta página/);
});

test('the settings page speaks Spanish: options, help and values', async () => {
  const { env } = await boot({ language: 'es-ES', hash: '#/settings', routes: {
    '/api/settings': { installed: true, current: { persona: 'gentleman', review_mode: 'off', telemetry: 'on', modules: { sdd: 'off', rea: 'off', context7: 'off', impeccable: 'off', archify: 'off' } }, allowed: {}, undo: { available: false } } } });
  const t = view(env).textContent;
  assert.match(t, /Modo de revisión/);
  assert.match(t, /ahora desactivado/);
  assert.match(t, /Módulos opcionales/);
  assert.match(t, /Desarrollo guiado por especificaciones \(SDD\)/);
  const sel = tree(view(env)).find((e) => e.attrs.id === 'set-review-mode');
  sel.value = 'on'; fire(sel, 'change');
  assert.match(view(env).textContent, /◆ cambiado, era desactivado/);
});

test('the theme editor and its draft survive a language switch', async () => {
  const { env } = await boot({ language: 'en-US', hash: '#/themes' });
  tree(view(env)).find((e) => e.tagName === 'button' && e.textContent === 'New theme').click();
  const name = tree(view(env)).find((e) => e.attrs.id === 'theme-name');
  name.value = 'Mine'; fire(name, 'input');
  const ink = tree(view(env)).find((e) => e.attrs.id === 'tok-ink');
  ink.value = '#bbbbbb'; fire(ink, 'input');
  assert.match(view(env).textContent, /Low contrast: ink on bg is 1\.\d:1 \(needs 4\.5:1\)/);
  await switchTo(env, 'es');
  assert.match(view(env).textContent, /Contraste bajo: ink sobre bg es 1,\d:1 \(se necesita 4,5:1\)/);
  assert.equal(tree(view(env)).find((e) => e.attrs.id === 'theme-name').value, 'Mine', 'the draft is kept');
  assert.equal(tree(view(env)).find((e) => e.attrs.id === 'tok-ink').value, '#bbbbbb');
  assert.ok(tree(view(env)).some((e) => e.tagName === 'button' && e.textContent === 'Guardar tema'));
});

test('the search palette and refresh status speak the chosen language', async () => {
  const { env } = await boot({ language: 'es-ES', routes: { '/api/wiki/search': { groups: [] }, '/api/refresh': { messages: 15000, files: 3 } } });
  const input = $(env, 'palette-input');
  input.value = 'zzz'; fire(input, 'input');
  await tick(200);
  assert.match($(env, 'palette-results').textContent, /Sin resultados para "zzz"/);
  $(env, 'refresh').click();
  await tick();
  assert.match($(env, 'status').textContent, /Listo: 15\.000 mensaje\(s\) nuevos de 3 archivo\(s\)\./);
});
