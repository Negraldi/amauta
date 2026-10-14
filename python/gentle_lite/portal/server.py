"""HTTP layer: loopback only, strict headers, token + origin checks on the single write endpoint."""
from __future__ import annotations

import hmac
import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from .api import Portal

LOOPBACK = "127.0.0.1"  # fixed on purpose: there is no way to bind another interface
STATIC = Path(__file__).resolve().parent / "static"
STATIC_FILES = {"app.js": "text/javascript; charset=utf-8", "style.css": "text/css; charset=utf-8"}
MAX_BODY = 1024
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


class PortalServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, cfg, port):
        super().__init__((LOOPBACK, port), Handler)
        self.portal = Portal(cfg)
        self.token = secrets.token_urlsafe(32)
        self.port = self.server_address[1]

    def allowed_hosts(self):
        return {f"{LOOPBACK}:{self.port}", f"localhost:{self.port}"}


def make_server(cfg, port: int = 8765) -> PortalServer:
    return PortalServer(cfg, port)


class Handler(BaseHTTPRequestHandler):
    server_version = "gentle-lite-portal"
    sys_version = ""

    def log_message(self, fmt, *args):  # quiet: no request logging of query strings
        pass

    # ---- helpers --------------------------------------------------------------------------
    def _send(self, status, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", CSP)
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
        if url.path.startswith("/api/"):
            try:
                query = dict(parse_qsl(url.query, keep_blank_values=True, max_num_fields=20))
            except ValueError:
                return self._json(400, {"error": "too many or malformed query parameters"})
            status, body = self.server.portal.get(url.path, query)
            return self._json(status, body)
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._host_ok():
            return
        if urlsplit(self.path).path != "/api/refresh":
            return self._json(404, {"error": "not found"})
        if not self._origin_ok() or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
            return self._json(403, {"error": "cross-origin request refused"})
        supplied = self.headers.get("X-Portal-Token", "")
        if not hmac.compare_digest(supplied.encode(), self.server.token.encode()):
            return self._json(403, {"error": "missing or wrong token"})
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
