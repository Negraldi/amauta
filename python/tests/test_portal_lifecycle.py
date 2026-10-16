import json
import threading
import time
import unittest

from python.amauta.portal import server
from python.tests.test_portal_server import ServerBase


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class IdleMonitorTest(unittest.TestCase):
    def test_expires_only_after_the_timeout_without_a_beat(self):
        clock = FakeClock()
        m = server.IdleMonitor(30, clock=clock)
        clock.now += 29.9
        self.assertFalse(m.expired())
        clock.now += 0.2
        self.assertTrue(m.expired())

    def test_a_beat_resets_the_timer(self):
        clock = FakeClock()
        m = server.IdleMonitor(30, clock=clock)
        clock.now += 25
        m.beat()
        clock.now += 25
        self.assertFalse(m.expired())
        clock.now += 6
        self.assertTrue(m.expired())

    def test_concurrent_beats_are_safe(self):
        m = server.IdleMonitor(30, clock=FakeClock())
        threads = [threading.Thread(target=lambda: [m.beat() for _ in range(500)]) for _ in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertFalse(m.expired())

    def test_rejects_a_non_positive_timeout(self):
        for bad in (0, -1):
            with self.assertRaises(ValueError):
                server.IdleMonitor(bad)


class WatchIdleTest(ServerBase):
    def test_server_without_idle_exit_has_no_monitor(self):
        self.assertIsNone(self.srv.idle)

    def test_watcher_shuts_the_server_down_once_idle(self):
        clock = FakeClock()
        srv = server.make_server(self.cfg, port=0, idle_exit=30, clock=clock)
        self.addCleanup(srv.server_close)
        serving = threading.Thread(target=srv.serve_forever, daemon=True)
        serving.start()
        watcher = server.watch_idle(srv, interval=0.01)
        time.sleep(0.15)
        self.assertTrue(serving.is_alive())  # not idle yet
        clock.now += 31
        serving.join(5)
        self.assertFalse(serving.is_alive())
        watcher.join(5)
        self.assertFalse(watcher.is_alive())


class HeartbeatTest(ServerBase):
    def beat(self, token="__ok__", origin=None, extra=None, method="POST"):
        h = dict(extra or {})
        if token == "__ok__":
            token = self.token()
        if token is not None:
            h["X-Portal-Token"] = token
        if origin is not None:
            h["Origin"] = origin
        return self.request(method, "/api/heartbeat", headers=h)

    def test_valid_heartbeat_is_accepted_and_beats_the_monitor(self):
        clock = FakeClock()
        self.srv.idle = server.IdleMonitor(30, clock=clock)
        clock.now += 20
        status, _, body = self.beat(origin=f"http://127.0.0.1:{self.port}")
        self.assertEqual((status, json.loads(body)), (200, {"ok": True}))
        clock.now += 20
        self.assertFalse(self.srv.idle.expired())

    def test_heartbeat_works_without_a_monitor(self):
        self.assertEqual(self.beat()[0], 200)

    def test_requires_token_and_same_origin_and_good_host(self):
        self.assertEqual(self.beat(token=None)[0], 403)
        self.assertEqual(self.beat(token="wrong")[0], 403)
        self.assertEqual(self.beat(origin="http://evil.example")[0], 403)
        self.assertEqual(self.beat(extra={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request("POST", "/api/heartbeat", headers={"X-Portal-Token": self.token()}, host="evil.example")[0], 403)

    def test_rejected_heartbeat_does_not_beat(self):
        clock = FakeClock()
        self.srv.idle = server.IdleMonitor(30, clock=clock)
        clock.now += 29
        self.beat(token="wrong")
        clock.now += 2
        self.assertTrue(self.srv.idle.expired())

    def test_get_heartbeat_is_not_a_thing(self):
        self.assertEqual(self.beat(method="GET")[0], 404)


class ManifestTest(ServerBase):
    def test_manifest_and_icon_are_served_with_the_right_types(self):
        status, h, body = self.request("GET", "/static/manifest.webmanifest")
        self.assertEqual(status, 200)
        self.assertEqual(h["content-type"].split(";")[0], "application/manifest+json")
        m = json.loads(body)
        self.assertEqual((m["name"], m["display"], m["start_url"]), ("amauta", "standalone", "/"))
        self.assertTrue(m["theme_color"].startswith("#") and m["background_color"].startswith("#"))
        self.assertEqual(m["icons"][0]["src"], "/static/icon.svg")
        status, h, body = self.request("GET", "/static/icon.svg")
        self.assertEqual((status, h["content-type"].split(";")[0]), (200, "image/svg+xml"))
        self.assertTrue(body.startswith(b"<svg") or b"<svg" in body[:200])

    def test_index_links_the_manifest_and_csp_allows_only_self(self):
        _, h, html = self.request("GET", "/")
        self.assertIn(b'rel="manifest" href="/static/manifest.webmanifest"', html)
        self.assertIn("manifest-src 'self'", h["content-security-policy"])
        self.assertIn("default-src 'none'", h["content-security-policy"])


if __name__ == "__main__":
    unittest.main()
