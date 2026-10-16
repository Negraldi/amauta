// Runs the portal's static scripts in one fake-DOM context, in the order index.html loads them.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'python', 'amauta', 'portal', 'static');
export const SCRIPTS = ['markdown.js', 'wikiroute.js', 'app.js'];

export async function runPortal(env, extra = {}) {
  const context = vm.createContext({ ...env, URLSearchParams, console, setTimeout, clearTimeout, ...extra });
  for (const file of SCRIPTS) vm.runInContext(await readFile(path.join(STATIC, file), 'utf8'), context, { filename: file });
  return context;
}
