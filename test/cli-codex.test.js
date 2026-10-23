import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tempDir } from './helpers/tmp.js';
import { exists } from './helpers/codex.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');
const run = (args, env) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

async function world({ codexHome = false } = {}) {
  const root = await tempDir('gl-clicodex-');
  const env = {
    AMAUTA_CLAUDE_HOME: path.join(root, 'claude'),
    AMAUTA_CLAUDE_JSON: path.join(root, 'c.json'),
    AMAUTA_STATE_DIR: path.join(root, 'state'),
    AMAUTA_CODEX_HOME: path.join(root, 'codex'),
    AMAUTA_CODEX_SKILLS_DIR: path.join(root, 'agents-skills'),
    CODEX_HOME: path.join(root, 'ambient-codex-must-stay-untouched'),
  };
  if (codexHome) await mkdir(env.AMAUTA_CODEX_HOME, { recursive: true });
  const w = { root, env, claude: (...a) => path.join(root, 'claude', ...a), codex: (...a) => path.join(env.AMAUTA_CODEX_HOME, ...a) };
  return w;
}

test('default runtime is claude alone while no Codex home exists', async () => {
  const w = await world();
  let r = run(['install'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(await exists(w.claude('CLAUDE.md')));
  assert.ok(!(await exists(w.codex())));
  r = run(['status'], w.env);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /runtime codex/);
});

test('default runtime is both once a Codex home exists, and status prints a section per runtime', async () => {
  const w = await world({ codexHome: true });
  let r = run(['install'], w.env);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['AGENTS.md', 'hooks.json', 'config.toml']) assert.ok(await exists(w.codex(f)), f);
  assert.ok(await exists(path.join(w.env.AMAUTA_CODEX_SKILLS_DIR, 'chained-pr', 'SKILL.md')));
  assert.ok(await exists(w.claude('CLAUDE.md')));
  assert.ok(!(await exists(w.env.CODEX_HOME)));
  r = run(['status'], w.env);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /runtime claude[\s\S]*runtime codex/);
  assert.match(r.stdout, /hooks trust/);
  r = run(['install'], w.env);
  assert.match(r.stdout, /already installed/);
});

test('--runtime claude leaves Codex untouched and --runtime codex leaves Claude untouched', async () => {
  const w = await world({ codexHome: true });
  let r = run(['install', '--runtime', 'claude'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(await exists(w.codex('AGENTS.md'))));
  assert.ok(!(await exists(w.codex('config.toml'))));

  const v = await world({ codexHome: true });
  r = run(['install', '--runtime', 'codex'], v.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(await exists(v.codex('AGENTS.md')));
  assert.ok(!(await exists(v.claude('CLAUDE.md'))));
  r = run(['status', '--runtime', 'codex'], v.env);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /runtime codex/);
  assert.doesNotMatch(r.stdout, /runtime claude/);
  assert.equal(run(['status', '--runtime', 'claude'], v.env).status, 1);
});

test('uninstall --runtime codex keeps Claude; plain uninstall removes both', async () => {
  const w = await world({ codexHome: true });
  run(['install'], w.env);
  let r = run(['uninstall', '--runtime', 'codex'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(await exists(w.codex('AGENTS.md'))));
  assert.ok(await exists(w.claude('CLAUDE.md')));
  run(['install', '--runtime', 'codex'], w.env);
  r = run(['uninstall'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(await exists(w.codex('AGENTS.md'))));
  assert.ok(!(await exists(w.claude('CLAUDE.md'))));
});

test('--json keeps the Claude shape and adds a codex key; a bad runtime fails', async () => {
  const w = await world({ codexHome: true });
  const r = run(['install', '--dry-run', '--json'], w.env);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.files));
  assert.ok(Array.isArray(out.codex.files));
  const only = JSON.parse(run(['install', '--runtime', 'codex', '--dry-run', '--json'], w.env).stdout);
  assert.ok(Array.isArray(only.codex.files));
  assert.equal(only.files, undefined);
  const bad = run(['install', '--runtime', 'cursor'], w.env);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--runtime/);
});

test('restore --backup restores Codex files; flags beat the environment', async () => {
  const w = await world({ codexHome: true });
  const other = path.join(w.root, 'flag-codex');
  const flags = ['--codex-home', other, '--codex-skills-dir', path.join(w.root, 'flag-skills')];
  let r = run(['install', '--runtime', 'codex', '--json', ...flags], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(await exists(path.join(other, 'AGENTS.md')));
  assert.ok(!(await exists(w.codex('AGENTS.md'))));
  const id = path.basename(JSON.parse(r.stdout).codex.backup);
  r = run(['restore', '--backup', id, ...flags], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(await exists(path.join(other, 'AGENTS.md'))));
  void readFile;
});

test('--no-mirror-mcp skips the other Claude MCP servers; the default mirrors them and prints names only', async () => {
  const w = await world({ codexHome: true });
  await mkdir(path.dirname(w.env.AMAUTA_CLAUDE_JSON), { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(w.env.AMAUTA_CLAUDE_JSON, JSON.stringify({ mcpServers: { mine: { command: 'm', env: { K: 'topsecret' } }, remote: { type: 'http', url: 'https://x.invalid' } } }));
  let r = run(['install', '--no-mirror-mcp'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(await readFile(w.codex('config.toml'), 'utf8'), /\[mcp_servers\.mine\]/);
  r = run(['install'], w.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(await readFile(w.codex('config.toml'), 'utf8'), /\[mcp_servers\.mine\]/);
  assert.match(r.stdout, /mcp mirrored from Claude: .*mine/);
  assert.match(r.stdout, /mcp not mirrored: remote/);
  r = run(['status'], w.env);
  assert.doesNotMatch(r.stdout, /topsecret/);
  assert.match(r.stdout, /mcp not mirrored/);
});
