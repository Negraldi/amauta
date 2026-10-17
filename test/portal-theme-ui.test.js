import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/fakedom.js';
import { runPortal } from './helpers/portalboot.js';

const XSS = '<img src=x onerror=alert(1)>';
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
const TOKENS = ['bg', 'surface', 'sidebar', 'ink', 'ink-muted', 'line', 'accent', 'accent-soft', 'warn', 'ok', 'c-input', 'c-output', 'c-cache-read', 'c-cache-write'];
const NIGHT = { slug: 'night', name: 'Night', base: 'dark', tokens: { bg: '#101010', accent: 'oklch(0.8 0.1 30)' } };
const PAPER = { slug: 'paper', name: XSS, base: 'light', tokens: {} };
const BROKEN = { slug: 'broken', error: 'tokens: bg: use oklch(L C H) or #rrggbb' };
const listing = (themes) => ({ themes, tokens: TOKENS, max: 50 });

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

async function boot({ themes = [NIGHT, PAPER, BROKEN], storage = memoryStorage(), hash = '#/', routes = {}, extra = {} } = {}) {
  const posts = [];
  const post = (path, fn) => async (opts) => {
    if (opts.method !== 'POST') return listing(themes);
    posts.push({ path, headers: opts.headers, body: JSON.parse(opts.body) });
    return fn(JSON.parse(opts.body));
  };
  const env = makeEnv({
    '/api/themes': post('save', () => listing(themes)), '/api/themes/delete': post('delete', () => listing(themes.filter((t) => t.slug !== posts.at(-1).body.slug))),
    '/api/wiki/recent': { items: [] }, '/api/wiki/home': { activity: [], spending: { available: false }, impact: null, health: { installed: false } }, '/api/sessions': { projects: [] }, ...routes,
  });
  env.location.hash = hash;
  const blobs = [];
  class Blob { constructor(parts, opts) { this.text = parts.join(''); this.type = opts && opts.type; blobs.push(this); } }
  const created = [];
  const URLStub = { createObjectURL: (b) => { created.push(b); return 'blob:fake'; }, revokeObjectURL: () => {} };
  const anchors = [];
  const origCreate = env.document.createElement;
  env.document.createElement = (t) => { const e = origCreate(t); if (t === 'a') anchors.push(e); return e; };
  await runPortal(env, { DOMParser: class {}, queueMicrotask, localStorage: storage, Blob, URL: URLStub, ...extra });
  await tick();
  return { env, posts, storage, blobs, created, anchors, root: env.document.documentElement };
}
const view = (env) => env.document.getElementById('view');
const picker = (env) => env.document.getElementById('theme-picker');
const options = (env) => tree(picker(env)).filter((e) => e.tagName === 'option').map((o) => [o.getAttribute('value'), o.textContent]);
const button = (env, label) => tree(view(env)).find((e) => e.tagName === 'button' && e.textContent === label);
const field = (env, id) => tree(view(env)).find((e) => e.attrs.id === id);
const fire = (el, type, extra = {}) => { for (const fn of el.listeners[type] ?? []) fn({ target: el, ...extra }); };
const typeInto = (env, id, value) => { const f = field(env, id); f.value = value; fire(f, 'input'); };
const choose = (env, value) => { picker(env).value = value; fire(picker(env), 'change'); };
const go = async (env, hash) => { env.location.hash = hash; env.listeners.hashchange(); await tick(); };

test('the picker offers System, Light, Dark, then every valid custom theme (never an invalid file); System is the default', async () => {
  const { env, root } = await boot();
  assert.deepEqual(options(env), [['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['custom:night', 'Night'], ['custom:paper', XSS]]);
  assert.equal(picker(env).value, 'system');
  assert.deepEqual([root.attrs, root.props], [{}, {}], 'System follows the OS: nothing forced');
  assert.equal(tree(picker(env)).filter((e) => e.tagName === 'img').length, 0, 'a hostile theme name stays text');
});

test('choosing a scheme switches at once, without a reload, and is remembered', async () => {
  const { env, root, storage } = await boot();
  const before = env.calls.length;
  choose(env, 'dark');
  assert.equal(root.attrs['data-theme'], 'dark');
  assert.equal(storage.data['amauta-theme'], 'dark');
  choose(env, 'light');
  assert.equal(root.attrs['data-theme'], 'light');
  choose(env, 'system');
  assert.deepEqual(root.attrs, {});
  assert.equal(env.calls.length, before, 'no request: the switch is instant');
});

test('a custom theme applies its base scheme and tokens through CSSOM properties only', async () => {
  const { env, root, storage } = await boot();
  choose(env, 'custom:night');
  assert.equal(root.attrs['data-theme'], 'dark');
  assert.deepEqual(root.props, { '--bg': '#101010', '--accent': 'oklch(0.8 0.1 30)' });
  assert.equal(storage.data['amauta-theme'], 'custom:night');
  assert.ok(!('style' in root.attrs), 'no style attribute');
  choose(env, 'light');
  assert.deepEqual(root.props, {}, 'custom tokens are removed again');
});

test('the saved choice is applied on load, once the custom theme is known', async () => {
  const { env, root } = await boot({ storage: memoryStorage({ 'amauta-theme': 'custom:night' }) });
  assert.equal(picker(env).value, 'custom:night');
  assert.equal(root.attrs['data-theme'], 'dark');
  assert.equal(root.props['--bg'], '#101010');
});

test('a saved custom theme that no longer exists falls back to System', async () => {
  const { env, root } = await boot({ storage: memoryStorage({ 'amauta-theme': 'custom:gone' }) });
  assert.equal(picker(env).value, 'system');
  assert.deepEqual(root.attrs, {});
});

test('the page works when localStorage is missing or throws', async () => {
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  for (const storage of [throwing, undefined]) {
    const { env, root } = await boot({ storage, extra: storage === undefined ? { localStorage: undefined } : {} });
    assert.match(view(env).textContent, /Recent activity/);
    choose(env, 'dark');
    assert.equal(root.attrs['data-theme'], 'dark');
  }
});

test('the top bar links to the editor and the sidebar lists the Themes page', async () => {
  const { env } = await boot();
  const links = tree(env.document.getElementById('nav')).filter((e) => e.tagName === 'a').map((a) => a.getAttribute('href'));
  assert.ok(links.includes('#/themes'));
});

// ---- the editor ----------------------------------------------------------------------------------------------------
test('the editor lists themes, flags invalid files with words, and shows one color input and one text field per token', async () => {
  const { env } = await boot({ hash: '#/themes' });
  const v = view(env);
  assert.match(v.textContent, /Themes/);
  assert.ok(tree(v).some((e) => e.textContent === XSS), 'the name is text');
  assert.match(v.textContent, /broken/);
  assert.match(v.textContent, /Invalid/);
  assert.match(v.textContent, /use oklch\(L C H\)/);
  assert.ok(!tree(v).some((e) => e.attrs['data-edit'] === 'broken'), 'an invalid file cannot be edited or applied');
  button(env, 'New theme').click();
  for (const t of TOKENS) {
    assert.equal(field(env, `tok-${t}`).tagName, 'input', t);
    assert.equal(field(env, `tok-${t}-color`).attrs.type, 'color', t);
  }
  assert.ok(field(env, 'theme-name') && field(env, 'theme-base'));
  assert.deepEqual(tree(field(env, 'theme-base')).filter((e) => e.tagName === 'option').map((o) => o.getAttribute('value')), ['light', 'dark']);
});

test('editing a token previews it on the whole portal at once; an invalid value is explained in words and not applied', async () => {
  const { env, root } = await boot({ hash: '#/themes' });
  button(env, 'New theme').click();
  typeInto(env, 'theme-name', 'Mine');
  field(env, 'theme-base').value = 'dark'; fire(field(env, 'theme-base'), 'change');
  assert.equal(root.attrs['data-theme'], 'dark');
  typeInto(env, 'tok-bg', '#202020');
  assert.equal(root.props['--bg'], '#202020');
  assert.equal(field(env, 'tok-bg-color').value, '#202020', 'the color input follows the text');
  typeInto(env, 'tok-accent', 'oklch(0.7 0.1 40)');
  assert.equal(root.props['--accent'], 'oklch(0.7 0.1 40)');
  assert.match(field(env, 'tok-accent-color').value, /^#[0-9a-f]{6}$/);
  typeInto(env, 'tok-ink', 'purple');
  assert.ok(!('--ink' in root.props));
  assert.equal(field(env, 'tok-ink').attrs['aria-invalid'], 'true');
  assert.match(view(env).textContent, /Invalid value/);
  fire(field(env, 'tok-surface-color'), 'input', { target: Object.assign(field(env, 'tok-surface-color'), { value: '#303030' }) });
  assert.equal(field(env, 'tok-surface').value, '#303030');
  assert.equal(root.props['--surface'], '#303030');
  typeInto(env, 'tok-bg', '');
  assert.ok(!('--bg' in root.props), 'an empty field falls back to the base theme');
});

test('a contrast warning is written out (not color alone) when ink or ink-muted is below 4.5:1 against bg or surface', async () => {
  const { env } = await boot({ hash: '#/themes' });
  button(env, 'New theme').click();
  assert.doesNotMatch(view(env).textContent, /Low contrast/);
  typeInto(env, 'tok-ink', '#bbbbbb');
  const text = view(env).textContent;
  assert.match(text, /Low contrast: ink on bg is 1\.\d:1/);
  assert.match(text, /needs 4\.5:1/);
  assert.match(text, /ink on surface/);
  typeInto(env, 'tok-ink', '#000000');
  assert.doesNotMatch(view(env).textContent, /Low contrast: ink/);
  const warn = tree(view(env)).find((e) => e.attrs['aria-live'] === 'polite' && e.attrs['data-contrast']);
  assert.ok(warn, 'announced politely');
});

test('Save posts the guarded payload (token, JSON), reports success and refreshes the picker', async () => {
  const saved = { slug: 'mine', name: 'Mine', base: 'dark', tokens: { bg: '#202020' } };
  const { env, posts } = await boot({ hash: '#/themes', routes: { '/api/themes': async (opts) => { if (opts.method === 'POST') { posts.push({ headers: opts.headers, body: JSON.parse(opts.body) }); return listing([saved]); } return listing([]); } } });
  button(env, 'New theme').click();
  typeInto(env, 'theme-name', 'Mine');
  field(env, 'theme-base').value = 'dark'; fire(field(env, 'theme-base'), 'change');
  typeInto(env, 'tok-bg', '#202020');
  typeInto(env, 'tok-ink', 'bogus'); // invalid values are not sent: the client refuses to save them
  button(env, 'Save theme').click();
  await tick();
  assert.equal(posts.length, 0, 'nothing is sent while a value is invalid');
  assert.match(view(env).textContent, /Fix the highlighted values/);
  typeInto(env, 'tok-ink', '');
  button(env, 'Save theme').click();
  await tick();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].headers['X-Portal-Token'], 'TOKEN-123');
  assert.equal(posts[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(posts[0].body, { slug: 'mine', name: 'Mine', base: 'dark', tokens: { bg: '#202020' } });
  assert.match(view(env).textContent, /Saved/);
  assert.deepEqual(options(env).at(-1), ['custom:mine', 'Mine']);
});

test('a new theme whose slug is taken gets a free one instead of overwriting', async () => {
  const { env, posts } = await boot({ hash: '#/themes' });
  button(env, 'New theme').click();
  typeInto(env, 'theme-name', 'Night');
  button(env, 'Save theme').click();
  await tick();
  assert.equal(posts[0].body.slug, 'night-2');
});

test('a server refusal is shown with its explanation and the draft is kept', async () => {
  const { env } = await boot({ hash: '#/themes', routes: { '/api/themes': async (opts) => (opts.method === 'POST' ? { __status: 400, error: 'bg: bad', code: 'theme.value' } : listing([])) } });
  button(env, 'New theme').click();
  typeInto(env, 'theme-name', 'Mine');
  typeInto(env, 'tok-bg', '#202020');
  button(env, 'Save theme').click();
  await tick();
  assert.match(view(env).textContent, /▲/);
  assert.match(view(env).textContent, /bg: bad/);
  assert.equal(field(env, 'tok-bg').value, '#202020');
});

test('Delete asks first, then posts the slug; if it was the chosen theme the portal returns to System', async () => {
  const { env, posts, root, storage } = await boot({ hash: '#/themes', storage: memoryStorage({ 'amauta-theme': 'custom:night' }) });
  tree(view(env)).find((e) => e.attrs['data-edit'] === 'night').click();
  assert.equal(field(env, 'theme-name').value, 'Night');
  assert.equal(field(env, 'tok-bg').value, '#101010');
  button(env, 'Delete theme').click();
  assert.equal(posts.length, 0, 'the first click only asks');
  assert.match(view(env).textContent, /Delete the theme/);
  button(env, 'Yes, delete').click();
  await tick();
  assert.deepEqual(posts.map((p) => [p.path, p.body]), [['delete', { slug: 'night' }]]);
  assert.equal(storage.data['amauta-theme'], 'system');
  assert.deepEqual(root.attrs, {});
  assert.ok(!options(env).some(([v]) => v === 'custom:night'));
});

test('Delete can be cancelled', async () => {
  const { env, posts } = await boot({ hash: '#/themes' });
  tree(view(env)).find((e) => e.attrs['data-edit'] === 'night').click();
  button(env, 'Delete theme').click();
  button(env, 'Go back').click();
  assert.equal(posts.length, 0);
  assert.ok(button(env, 'Delete theme'));
});

test('Import reads a JSON file in the browser, validates it, and fills the editor as a new draft', async () => {
  const { env, posts } = await boot({ hash: '#/themes' });
  const input = field(env, 'theme-import');
  assert.equal(input.attrs.type, 'file');
  input.files = [{ size: 80, text: async () => JSON.stringify({ name: 'Imported', base: 'dark', tokens: { bg: '#0A0A0A', accent: 'oklch(0.8 0.1 30)' } }) }];
  fire(input, 'change');
  await tick();
  assert.equal(field(env, 'theme-name').value, 'Imported');
  assert.equal(field(env, 'theme-base').value, 'dark');
  assert.equal(field(env, 'tok-bg').value, '#0a0a0a');
  assert.equal(posts.length, 0, 'nothing is saved until the person saves');
});

test('Import refuses bad files with a reason, and keeps what was in the editor', async () => {
  const { env, root } = await boot({ hash: '#/themes' });
  button(env, 'New theme').click();
  typeInto(env, 'theme-name', 'Keep me');
  const input = field(env, 'theme-import');
  for (const text of ['{nope', JSON.stringify({ name: 'x', base: 'dark', tokens: { bg: 'url(http://evil)' } }), JSON.stringify({ name: 'x', base: 'dark', tokens: {}, extra: 1 }), JSON.stringify([1])]) {
    input.files = [{ size: text.length, text: async () => text }];
    fire(input, 'change');
    await tick();
    assert.match(view(env).textContent, /could not be imported/, text);
    assert.equal(field(env, 'theme-name').value, 'Keep me');
  }
  input.files = [{ size: 1_000_000, text: async () => assert.fail('a huge file is never read') }];
  fire(input, 'change');
  await tick();
  assert.match(view(env).textContent, /too large/);
  assert.ok(!('--bg' in root.props));
});

test('Export downloads the draft as JSON through a Blob and an a[download] link, without the slug', async () => {
  const { env, blobs, created, anchors } = await boot({ hash: '#/themes' });
  tree(view(env)).find((e) => e.attrs['data-edit'] === 'night').click();
  button(env, 'Export').click();
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, 'application/json');
  assert.deepEqual(JSON.parse(blobs[0].text), { name: 'Night', base: 'dark', tokens: { bg: '#101010', accent: 'oklch(0.8 0.1 30)' } });
  assert.equal(created.length, 1);
  const a = anchors.at(-1);
  assert.equal(a.attrs.download, 'night.json');
  assert.equal(a.attrs.href, 'blob:fake');
});

test('leaving the editor drops the preview and shows the chosen theme again', async () => {
  const { env, root } = await boot({ hash: '#/themes' });
  button(env, 'New theme').click();
  typeInto(env, 'tok-bg', '#202020');
  assert.equal(root.props['--bg'], '#202020');
  await go(env, '#/');
  assert.deepEqual([root.attrs, root.props], [{}, {}]);
});

test('with a chosen theme, the editor preview ends back on that theme', async () => {
  const { env, root } = await boot({ hash: '#/themes', storage: memoryStorage({ 'amauta-theme': 'custom:night' }) });
  button(env, 'New theme').click();
  field(env, 'theme-base').value = 'light'; fire(field(env, 'theme-base'), 'change');
  typeInto(env, 'tok-bg', '#ffffff');
  assert.equal(root.attrs['data-theme'], 'light');
  await go(env, '#/');
  assert.equal(root.attrs['data-theme'], 'dark');
  assert.deepEqual(root.props, { '--bg': '#101010', '--accent': 'oklch(0.8 0.1 30)' });
});
