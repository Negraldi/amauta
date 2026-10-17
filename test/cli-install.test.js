import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { tempDir } from './helpers/tmp.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');
const run = (args, env) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('install/status/uninstall via CLI honour the environment variables', async () => {
  const root = await tempDir('gl-cli-');
  const env = {
    AMAUTA_CLAUDE_HOME: path.join(root, 'claude'),
    AMAUTA_CLAUDE_JSON: path.join(root, 'c.json'),
    AMAUTA_STATE_DIR: path.join(root, 'state'),
  };
  let r = run(['status'], env);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not installed/i);

  r = run(['install'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /installed/i);
  assert.match(await readFile(path.join(root, 'claude', 'CLAUDE.md'), 'utf8'), /amauta:orchestrator/);

  r = run(['status'], env);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /CLAUDE\.md: \d+ chars \(budget 20000\)/);
  assert.match(r.stdout, /permissions: 3 ask, 16 deny/);
  assert.match(r.stdout, /deny Read\(~\/\.ssh\/\*\*\)/);

  r = run(['install', '--dry-run'], env);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dry run/i);

  r = run(['uninstall'], env);
  assert.equal(r.status, 0, r.stderr);
  await assert.rejects(stat(path.join(root, 'c.json')));
});

test('flags override the environment and unknown flags fail', async () => {
  const root = await tempDir('gl-cli2-');
  const r = run(['install', '--claude-home', path.join(root, 'h'), '--claude-json', path.join(root, 'j.json'), '--state-dir', path.join(root, 's')], {});
  assert.equal(r.status, 0, r.stderr);
  assert.ok((await stat(path.join(root, 'h', 'CLAUDE.md'))).isFile());
  const bad = run(['install', '--nope'], {});
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /nope/);
});

test('help lists install, uninstall and status', () => {
  const r = run(['--help'], {});
  for (const c of ['install', 'uninstall', 'status']) assert.match(r.stdout, new RegExp(c));
});

test('status prints the per-block CLAUDE.md size report', async () => {
  const root = await tempDir('gl-cli3-');
  const env = { AMAUTA_CLAUDE_HOME: path.join(root, 'claude'), AMAUTA_CLAUDE_JSON: path.join(root, 'c.json'), AMAUTA_STATE_DIR: path.join(root, 'state') };
  assert.equal(run(['install'], env).status, 0);
  const r = run(['status'], env);
  assert.match(r.stdout, /CLAUDE\.md: \d+ chars \(budget 20000\)/);
  assert.match(r.stdout, /orchestrator\s+\d+ chars/);
});
