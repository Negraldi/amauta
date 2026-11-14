// Shared boot for the T15 W3 portal tests: one page in one language, with the fake server routes it needs.
import { makeEnv } from './fakedom.js';
import { runPortal } from './portalboot.js';

export const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
export const tree = (el) => { const all = []; el.walk((e) => all.push(e)); return all; };
export const ES = { navigator: { language: 'es-ES' } };
export const page = (kind, over = {}) => ({ kind, id: 'x', title: 'X', body_md: null, meta: [], links: [], backlinks: [], sections: [], ...over });

export async function boot(hash, routes = {}, extra = {}) {
  const env = makeEnv({ '/api/harness/components': { total: 0, pending: 0, groups: [] }, '/api/wiki/recent': { items: [] }, '/api/sessions': { available: false }, '/api/graphify': { repos: [] }, '/api/projects': { projects: [] }, ...routes });
  env.location.hash = hash;
  env.__ctx = await runPortal(env, { DOMParser: class {}, queueMicrotask, ...extra });
  await tick();
  return env;
}
export const view = (env) => env.document.getElementById('view');
export const text = (env) => view(env).textContent;
