import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMcpServers, readMcpServer, removeMcpServer, renderMcpServer, setMcpServer } from '../src/core/toml.js';

const ENGRAM = {
  command: 'python3',
  args: ['-P', '-m', 'amauta.memory', 'serve'],
  env: { PYTHONPATH: '/home/u/my repo/python', AMAUTA_STATE_DIR: '/home/u/.amauta' },
};

test('render and read round-trip, including quotes, backslashes and non-ASCII', () => {
  const tricky = { command: 'node', args: ['a "quoted" \\ path', 'ñandú\ttab', "it's"], env: { K: 'v=1 # not a comment' } };
  for (const value of [ENGRAM, tricky, { command: 'codegraph', args: [] }]) {
    const text = renderMcpServer('x', value);
    assert.deepEqual(readMcpServer(text, 'x').value, value);
  }
  assert.match(renderMcpServer('engram', ENGRAM), /^\[mcp_servers\.engram\]\ncommand = "python3"\nargs = \["-P", "-m", "amauta.memory", "serve"\]\n\n\[mcp_servers\.engram\.env\]\n/);
});

test('set appends to an empty or foreign file and leaves every other byte alone', () => {
  assert.equal(setMcpServer('', 'engram', ENGRAM), `${renderMcpServer('engram', ENGRAM)}`);
  const foreign = '# my config\nmodel = "gpt-5"\n\n[hooks.state]\n"/x/hooks.json:stop:0:0" = { trusted_hash = "sha256:ab" }\n\n[mcp_servers.other]\ncommand = "x"   # keep me\n';
  const out = setMcpServer(foreign, 'engram', ENGRAM);
  assert.ok(out.startsWith(`${foreign}\n[mcp_servers.engram]\n`));
  assert.deepEqual(readMcpServer(out, 'engram').value, ENGRAM);
  assert.deepEqual(readMcpServer(out, 'other').value, { command: 'x' });
  const noNewline = setMcpServer('a = 1', 'engram', ENGRAM);
  assert.ok(noNewline.startsWith('a = 1\n\n[mcp_servers.engram]\n'));
});

test('set replaces our tables in place and remove takes only them out', () => {
  const before = '# top\n[mcp_servers.engram]\ncommand = "old"\n\n[mcp_servers.engram.env]\nA = "1"\n\n# note for next\n[mcp_servers.keep]\ncommand = "k"\n';
  const next = setMcpServer(before, 'engram', ENGRAM);
  assert.ok(next.startsWith('# top\n[mcp_servers.engram]\ncommand = "python3"\n'));
  assert.ok(next.endsWith('\n# note for next\n[mcp_servers.keep]\ncommand = "k"\n'));
  assert.deepEqual(readMcpServer(next, 'engram').value, ENGRAM);
  const gone = removeMcpServer(next, 'engram');
  assert.equal(gone, '# top\n# note for next\n[mcp_servers.keep]\ncommand = "k"\n');
  assert.equal(removeMcpServer(gone, 'engram'), gone);
});

test('table-looking lines inside multi-line strings do not confuse the reader', () => {
  const text = 'notes = """\n[mcp_servers.engram]\ncommand = "fake"\n"""\n\n[mcp_servers.engram]\ncommand = "real"\n';
  const r = readMcpServer(text, 'engram');
  assert.equal(r.found, true);
  assert.deepEqual(r.value, { command: 'real' });
});

test('foreign shapes are reported, never merged: inline tables, quoted names, parent table keys', () => {
  assert.deepEqual(readMcpServer('[mcp_servers.engram]\ncommand = "c"\nenv = { A = "1", B = "2" }\n', 'engram').value, { command: 'c', env: { A: '1', B: '2' } });
  assert.equal(readMcpServer('[mcp_servers."engram"]\ncommand = "c"\n', 'engram').found, true);
  const conflict = readMcpServer('[mcp_servers]\nengram = { command = "c" }\n', 'engram');
  assert.equal(conflict.found, true);
  assert.equal(conflict.value, null);
  const odd = readMcpServer('[mcp_servers.engram]\ncommand = "c"\nweird = 1979-05-27T07:32:00Z\n', 'engram');
  assert.equal(odd.found, true);
  assert.equal(odd.value, null);
  assert.equal(readMcpServer('[mcp_servers.other]\ncommand = "c"\n', 'engram').found, false);
  assert.throws(() => setMcpServer('[mcp_servers]\nengram = { command = "c" }\n', 'engram', ENGRAM), /parent/);
});

test('listMcpServers names the tables in file order; extra scalar keys round-trip through setMcpServer', async () => {
  const { listMcpServers, setMcpServer, readMcpServer } = await import('../src/core/toml.js');
  const text = '[mcp_servers.a]\ncommand = "x"\n\n[other]\nk = 1\n\n[mcp_servers.b]\ncommand = "y"\n\n[mcp_servers.b.env]\nK = "v"\n';
  assert.deepEqual(listMcpServers(text), ['a', 'b']);
  assert.deepEqual(listMcpServers(''), []);
  const out = setMcpServer('', 'c', { command: 'z', args: ['1'], startup_timeout_sec: 30, enabled: true, tags: ['q'] });
  assert.deepEqual(readMcpServer(out, 'c').value, { command: 'z', args: ['1'], startup_timeout_sec: 30, enabled: true, tags: ['q'] });
});

// --- the shape Codex itself writes: quoted names, dotted sub-tables (.env, .tools.<tool>) ---
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { CODEX_SHAPE } from './helpers/codex-shape.js';

const parses = (text) => JSON.parse(execFileSync('python3', ['-I', '-c', 'import sys,tomllib,json;print(json.dumps(tomllib.loads(sys.stdin.read())))'], { input: text, encoding: 'utf8' }));

test('quoted names and dotted sub-tables read as one server; .tools.* is Codex-side, not part of the value', () => {
  const m = readMcpServer(CODEX_SHAPE, 'amauta-memory');
  assert.deepEqual(m.value, { command: 'python3', args: ['-P', '-m', 'amauta.memory', 'serve'], env: { PYTHONPATH: '/home/u/amauta-dev/python', AMAUTA_STATE_DIR: '/home/u/.amauta', AMAUTA_RUNTIME: 'codex' } });
  assert.equal(m.ranges.length, 4);
  assert.deepEqual(readMcpServer(CODEX_SHAPE, 'amauta').value.env.AMAUTA_CODEX_SKILLS_DIR, '/home/u/.agents/skills');
  assert.deepEqual(readMcpServer(CODEX_SHAPE, 'node_repl').value, { command: '/usr/lib/chatgpt/node', args: ['repl.js'], env: { NODE_REPL_MODE: '1' } });
  assert.deepEqual(listMcpServers(CODEX_SHAPE), ['node_repl', 'amauta-memory', 'amauta']);
});

test('rewriting a server keeps its quoting, its .tools.* sub-tables and its unknown keys; the file stays valid TOML', () => {
  const next = { command: 'node', args: ['/new/server.js'], env: { AMAUTA_RUNTIME: 'codex' } };
  const out = setMcpServer(CODEX_SHAPE.replace('args = ["/home/u/amauta-dev/src/mcp/server.js"]', 'args = ["/home/u/amauta-dev/src/mcp/server.js"]\nstartup_timeout_sec = 30\ntools_note = { a = 1 }'), 'amauta', next);
  assert.ok(out.includes('[mcp_servers."amauta".tools.skill_registry_refresh]\napproval_mode = "approve"'));
  assert.ok(out.includes('startup_timeout_sec = 30'));
  const v = readMcpServer(out, 'amauta').value;
  assert.deepEqual({ command: v.command, args: v.args, env: v.env }, next);
  assert.equal(v.startup_timeout_sec, 30);
  const doc = parses(out);
  assert.deepEqual(doc.mcp_servers.amauta.tools.skill_registry_refresh, { approval_mode: 'approve' });
  assert.deepEqual(doc.mcp_servers.amauta.args, ['/new/server.js']);
  assert.deepEqual(Object.keys(doc.mcp_servers), ['node_repl', 'amauta-memory', 'amauta']);
  assert.equal(out.split('[mcp_servers."amauta".env]').length, 2);
  assert.ok(out.startsWith(CODEX_SHAPE.slice(0, CODEX_SHAPE.indexOf('[mcp_servers."amauta"]'))), 'bytes before the entry are untouched');
  assert.ok(out.endsWith('[projects."/home/u/proj"]\ntrust_level = "trusted"\n'));
});

test('removing a server drops the table and every sub-table, nothing else', () => {
  const out = removeMcpServer(CODEX_SHAPE, 'amauta-memory');
  assert.ok(!out.includes('amauta-memory') && !out.includes('mem_search'));
  assert.ok(out.includes('[mcp_servers."amauta".tools.skill_registry_refresh]'));
  assert.deepEqual(Object.keys(parses(out).mcp_servers), ['node_repl', 'amauta']);
  const both = removeMcpServer(out, 'amauta');
  assert.equal(both, CODEX_SHAPE.slice(0, CODEX_SHAPE.indexOf('[mcp_servers."amauta-memory"]')) + CODEX_SHAPE.slice(CODEX_SHAPE.indexOf('[projects.')));
  assert.ok(isDeepStrictEqual(parses(both).projects, { '/home/u/proj': { trust_level: 'trusted' } }));
});

test('sync ignores .tools.* and keeps them when it rewrites a Codex-side server', async () => {
  const { planMcpSync, hashOf } = await import('../src/install/mcpsync.js');
  const toml = '[mcp_servers."srv"]\ncommand = "a"\n\n[mcp_servers."srv".tools.t1]\napproval_mode = "approve"\n';
  const claude = `${JSON.stringify({ mcpServers: { srv: { type: 'stdio', command: 'b' } } })}\n`;
  const r = planMcpSync({ claudeText: claude, tomlText: toml, base: { srv: hashOf({ command: 'a' }) } });
  assert.deepEqual(r.report.toCodex, ['srv']);
  assert.ok(r.toml.includes('command = "b"') && r.toml.includes('[mcp_servers."srv".tools.t1]\napproval_mode = "approve"'));
  assert.deepEqual(parses(r.toml).mcp_servers.srv.tools.t1, { approval_mode: 'approve' });
  const same = planMcpSync({ claudeText: `${JSON.stringify({ mcpServers: { srv: { type: 'stdio', command: 'a' } } })}\n`, tomlText: toml, base: {} });
  assert.deepEqual([same.report.conflicts, same.report.unsupported, same.report.toCodex], [[], [], []]);
});
