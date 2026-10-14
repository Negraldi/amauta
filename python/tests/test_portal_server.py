import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from python.gentle_lite.portal import server
from python.gentle_lite.portal.config import Config
from python.tests import portal_fixtures as fx
from python.tests.test_usage import assistant, write_jsonl


class ServerBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.f = fx.build(Path(self.tmp.name))
        self.cfg = Config(state_dir=self.f["state"], claude_home=self.f["home"], engram_db=self.f["engram"], repos=[self.f["repo"]])
        self.srv = server.make_server(self.cfg, port=0)
        self.addCleanup(self.srv.server_close)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.shutdown)
        self.port = self.srv.server_address[1]

    def request(self, method, path, headers=None, body=None, host=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": host or f"127.0.0.1:{self.port}", **(headers or {})}
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, dict((k.lower(), v) for k, v in r.getheaders()), data

    def token(self):
        _, _, html = self.request("GET", "/")
        marker = b'name="portal-token" content="'
        start = html.index(marker) + len(marker)
        return html[start:html.index(b'"', start)].decode()


class BindingTest(ServerBase):
    def test_binds_loopback_only(self):
        self.assertEqual(self.srv.server_address[0], "127.0.0.1")

    def test_make_server_has_no_host_parameter(self):
        with self.assertRaises(TypeError):
            server.make_server(self.cfg, port=0, host="0.0.0.0")


class ReadTest(ServerBase):
    def test_index_has_token_and_strict_headers(self):
        status, h, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", h["content-type"])
        self.assertIn("default-src 'none'", h["content-security-policy"])
        self.assertNotIn("unsafe-inline", h["content-security-policy"])
        self.assertEqual(h["x-content-type-options"], "nosniff")
        self.assertEqual(h["cache-control"], "no-store")
        self.assertTrue(len(self.token()) >= 32)

    def test_token_is_random_per_process(self):
        other = server.make_server(self.cfg, port=0)
        self.addCleanup(other.server_close)
        self.assertNotEqual(self.srv.token, other.token)

    def test_api_returns_json_and_raw_data_is_only_ever_json_encoded(self):
        status, h, body = self.request("GET", "/api/memories?source=own")
        self.assertEqual(status, 200)
        self.assertEqual(h["content-type"], "application/json; charset=utf-8")
        self.assertIn(fx.XSS, [i["title"] for i in json.loads(body)["items"]])

    def test_static_whitelist_and_traversal(self):
        for ok in ("/static/app.js", "/static/style.css"):
            self.assertEqual(self.request("GET", ok)[0], 200, ok)
        for bad in ("/static/../api.py", "/static/%2e%2e/api.py", "/static/nope.js", "/api/nope", "/..%2f..%2fetc/passwd", "/x"):
            self.assertEqual(self.request("GET", bad)[0], 404, bad)

    def test_unknown_methods_rejected(self):
        for m in ("PUT", "DELETE", "PATCH"):
            self.assertEqual(self.request(m, "/api/overview")[0], 405, m)

    def test_foreign_host_header_is_rejected_against_dns_rebinding(self):
        self.assertEqual(self.request("GET", "/api/overview", host="evil.example")[0], 403)
        self.assertEqual(self.request("GET", "/", host=f"evil.example:{self.port}")[0], 403)
        self.assertEqual(self.request("GET", "/api/overview", host=f"localhost:{self.port}")[0], 200)

    def test_bad_query_is_400(self):
        self.assertEqual(self.request("GET", "/api/overview?days=abc")[0], 400)


class RefreshCsrfTest(ServerBase):
    def setUp(self):
        super().setUp()
        write_jsonl(self.f["home"] / "projects" / "-work-alpha" / "s1.jsonl", [assistant("zz", session="s1", ts="2026-10-04T00:00:00.000Z", cwd="/work/alpha")], mode="a")

    def post(self, token=None, origin=None, body=b"", extra=None):
        h = {"Content-Type": "application/json", **(extra or {})}
        if token is not None:
            h["X-Portal-Token"] = token
        if origin is not None:
            h["Origin"] = origin
        return self.request("POST", "/api/refresh", headers=h, body=body)

    def messages(self):
        return json.loads(self.request("GET", "/api/overview?days=3650")[2])["totals"]["messages"]

    def test_requires_token(self):
        before = self.messages()
        self.assertEqual(self.post()[0], 403)
        self.assertEqual(self.post(token="wrong")[0], 403)
        self.assertEqual(self.messages(), before)

    def test_cross_origin_is_rejected_even_with_token(self):
        before = self.messages()
        self.assertEqual(self.post(token=self.token(), origin="http://evil.example")[0], 403)
        self.assertEqual(self.post(token=self.token(), origin="null")[0], 403)
        self.assertEqual(self.messages(), before)

    def test_same_origin_with_token_ingests(self):
        before = self.messages()
        status, _, body = self.post(token=self.token(), origin=f"http://127.0.0.1:{self.port}")
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["messages"], 1)
        self.assertEqual(self.messages(), before + 1)

    def test_oversized_body_rejected(self):
        self.assertEqual(self.post(token=self.token(), body=b"x" * 5000)[0], 413)

    def test_get_refresh_is_not_a_thing(self):
        self.assertEqual(self.request("GET", "/api/refresh")[0], 404)


if __name__ == "__main__":
    unittest.main()
