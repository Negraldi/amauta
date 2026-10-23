import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMcpServer, removeMcpServer, renderMcpServer, setMcpServer } from '../src/core/toml.js';

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
