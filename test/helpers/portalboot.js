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

export async function runPortal(env, extra = {}) {
  const context = vm.createContext({ ...env, URLSearchParams, console, setTimeout, clearTimeout, setInterval: () => 0, ...extra });
  for (const file of SCRIPTS) vm.runInContext(await readFile(path.join(STATIC, file), 'utf8'), context, { filename: file });
  return context;
}
