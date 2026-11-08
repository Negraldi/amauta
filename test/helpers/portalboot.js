// Runs the portal's static scripts in one fake-DOM context, in the order index.html loads them.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'amauta', 'portal', 'static');
/** The portal UI, split by page (plan N11), in load order. */
export const APP_SCRIPTS = ['app.js', 'page-activity.js', 'page-memory.js', 'page-harness.js', 'page-wiki.js', 'page-projects.js', 'page-settings.js', 'page-themes.js', 'page-home.js', 'boot.js'];
export const SCRIPTS = ['i18n.js', 'theme.js', 'markdown.js', 'wikiroute.js', ...APP_SCRIPTS];
/** The whole UI source as one text, for tests that search it. */
export const readApp = async () => (await Promise.all(APP_SCRIPTS.map((f) => readFile(path.join(STATIC, f), 'utf8')))).join('\n');

/** The dictionaries (plan N11b), keyed like AmautaI18n.dict. */
const DICT_FILES = { en: 'en.json', es: 'es.json', srv: 'srv-es.json' };
export async function readDicts() {
  const out = {};
  for (const [k, f] of Object.entries(DICT_FILES)) out[k] = JSON.parse(await readFile(path.join(STATIC, 'i18n', f), 'utf8'));
  return out;
}

// The page fetches its dictionaries from /static/i18n/; they are served here from the files, outside env.calls.
export async function runPortal(env, extra = {}) {
  const files = Object.fromEntries(Object.entries(await readDicts()).map(([k, v]) => [DICT_FILES[k], v]));
  const fetch = async (url, opts) => {
    const m = /^\/static\/i18n\/([\w-]+\.json)$/.exec(String(url));
    return m ? { ok: Boolean(files[m[1]]), status: files[m[1]] ? 200 : 404, json: async () => files[m[1]] } : env.fetch(url, opts);
  };
  const context = vm.createContext({ ...env, fetch, URLSearchParams, console, setTimeout, clearTimeout, setInterval: () => 0, ...extra });
  for (const file of SCRIPTS) vm.runInContext(await readFile(path.join(STATIC, file), 'utf8'), context, { filename: file });
  return context;
}
