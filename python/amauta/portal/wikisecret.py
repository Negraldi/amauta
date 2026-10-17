"""Masking for configuration the wiki shows: MCP server specs and hook commands. Secrets never leave this module.

Rules: values of env and headers are never shown (keys only); the value after a flag whose name says secret (--token, --api-key, ...) is masked;
anything that looks like a credential is masked wherever it appears (sk-, ghp_, github_pat_, xox*, Bearer, long base64/hex, URL credentials,
`NAME=value` with a secret-looking NAME, Authorization-style headers passed as arguments). Everything is bounded.
"""
from __future__ import annotations

import re
import shlex
from urllib.parse import parse_qsl, urlsplit

MASK = "***"
MAX_ARGS = 100
MAX_ARG = 300
MAX_COMMAND = 600
MAX_KEYS = 50
_SECRET_WORD = r"(?:token|key|secret|passw(?:or)?d|passwd|pwd|credential|auth|bearer|cookie)"
SECRET_FLAG = re.compile(rf"^-{{1,2}}[\w-]*{_SECRET_WORD}[\w-]*$", re.I)
SECRET_FLAG_EQ = re.compile(rf"^(-{{1,2}}[\w-]*{_SECRET_WORD}[\w-]*)=.*$", re.I | re.S)
HEADER_FLAGS = {"-H", "--header", "--headers"}
HEADER_VALUE = re.compile(rf"^\s*[\w-]*{_SECRET_WORD}[\w-]*\s*:", re.I)
ASSIGN = re.compile(rf"^([A-Za-z_][A-Za-z0-9_]*{_SECRET_WORD}[A-Za-z0-9_]*|{_SECRET_WORD}[A-Za-z0-9_]*)=(.*)$", re.I | re.S)
PREFIXES = re.compile(r"^(?:sk-|sk_|ghp_|gho_|ghs_|ghu_|github_pat_|xox[abprs]-|glpat-|AKIA[0-9A-Z]{8}|AIza|ya29\.|eyJ[A-Za-z0-9_-]{10})", re.I)
LONG_TOKEN = re.compile(r"^[A-Za-z0-9_+=-]{32,}$")
URL_CREDENTIALS = re.compile(r"^[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@", re.I)


def _looks_secret(value: str) -> bool:
    v = value.strip()
    if v.lower().startswith("bearer ") or v.lower().startswith("basic "):
        return True
    if PREFIXES.match(v) or URL_CREDENTIALS.match(v):
        return True
    return bool(LONG_TOKEN.match(v)) and bool(re.search(r"\d", v)) and bool(re.search(r"[A-Za-z]", v))


def mask_args(args) -> list:
    """The argument list with secrets replaced by MASK; bounded in count and length. Not a list gives []."""
    if not isinstance(args, list):
        return []
    out, hide_next, header_next = [], False, False
    for raw in args[:MAX_ARGS]:
        arg = str(raw)[:MAX_ARG]
        if hide_next:
            out.append(MASK)
            hide_next = False
        elif header_next:
            out.append(MASK if HEADER_VALUE.match(arg) or _looks_secret(arg) else arg)
            header_next = False
        elif (m := SECRET_FLAG_EQ.match(arg)):
            out.append(f"{m.group(1)}={MASK}")
        elif SECRET_FLAG.match(arg):
            out.append(arg)
            hide_next = True
        elif arg in HEADER_FLAGS:
            out.append(arg)
            header_next = True
        elif (m := ASSIGN.match(arg)):
            out.append(f"{m.group(1)}={MASK}")
        elif _looks_secret(arg):
            out.append(MASK)
        else:
            out.append(arg)
    return out


def _join(tokens) -> str:
    return " ".join(f"'{t}'" if re.search(r"\s", t) else t for t in tokens)


def mask_command(command) -> str:
    """A shell command line shown without secrets: tokenized like a shell (whitespace split when quotes are unbalanced), masked, rejoined."""
    text = str(command or "")[:MAX_COMMAND * 4]
    try:
        tokens = shlex.split(text)
    except ValueError:
        tokens = text.split()
    return _join(mask_args(tokens))[:MAX_COMMAND]


def mask_url(url) -> str:
    """scheme://host/path with credentials removed and every query value masked (the query keys stay so the shape is visible)."""
    if not isinstance(url, str) or not url:
        return ""
    try:
        parts = urlsplit(url.strip()[:MAX_ARG * 2])
        host = parts.hostname or ""
        if not parts.scheme or not host:
            return MASK if _looks_secret(url) else url[:MAX_ARG]
        netloc = host + (f":{parts.port}" if parts.port else "")
    except ValueError:
        return MASK
    query = "&".join(f"{k}={MASK}" for k, _ in parse_qsl(parts.query, keep_blank_values=True)[:MAX_KEYS])
    return f"{parts.scheme}://{netloc}{parts.path}" + (f"?{query}" if query else "")


def _keys(value) -> list:
    return sorted(str(k)[:100] for k in value)[:MAX_KEYS] if isinstance(value, dict) else []


def server_facts(spec) -> dict:
    """What the wiki may show of one MCP server config: type, command, masked args, masked url, env and header KEYS. Never a value."""
    if not isinstance(spec, dict):
        return {"type": "unknown", "command": None, "args": [], "url": None, "env_keys": [], "header_keys": []}
    command = spec.get("command")
    stype = spec.get("type") if isinstance(spec.get("type"), str) and spec.get("type") else ("stdio" if command else ("http" if spec.get("url") else "unknown"))
    return {"type": stype[:20], "command": mask_command(command) if isinstance(command, str) else None, "args": mask_args(spec.get("args")),
            "url": mask_url(spec.get("url")) or None, "env_keys": _keys(spec.get("env")), "header_keys": _keys(spec.get("headers"))}
