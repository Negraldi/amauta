"""Refresh descriptions: ask the configured local STDIO MCP servers for their tools (`tools/list`) and cache the answer.

Strictly local and bounded: only servers whose config is a command (stdio) are started, with their own command, arguments and env (env goes to the
process and is never logged, returned or stored); http, sse and connector entries are skipped and never contacted. No shell is involved. Each server gets
TIMEOUT seconds; its whole process group is terminated afterwards. Error texts are fixed strings: nothing a server prints reaches the response or the cache.
The cache is `<state>/wiki/mcp-tools.json`, written atomically: {server: {fetched_at, tools: [{name, description, params: [names]}], error?}}.
"""
from __future__ import annotations

import json
import os
import select
import signal
import stat
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import wikiharness, wikitools

TIMEOUT = 10.0
GRACE = 1.5
MAX_PAGES = 10
MAX_TOOLS = 500
MAX_DESCRIPTION = 600
MAX_PARAMS = 40
# One tools/list page of a large server (rea: ~200 tools with full input schemas) is several MB on a single JSON-RPC line. Memory stays bounded by
# MAX_LINE per line and MAX_OUTPUT in total; only name, description[:MAX_DESCRIPTION] and parameter names are kept, so the cache stays small.
MAX_OUTPUT = 32_000_000
MAX_LINE = 16_000_000
MAX_LINES = 400
MAX_PARALLEL = 4
MAX_FILE = 4_000_000
MAX_SERVERS = 50
PROTOCOL = "2025-03-26"
LOCK = threading.Lock()


class ProbeError(Exception):
    def __init__(self, message, status=400, code="probe.invalid"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code

    def body(self):
        return {"error": self.message, "code": self.code}


class _Fail(Exception):
    """One server's failure: the text is one of a few fixed strings."""


class _Reader:
    def __init__(self, fd):
        self.fd, self.buf, self.total, self.scanned = fd, bytearray(), 0, 0
        os.set_blocking(fd, False)

    def line(self, deadline):
        while True:
            i = self.buf.find(b"\n", self.scanned)
            if i >= 0:
                line = bytes(self.buf[:i])
                del self.buf[:i + 1]
                self.scanned = 0
                return line
            self.scanned = len(self.buf)
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.fd], [], [], remaining)[0]:
                raise _Fail("timeout")
            try:
                chunk = os.read(self.fd, 65536)
            except BlockingIOError:
                continue
            except OSError:
                raise _Fail("the server closed the connection") from None
            if not chunk:
                raise _Fail("the server closed the connection")
            self.total += len(chunk)
            self.buf += chunk
            if self.total > MAX_OUTPUT or len(self.buf) > MAX_LINE:
                raise _Fail("response too large")


def _send(proc, message):
    try:
        proc.stdin.write((json.dumps(message) + "\n").encode())
        proc.stdin.flush()
    except (OSError, ValueError):
        raise _Fail("the server closed the connection") from None


def _response(reader, want, deadline):
    """The result object of the response to request `want`; notifications and server requests in between are ignored."""
    for _ in range(MAX_LINES):
        raw = reader.line(deadline)
        if not raw.strip():
            continue
        try:
            msg = json.loads(raw)
        except ValueError:
            raise _Fail("malformed response") from None
        if not isinstance(msg, dict):
            raise _Fail("malformed response")
        if msg.get("id") != want or ("result" not in msg and "error" not in msg):
            continue
        if "error" in msg:
            raise _Fail("the server returned an error")
        if not isinstance(msg["result"], dict):
            raise _Fail("malformed response")
        return msg["result"]
    raise _Fail("malformed response")


def _tool(item):
    if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"]:
        return None
    schema = item.get("inputSchema")
    props = schema.get("properties") if isinstance(schema, dict) else None
    return {"name": item["name"][:100], "description": item["description"][:MAX_DESCRIPTION] if isinstance(item.get("description"), str) else "",
            "params": sorted(str(k)[:60] for k in props)[:MAX_PARAMS] if isinstance(props, dict) else []}


def _stop(proc):
    """Terminate the process group (SIGTERM, then SIGKILL after GRACE) and reap the child."""
    for stream in (proc.stdin, proc.stdout):
        try:
            stream.close()
        except (OSError, ValueError):
            pass
    for sig, wait in ((signal.SIGTERM, GRACE), (signal.SIGKILL, 3.0)):
        try:
            os.killpg(proc.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            proc.wait(timeout=wait)
            break
        except subprocess.TimeoutExpired:
            continue
    try:
        os.killpg(proc.pid, signal.SIGKILL)  # a child that outlived its leader
    except (ProcessLookupError, PermissionError):
        pass


def _probe(spec):
    command, args = spec["command"], [str(a) for a in spec.get("args") or [] if isinstance(a, (str, int, float))]
    env = dict(os.environ)
    env.update({str(k): str(v) for k, v in (spec.get("env") or {}).items() if isinstance(k, str) and isinstance(v, (str, int, float)) and not isinstance(v, bool)})
    try:
        proc = subprocess.Popen([command, *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, start_new_session=True, close_fds=True)
    except (OSError, ValueError):
        raise _Fail("could not start the server") from None
    try:
        deadline = time.monotonic() + TIMEOUT
        reader = _Reader(proc.stdout.fileno())
        _send(proc, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "amauta-portal", "version": "0"}}})
        _response(reader, 1, deadline)
        _send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        tools, cursor = [], None
        for page in range(MAX_PAGES):
            _send(proc, {"jsonrpc": "2.0", "id": 2 + page, "method": "tools/list", "params": {"cursor": cursor} if cursor else {}})
            result = _response(reader, 2 + page, deadline)
            listed = result.get("tools")
            if not isinstance(listed, list):
                raise _Fail("malformed response")
            tools += [t for t in (_tool(i) for i in listed) if t]
            cursor = result.get("nextCursor") if isinstance(result.get("nextCursor"), str) and result.get("nextCursor") else None
            if cursor is None or len(tools) >= MAX_TOOLS:
                break
        return tools[:MAX_TOOLS]
    finally:
        _stop(proc)


def _stdio(spec):
    return spec.get("type") in (None, "stdio") and isinstance(spec.get("command"), str) and bool(spec.get("command"))


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _cache_dir(state_dir):
    d = state_dir / "wiki"
    try:
        if os.path.lexists(d):
            if not stat.S_ISDIR(os.lstat(d).st_mode):
                raise ProbeError("the wiki cache directory is not a plain directory", 400, "probe.dir")
        else:
            d.mkdir(parents=True, exist_ok=True)
    except OSError:
        raise ProbeError("could not create the wiki cache directory", 500, "probe.write") from None
    return d


def _write(d, data):
    text = json.dumps(data, ensure_ascii=False)
    if len(text) > MAX_FILE:
        for entry in data.values():
            for t in entry["tools"]:
                t["description"] = t["description"][:200]
        text = json.dumps(data, ensure_ascii=False)
        if len(text) > MAX_FILE:
            raise ProbeError("the tool list is too large to cache", 413, "probe.toolarge")
    fd, tmp = tempfile.mkstemp(prefix=".mcp-tools-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        os.replace(tmp, d / wikitools.CACHE_PARTS[1])
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise ProbeError("could not write the cache", 500, "probe.write") from None


def _check(body):
    if not isinstance(body, dict) or set(body) - {"server"}:
        raise ProbeError("body must be an object with an optional server name", 400, "probe.shape")
    name = body.get("server")
    if "server" in body and (not isinstance(name, str) or not name or len(name) > 100):
        raise ProbeError("server must be a configured server name", 400, "probe.shape")
    return name


def refresh(portal, body) -> dict:
    name = _check(body)
    configured = {}
    for n, _source, _scope, _path, spec in wikiharness.raw_servers(portal):
        configured.setdefault(n, spec)
    if name is not None and name not in configured:
        raise ProbeError("no such configured server", 404, "probe.unknown")
    targets = [(n, s) for n, s in configured.items() if name in (None, n)]
    if not LOCK.acquire(blocking=False):
        raise ProbeError("a refresh is already running", 409, "probe.busy")
    try:
        d = _cache_dir(portal.cfg.state_dir)
        cache = wikitools.read_cache(portal)
        runnable = [(n, s) for n, s in targets if _stdio(s)]

        def one(item):
            try:
                return item[0], _probe(item[1]), None
            except _Fail as err:
                return item[0], None, str(err)

        with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
            done = {n: (tools, err) for n, tools, err in pool.map(one, runnable)}
        results, at = [], _now()
        for n, _spec in targets:
            if n not in done:
                results.append({"server": n, "ok": False, "skipped": True})
                continue
            tools, err = done[n]
            if err is None:
                cache[n] = {"fetched_at": at, "tools": tools}
                results.append({"server": n, "ok": True, "tools": len(tools)})
            else:
                old = cache.get(n) or {"fetched_at": None, "tools": []}
                cache[n] = {"fetched_at": old["fetched_at"], "tools": old["tools"], "error": err}
                results.append({"server": n, "ok": False, "error": err})
        trimmed = dict(list(cache.items())[:MAX_SERVERS])
        _write(d, {k: {kk: vv for kk, vv in v.items() if not (kk == "error" and vv is None)} for k, v in trimmed.items()})
        wikiharness.forget(portal)
        return {"results": results, "at": at}
    finally:
        LOCK.release()
