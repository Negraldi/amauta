"""HTTP layer: loopback only, strict headers, token + origin checks on the single write endpoint."""
from __future__ import annotations

import hmac
import json
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from . import archify
from .api import Portal

LOOPBACK = "127.0.0.1"  # fixed on purpose: there is no way to bind another interface
STATIC = Path(__file__).resolve().parent / "static"
JS, WOFF2 = "text/javascript; charset=utf-8", "font/woff2"
STATIC_FILES = {"app.js": JS, "markdown.js": JS, "wikiroute.js": JS, "mermaid.min.js": JS, "style.css": "text/css; charset=utf-8",
                "manifest.webmanifest": "application/manifest+json", "icon.svg": "image/svg+xml",
                "fonts/source-serif-4-latin-400-normal.woff2": WOFF2, "fonts/source-serif-4-latin-400-italic.woff2": WOFF2,
                "fonts/source-serif-4-latin-600-normal.woff2": WOFF2}
MAX_BODY = 1024
# Mermaid writes a <style> element and style attributes into the SVG it draws, so styles (and only styles) allow 'unsafe-inline';
# scripts stay 'self' only, with no eval, and nothing can be loaded or sent anywhere but this origin.
# frame-src 'self' is the only addition for archify: the Harness page embeds /archify/<hash>.html in a sandboxed iframe.
CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; "
       "frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
# The archify viewer is one self-contained page with inline script and style, so it gets its OWN policy instead of loosening the portal's: it runs in an
# opaque origin (`sandbox allow-scripts`, no allow-same-origin: no cookies, storage or access to the portal), cannot load or send anything
# (default-src/connect-src 'none'; only data: fonts and images), and may be framed by this origin only.
ARCHIFY_CSP = ("sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; "
               "connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
_ARCHIFY_PATH = re.compile(r"^/archify/([0-9a-f]{64})\.html$")


class IdleMonitor:
    """Thread-safe 'no heartbeat for N seconds' timer; the clock is injectable so tests never sleep."""

    def __init__(self, timeout: float, clock=time.monotonic):
        if timeout <= 0:
            raise ValueError("idle timeout must be positive")
        self.timeout = timeout
        self._clock = clock
        self._lock = threading.Lock()
        self._last = clock()

    def beat(self) -> None:
        with self._lock:
            self._last = self._clock()

    def expired(self) -> bool:
        with self._lock:
            return self._clock() - self._last >= self.timeout


class PortalServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, cfg, port, idle_exit=None, clock=time.monotonic):
        super().__init__((LOOPBACK, port), Handler)
        self.idle = IdleMonitor(idle_exit, clock) if idle_exit else None
        self.portal = Portal(cfg)
        self.token = secrets.token_urlsafe(32)
        self.port = self.server_address[1]

    def allowed_hosts(self):
        return {f"{LOOPBACK}:{self.port}", f"localhost:{self.port}"}


def make_server(cfg, port: int = 8765, idle_exit=None, clock=time.monotonic) -> PortalServer:
    return PortalServer(cfg, port, idle_exit=idle_exit, clock=clock)


def watch_idle(srv: PortalServer, interval: float = 1.0) -> threading.Thread:
    """Start a daemon thread that stops `srv.serve_forever()` once the idle monitor expires (no-op without one)."""
    def run():
        while srv.idle is not None and not srv.idle.expired():
            time.sleep(interval)
        if srv.idle is not None:
            srv.shutdown()
    t = threading.Thread(target=run, name="amauta-portal-idle", daemon=True)
    t.start()
    return t


class Handler(BaseHTTPRequestHandler):
    server_version = "amauta-portal"
    sys_version = ""

    def log_message(self, fmt, *args):  # quiet: no request logging of query strings
        pass

    # ---- helpers --------------------------------------------------------------------------
    def _send(self, status, body: bytes, ctype: str, csp: str = CSP):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", csp)
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, data):
        self._send(status, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _host_ok(self):
        if self.headers.get("Host") in self.server.allowed_hosts():
            return True
        self._json(403, {"error": "forbidden host"})
        return False

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        return origin in {f"http://{h}" for h in self.server.allowed_hosts()}

    # ---- verbs ----------------------------------------------------------------------------
    def do_GET(self):
        if not self._host_ok():
            return
        url = urlsplit(self.path)
        if url.path == "/":
            page = (STATIC / "index.html").read_text().replace("__PORTAL_TOKEN__", self.server.token)
            return self._send(200, page.encode(), "text/html; charset=utf-8")
        if url.path.startswith("/static/"):
            name = url.path[len("/static/"):]
            if name in STATIC_FILES:  # exact whitelist: no path is ever joined from the request
                return self._send(200, (STATIC / name).read_bytes(), STATIC_FILES[name])
            return self._json(404, {"error": "not found"})
        m = _ARCHIFY_PATH.match(url.path)
        if m:  # only pages this process rendered itself, looked up by hash: no input ever reaches the renderer from here
            page = archify.cached(m.group(1))
            if page is None:
                return self._json(404, {"error": "not found"})
            return self._send(200, page, "text/html; charset=utf-8", csp=ARCHIFY_CSP)
        if url.path.startswith("/api/"):
            try:
                query = dict(parse_qsl(url.query, keep_blank_values=True, max_num_fields=20))
            except ValueError:
                return self._json(400, {"error": "too many or malformed query parameters"})
            status, body = self.server.portal.get(url.path, query)
            return self._json(status, body)
        self._json(404, {"error": "not found"})

    def _write_guard(self):
        """Host, same-origin and token checks shared by every POST endpoint; True when the request may proceed."""
        if not self._origin_ok() or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
            self._json(403, {"error": "cross-origin request refused"})
            return False
        supplied = self.headers.get("X-Portal-Token", "")
        if not hmac.compare_digest(supplied.encode(), self.server.token.encode()):
            self._json(403, {"error": "missing or wrong token"})
            return False
        return True

    def do_POST(self):
        if not self._host_ok():
            return
        path = urlsplit(self.path).path
        if path not in ("/api/refresh", "/api/heartbeat"):
            return self._json(404, {"error": "not found"})
        if not self._write_guard():
            return
        if path == "/api/heartbeat":
            if self.server.idle is not None:
                self.server.idle.beat()
            return self._json(200, {"ok": True})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json(400, {"error": "invalid Content-Length"})
        if length < 0:
            return self._json(400, {"error": "invalid Content-Length"})
        if length > MAX_BODY:
            return self._json(413, {"error": "body too large"})
        if length:
            self.rfile.read(length)
        status, body = self.server.portal.refresh()
        self._json(status, body)

    def _not_allowed(self):
        self._json(405, {"error": "method not allowed"})

    do_PUT = do_DELETE = do_PATCH = _not_allowed
