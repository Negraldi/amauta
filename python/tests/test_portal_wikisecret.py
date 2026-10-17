import unittest

from python.amauta.portal import wikisecret as ws

M = ws.MASK


class ArgMaskingTest(unittest.TestCase):
    def test_value_after_a_secret_flag_is_masked_whatever_it_looks_like(self):
        for flag in ("--token", "--key", "--api-key", "--password", "--secret", "--access-token", "--client-secret"):
            self.assertEqual(ws.mask_args([flag, "plain"]), [flag, M], flag)

    def test_flag_equals_value_form_is_masked(self):
        self.assertEqual(ws.mask_args(["--token=abc", "--api-key=xyz", "--name=ok"]), [f"--token={M}", f"--api-key={M}", "--name=ok"])

    def test_values_that_look_like_secrets_are_masked_without_a_flag(self):
        for value in ("sk-ant-api03-abcdefghijklmnop", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "github_pat_11ABCDEFG0abcdefghij", "xoxb-1234-5678-abcdef",
                      "Bearer abcdef0123456789", "0123456789abcdef0123456789abcdef", "QWxhZGRpbjpvcGVuIHNlc2FtZQ0123456789ABCDEFGH", "https://user:hunter2@example.com/x"):
            self.assertEqual(ws.mask_args([value]), [M], value)

    def test_ordinary_arguments_are_kept(self):
        args = ["-y", "-P", "@modelcontextprotocol/server-filesystem", "/home/someone/projects/a-very-long-directory-name-for-the-project/sub", "--port", "8080",
                "mcp-server-with-a-rather-long-descriptive-name", "serve", "--flag=value", "python3"]
        self.assertEqual(ws.mask_args(args), args)

    def test_authorization_headers_given_as_arguments_are_masked(self):
        self.assertEqual(ws.mask_args(["-H", "Authorization: token abc"]), ["-H", M])
        self.assertEqual(ws.mask_args(["--header", "X-Api-Key: 123"]), ["--header", M])
        self.assertEqual(ws.mask_args(["-H", "Accept: json"]), ["-H", "Accept: json"])

    def test_env_style_assignments_with_secret_names_are_masked(self):
        self.assertEqual(ws.mask_args(["API_KEY=abc", "GITHUB_TOKEN=def", "PATH=/usr/bin", "DB_PASSWORD=x"]), [f"API_KEY={M}", f"GITHUB_TOKEN={M}", "PATH=/usr/bin", f"DB_PASSWORD={M}"])

    def test_non_string_arguments_become_text_and_the_list_is_bounded(self):
        out = ws.mask_args([1, None, True] + ["a"] * 500)
        self.assertEqual(out[:3], ["1", "None", "True"])
        self.assertLessEqual(len(out), ws.MAX_ARGS)
        self.assertEqual(ws.mask_args("not a list"), [])


class CommandMaskingTest(unittest.TestCase):
    def test_a_command_line_is_tokenized_and_masked(self):
        out = ws.mask_command("env API_KEY=abc python3 -P -m tool --token s3cr3t --name x")
        self.assertNotIn("abc", out)
        self.assertNotIn("s3cr3t", out)
        self.assertIn("python3 -P -m tool", out)
        self.assertIn("--name x", out)

    def test_unbalanced_quotes_do_not_fail_and_text_is_bounded(self):
        self.assertIn("echo", ws.mask_command('echo "unterminated'))
        self.assertLessEqual(len(ws.mask_command("x " * 5000)), ws.MAX_COMMAND)


class UrlMaskingTest(unittest.TestCase):
    def test_credentials_and_query_values_are_masked_but_host_and_path_stay(self):
        out = ws.mask_url("https://user:pw@api.example.com/mcp/v1?api_key=abc&mode=fast")
        self.assertNotIn("pw", out)
        self.assertNotIn("abc", out)
        self.assertNotIn("fast", out)
        self.assertIn("api.example.com/mcp/v1", out)
        self.assertIn("api_key=", out)

    def test_plain_urls_and_garbage(self):
        self.assertEqual(ws.mask_url("http://localhost:3000/sse"), "http://localhost:3000/sse")
        self.assertEqual(ws.mask_url(None), "")


class ServerSpecTest(unittest.TestCase):
    def test_only_keys_of_env_and_headers_are_exposed(self):
        spec = {"type": "http", "url": "https://x.example/mcp?token=zzz", "headers": {"Authorization": "Bearer TOPSECRET"}, "env": {"A_KEY": "ENVSECRET"}}
        out = ws.server_facts(spec)
        text = repr(out)
        for secret in ("TOPSECRET", "ENVSECRET", "zzz"):
            self.assertNotIn(secret, text)
        self.assertEqual((out["type"], out["header_keys"], out["env_keys"]), ("http", ["Authorization"], ["A_KEY"]))

    def test_stdio_defaults_and_bad_shapes(self):
        out = ws.server_facts({"command": "node", "args": ["srv.js", "--token", "abc"]})
        self.assertEqual((out["type"], out["command"], out["args"]), ("stdio", "node", ["srv.js", "--token", M]))
        self.assertEqual(ws.server_facts("nonsense")["type"], "unknown")
        self.assertEqual(ws.server_facts({"env": "oops", "headers": []})["env_keys"], [])


if __name__ == "__main__":
    unittest.main()
