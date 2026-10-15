import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { install, status } from '../src/install/installer.js';
import { main } from '../src/cli.js';

const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const SQL_NODES = '{"nodes":[{"id":"t_sql","label":"t.sql","file_type":"code","source_file":"t.sql"},{"id":"t_t","label":"t","file_type":"code","source_file":"t.sql"}],"links":[]}';
const NO_SQL = '{"nodes":[{"id":"x","label":"x","file_type":"code","source_file":"x.py"}],"links":[]}';

async function sandbox({ graph = SQL_NODES, installed = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-gst-'));
  const t = { root, bin: path.join(root, 'bin'), log: path.join(root, 'calls.log'), claudeHome: path.join(root, 'h', '.claude'), claudeJson: path.join(root, 'h', 'c.json'), stateDir: path.join(root, 'state') };
  await mkdir(t.bin, { recursive: true });
  await mkdir(t.claudeHome, { recursive: true });
  if (graph !== null) {
    await writeFile(path.join(t.bin, 'graphify'), `#!/bin/sh\necho "$*" >> "${t.log}"\ncase "$1" in\n  --version) echo "graphify 9.9.9" ;;\n  update) mkdir -p "$2/graphify-out"; cat > "$2/graphify-out/graph.json" <<'JSON'\n${graph}\nJSON\n    echo "scanned: $(ls "$2" | tr '\\n' ' ')" >> "${t.log}" ;;\nesac\n`);
    await chmod(path.join(t.bin, 'graphify'), 0o755);
  }
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: t.bin, ...extra });
  if (installed) await install(t.opts());
  t.note = async (extra) => (await status(t.opts(extra))).notes.find((n) => n.name === 'graphify');
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}
const calls = (t) => readFile(t.log, 'utf8').then((x) => x.split('\n').filter(Boolean), () => []);

test('status reports the graphify version and does not probe the SQL extractor without --deep', async () => {
  const t = await sandbox();
  const n = await t.note();
  assert.equal(n.ok, true);
  assert.match(n.detail, /graphify 9\.9\.9/);
  assert.match(n.detail, /SQL extractor: not probed \(use --deep\)/);
  assert.deepEqual(await calls(t), ['--version']);
  await t.cleanup();
});

test('status --deep runs a tiny .sql fixture through `graphify update` in a temp dir and reports the SQL extractor', async () => {
  const t = await sandbox();
  const n = await t.note({ deep: true });
  assert.match(n.detail, /SQL extractor: available/);
  const log = await calls(t);
  const upd = log.find((l) => l.startsWith('update '));
  assert.ok(upd, 'update ran');
  const dir = upd.slice('update '.length);
  assert.ok(dir.startsWith(os.tmpdir()), 'in a temp dir');
  assert.ok(!dir.startsWith(process.cwd()) && !dir.startsWith(t.root), 'not in the repo nor the sandbox');
  assert.ok(log.some((l) => l.includes('t.sql')), 'the fixture is a .sql file');
  await assert.rejects(readFile(path.join(dir, 't.sql')), /ENOENT/, 'the temp dir is removed');
  await t.cleanup();
});

test('status --deep says when the SQL extractor produced no table nodes', async () => {
  const t = await sandbox({ graph: NO_SQL });
  const n = await t.note({ deep: true });
  assert.equal(n.ok, true, 'optional: never makes the install unhealthy');
  assert.match(n.detail, /SQL extractor: NOT available/);
  assert.match(n.detail, /graphifyy\[sql/);
  await t.cleanup();
});

test('without graphify on PATH status shows the install hint and stays healthy', async () => {
  const t = await sandbox({ graph: null });
  const s = await status(t.opts({ deep: true }));
  assert.equal(s.ok, true);
  assert.match(s.notes.find((n) => n.name === 'graphify').detail, /pipx install "graphifyy\[sql,anthropic,pdf,office\]"/);
  await t.cleanup();
});

test('CLI: status --deep prints the graphify line', async () => {
  const t = await sandbox();
  const out = sink();
  const env = process.env.PATH;
  process.env.PATH = `${t.bin}${path.delimiter}${env}`;
  try {
    const code = await main(['status', '--claude-home', t.claudeHome, '--claude-json', t.claudeJson, '--state-dir', t.stateDir, '--deep'], { stdout: out, stderr: sink() });
    assert.ok(code === 0 || code === 1);
  } finally {
    process.env.PATH = env;
  }
  assert.match(out.text, /\[optional\] graphify: .*graphify 9\.9\.9.*SQL extractor: available/);
  await t.cleanup();
});

test('status surfaces the last graphify hook error from the state dir log', async () => {
  const t = await sandbox();
  assert.equal((await status(t.opts())).notes.find((n) => n.name === 'graphify hook'), undefined, 'nothing to report without a log');
  await writeFile(path.join(t.stateDir, 'graphify-hook.log'), '2026-10-15T10:00:00Z old problem\n2026-10-15T11:00:00Z lock helper failed (exit 2): Unknown option: -P; python3 >= 3.11 required\n');
  const n = (await status(t.opts())).notes.find((x) => x.name === 'graphify hook');
  assert.ok(n, 'a note for the hook log');
  assert.equal(n.ok, false);
  assert.match(n.detail, /last error: 2026-10-15T11:00:00Z lock helper failed \(exit 2\)/);
  assert.ok(!n.detail.includes('old problem'));
  await t.cleanup();
});
