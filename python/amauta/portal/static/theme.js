"use strict";
// Theme helpers (no DOM of their own): token list, value validation, OKLCH -> sRGB, WCAG contrast, and applying a theme to the root element.
// A theme reaches the page ONLY through root.style.setProperty / removeProperty (CSSOM, allowed by the CSP) and the data-theme attribute:
// never a style attribute or markup. The server (themes.py) is the authority on what may be stored; validateTheme mirrors it so the editor
// and Import can report problems before a save.
(function () {
  // docs/DESIGN.md color table, in order; each maps to the CSS custom property --<token> that style.css uses.
  const TOKENS = ["bg", "surface", "sidebar", "ink", "ink-muted", "line", "accent", "accent-soft", "warn", "ok", "c-input", "c-output", "c-cache-read", "c-cache-write"];
  // The built-in schemes (same values as style.css; a test keeps them equal). Missing tokens of a custom theme fall back to its base.
  const BASES = {
    light: { bg: "oklch(0.985 0.004 200)", surface: "oklch(1 0 0)", sidebar: "oklch(0.965 0.006 200)", ink: "oklch(0.23 0.012 200)", "ink-muted": "oklch(0.45 0.012 200)", line: "oklch(0.89 0.008 200)",
      accent: "oklch(0.50 0.09 200)", "accent-soft": "oklch(0.95 0.025 200)", warn: "oklch(0.52 0.15 70)", ok: "oklch(0.50 0.12 150)",
      "c-input": "oklch(0.55 0.13 255)", "c-output": "oklch(0.68 0.14 60)", "c-cache-read": "oklch(0.62 0.11 165)", "c-cache-write": "oklch(0.58 0.13 300)" },
    dark: { bg: "oklch(0.19 0.008 200)", surface: "oklch(0.225 0.009 200)", sidebar: "oklch(0.165 0.008 200)", ink: "oklch(0.93 0.006 200)", "ink-muted": "oklch(0.74 0.01 200)", line: "oklch(0.32 0.01 200)",
      accent: "oklch(0.78 0.09 200)", "accent-soft": "oklch(0.30 0.04 200)", warn: "oklch(0.80 0.13 75)", ok: "oklch(0.78 0.12 150)",
      "c-input": "oklch(0.75 0.11 255)", "c-output": "oklch(0.80 0.12 60)", "c-cache-read": "oklch(0.80 0.10 165)", "c-cache-write": "oklch(0.76 0.10 300)" },
  };
  const MAX_NAME = 60, MIN_CONTRAST = 4.5;
  const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const NUM = "(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
  const OKLCH = new RegExp(`^oklch\\(\\s*(${NUM})\\s+(${NUM})\\s+(${NUM})\\s*\\)$`, "i");
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const RANGES = [1, 0.5, 360]; // upper bounds of lightness, chroma, hue

  // The value as {kind, ...} or null. Same rules as the server: oklch(L C H) in range, or #rrggbb; nothing else.
  function parse(v) {
    if (typeof v !== "string" || v.length > 40) return null;
    if (HEX.test(v)) return { kind: "hex", hex: v.toLowerCase() };
    const m = OKLCH.exec(v);
    if (!m) return null;
    const n = m.slice(1, 4);
    return n.every((g, i) => Number(g) <= RANGES[i]) ? { kind: "oklch", n, lch: n.map(Number) } : null;
  }
  const isValidValue = (v) => parse(v) !== null;
  function normalizeValue(v) {
    const p = parse(v);
    return !p ? null : p.kind === "hex" ? p.hex : `oklch(${p.n.join(" ")})`;
  }

  // ---- color math -----------------------------------------------------------------------------------------------
  function oklchToLinear([L, C, H]) {
    const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
      .map((x) => Math.min(1, Math.max(0, x))); // out-of-gamut colors are clipped
  }
  const decode = (u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  const encode = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  function linear(v) {
    const p = parse(v);
    if (!p) return null;
    if (p.kind === "oklch") return oklchToLinear(p.lch);
    return [1, 3, 5].map((i) => decode(parseInt(p.hex.slice(i, i + 2), 16) / 255));
  }
  function toHex(v) {
    const p = parse(v);
    if (!p) return null;
    if (p.kind === "hex") return p.hex;
    return "#" + oklchToLinear(p.lch).map((x) => Math.round(Math.min(1, Math.max(0, encode(x))) * 255).toString(16).padStart(2, "0")).join("");
  }
  function luminance(v) {
    const c = linear(v);
    return c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : null;
  }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return x == null || y == null ? null : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // Text tokens are held to 4.5:1 against the two reading surfaces; the accent (links and the focus ring) to 3:1 against the page background, the
  // WCAG minimum for a non-text indicator. Missing or invalid tokens use the base value, so only real problems warn.
  const PAIRS = [["ink", "bg", MIN_CONTRAST], ["ink", "surface", MIN_CONTRAST], ["ink-muted", "bg", MIN_CONTRAST], ["ink-muted", "surface", MIN_CONTRAST], ["accent", "bg", 3]];
  function contrastWarnings(base, tokens) {
    const eff = { ...(BASES[base] || BASES.light) };
    for (const [k, v] of Object.entries(tokens || {})) if (TOKENS.includes(k) && isValidValue(v)) eff[k] = v;
    const out = [];
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(eff[fg], eff[bg]);
      if (ratio != null && ratio < min) out.push({ fg, bg, ratio, min });
    }
    return out;
  }

  // ---- theme objects --------------------------------------------------------------------------------------------
  const plainObject = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  // {ok, theme, errors:[{code, token?}]}: the same checks and codes as themes.py (without the slug, which the editor derives).
  function validateTheme(data) {
    const keys = plainObject(data) ? Object.keys(data).sort().join() : "";
    if (keys !== "base,name,tokens" || !plainObject(data.tokens)) return { ok: false, theme: null, errors: [{ code: "theme.shape" }] };
    const errors = [];
    const name = data.name;
    if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(name)) errors.push({ code: "theme.name" });
    if (data.base !== "light" && data.base !== "dark") errors.push({ code: "theme.base" });
    const tokens = {};
    for (const [k, v] of Object.entries(data.tokens)) {
      if (!TOKENS.includes(k)) errors.push({ code: "theme.token", token: k });
      else if (!isValidValue(v)) errors.push({ code: "theme.value", token: k });
      else tokens[k] = normalizeValue(v);
    }
    return errors.length ? { ok: false, theme: null, errors } : { ok: true, theme: { name: name.trim(), base: data.base, tokens }, errors: [] };
  }
  // "Paper Light" -> "paper-light": a slug the server accepts (a-z, 0-9, hyphens, 1-40 characters); "theme" when nothing usable is left.
  function slugify(name) {
    const s = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
    return s || "theme";
  }

  // ---- applying -------------------------------------------------------------------------------------------------
  function clearTokens(root) { for (const t of TOKENS) root.style.removeProperty(`--${t}`); }
  function setTokens(root, tokens) {
    for (const t of TOKENS) if (tokens && isValidValue(tokens[t])) root.style.setProperty(`--${t}`, normalizeValue(tokens[t]));
  }
  // Live preview of a draft: its base scheme plus whichever tokens are valid so far.
  function previewTheme(root, base, tokens) {
    clearTokens(root);
    root.setAttribute("data-theme", base === "dark" ? "dark" : "light");
    setTokens(root, tokens);
  }
  const CHOICE = /^(system|light|dark|custom:[a-z0-9][a-z0-9-]{0,39})$/;
  function findTheme(choice, themes) {
    const slug = String(choice).slice(7);
    const t = (themes || []).find((x) => x && x.slug === slug);
    return t && !t.error && validateTheme({ name: t.name, base: t.base, tokens: t.tokens }).ok ? t : null;
  }
  // "system" follows the OS (no data-theme); "light"/"dark" force a scheme; "custom:<slug>" is the theme's base scheme plus its tokens.
  // A custom theme that is missing or invalid is never applied: the page falls back to System.
  function applyChoice(root, choice, themes) {
    clearTokens(root);
    const custom = typeof choice === "string" && choice.startsWith("custom:") ? findTheme(choice, themes) : null;
    if (choice === "light" || choice === "dark") root.setAttribute("data-theme", choice);
    else if (custom) { root.setAttribute("data-theme", custom.base); setTokens(root, custom.tokens); }
    else root.removeAttribute("data-theme");
  }

  // ---- the viewer's choice (localStorage may be absent or throw: the page must work without it) --------------------
  const KEY = "amauta-theme";
  // The one place the page touches browser storage: undefined when the browser refuses (private mode, blocked site data).
  function storage() { try { return globalThis.localStorage; } catch (_) { return undefined; } }
  const isChoice = (c) => typeof c === "string" && CHOICE.test(c);
  function loadChoice(storage) {
    try { const v = storage.getItem(KEY); return isChoice(v) ? v : "system"; } catch (_) { return "system"; }
  }
  function saveChoice(storage, choice) {
    if (!isChoice(choice)) return false;
    try { storage.setItem(KEY, choice); return true; } catch (_) { return false; }
  }

  globalThis.AmautaTheme = { TOKENS, BASES, MIN_CONTRAST, SLUG, isValidValue, normalizeValue, toHex, luminance, contrast, contrastWarnings, validateTheme, slugify, previewTheme, applyChoice, isChoice, storage, loadChoice, saveChoice };
})();
