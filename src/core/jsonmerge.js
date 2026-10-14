// JSON merge helpers for settings.json / .claude.json style files.

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : structuredClone(v));

const isReplaceWrapper = (v) =>
  isPlainObject(v) && Object.keys(v).length === 1 && Object.hasOwn(v, '__replace__');

function merge(base, overlay) {
  if (isReplaceWrapper(overlay)) return clone(overlay.__replace__);
  if (!isPlainObject(overlay)) return clone(overlay);
  const out = isPlainObject(base) ? { ...clone(base) } : {};
  for (const [key, value] of Object.entries(overlay)) {
    out[key] = merge(out[key], value);
  }
  return out;
}

/**
 * Deep-merge `overlay` into `base` without mutating either.
 * Objects merge recursively; arrays and scalars take the overlay;
 * `{"__replace__": value}` replaces the base value wholesale.
 */
export function deepMerge(base, overlay) {
  return merge(base, overlay);
}

function hooksOf(settings) {
  const hooks = settings.hooks;
  if (hooks === undefined) return {};
  if (!isPlainObject(hooks)) throw new Error('unsupported hooks shape: settings.hooks is not an object');
  return hooks;
}

const commandsOf = (entries) =>
  new Set(entries.flatMap((e) => (Array.isArray(e?.hooks) ? e.hooks.map((h) => h?.command) : [])));

/**
 * Append hook entries to settings.hooks[event] without duplicating an
 * identical command already registered for that event. Never overwrites.
 * `additions` is { Event: [{ matcher, hooks: [{ type, command, timeout }] }] }.
 */
export function mergeHooks(settings, additions) {
  const out = clone(settings);
  const hooks = hooksOf(out);
  for (const [event, entries] of Object.entries(additions)) {
    const current = hooks[event] ?? [];
    if (!Array.isArray(current)) throw new Error(`unsupported hooks shape: hooks.${event} is not an array`);
    const known = commandsOf(current);
    const next = [...current];
    for (const entry of entries) {
      const fresh = entry.hooks.filter((h) => !known.has(h.command));
      if (fresh.length === 0) continue;
      fresh.forEach((h) => known.add(h.command));
      next.push({ ...clone(entry), hooks: clone(fresh) });
    }
    hooks[event] = next;
  }
  out.hooks = hooks;
  return out;
}

/** Remove every hook whose command starts with `prefix`; prune emptied containers. */
export function removeHooksByCommandPrefix(settings, prefix) {
  return removeHooksWhere(settings, (command) => command.startsWith(prefix));
}

/** Remove every hook whose command satisfies `predicate`; prune emptied containers. */
export function removeHooksWhere(settings, predicate) {
  const out = clone(settings);
  if (!isPlainObject(out.hooks)) return out;
  let changed = false;
  for (const [event, entries] of Object.entries(out.hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = [];
    for (const entry of entries) {
      if (!Array.isArray(entry?.hooks)) {
        kept.push(entry);
        continue;
      }
      const remaining = entry.hooks.filter((h) => !(typeof h?.command === 'string' && predicate(h.command)));
      if (remaining.length === entry.hooks.length) kept.push(entry);
      else {
        changed = true;
        if (remaining.length > 0) kept.push({ ...entry, hooks: remaining });
      }
    }
    if (kept.length === 0 && entries.length > 0) delete out.hooks[event];
    else out.hooks[event] = kept;
  }
  if (changed && Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}
