// Tiny DOM stand-in, just enough to run the portal's app.js and inspect what it builds.
export class NodeBase {}
export class Text extends NodeBase {
  constructor(data) { super(); this.data = String(data); this.nodeType = 3; }
  get textContent() { return this.data; }
}
export class Element extends NodeBase {
  constructor(tag, ns) { super(); this.tagName = tag.toLowerCase(); this.ns = ns; this.children = []; this.attrs = {}; this.listeners = {}; this._text = null; this.dataset = {}; this.hidden = false; this.value = ''; this.className = ''; this.nodeType = 1; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  append(...kids) { for (const k of kids) this.children.push(k); }
  replaceChildren(...kids) { this.children = []; this._text = null; this.append(...kids); }
  get content() { return this.attrs.content; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text ?? this.children.map((c) => c.textContent).join(''); }
  get options() { return this.children.filter((c) => c.tagName === 'option'); }
  focus() { this.focused = true; }
  click() { for (const fn of this.listeners.click ?? []) fn({ target: this }); }
  walk(fn) { fn(this); for (const c of this.children) if (c instanceof Element) c.walk(fn); }
}
export function makeEnv(routes) {
  const byId = new Map();
  const token = new Element('meta');
  token.setAttribute('content', 'TOKEN-123');
  const docListeners = {};
  const document = {
    title: '',
    addEventListener: (type, fn) => { (docListeners[type] ??= []).push(fn); },
    createElement: (t) => new Element(t),
    createElementNS: (ns, t) => new Element(t, ns),
    createTextNode: (d) => new Text(d),
    querySelector: (sel) => (sel.includes('portal-token') ? token : null),
    getElementById: (id) => { if (!byId.has(id)) { const e = new Element('div'); e.id = id; byId.set(id, e); } return byId.get(id); },
  };
  for (const id of ['days', 'project']) { const e = document.getElementById(id); e.value = id === 'days' ? '30' : ''; }
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const path = String(url).split('?')[0];
    let body = routes[path];
    if (typeof body === 'function') body = await body(opts, url); // a route may compute its answer (and see the request)
    if (body && body.__status) { const { __status: status, ...rest } = body; return { ok: false, status, json: async () => rest }; }
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body ?? { error: 'not found' } };
  };
  const location = { hash: '' };
  const listeners = {};
  const window = { addEventListener: (t, fn) => { listeners[t] = fn; } };
  return { document, fetch, location, window, calls, listeners, docListeners, byId, Node: NodeBase };
}
