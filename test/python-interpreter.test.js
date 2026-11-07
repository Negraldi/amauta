// The Python interpreter is resolved at install time (plan N8, ADR 0003): --python or AMAUTA_PYTHON, checked to be
// >= 3.11, stored in state and used by the hook commands and the memory MCP server. The default stays `python3`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { install } from '../src/install/installer.js';
import { tempDir } from './helpers/tmp.js';

async function sandbox() {
  const root = await tempDir('py-');
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state') };
  await mkdir(t.claudeHome, { recursive: true });
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: '', ...extra });
  t.json = async (p) => JSON.parse(await readFile(p, 'utf8'));
  return t;
}
async function fakePython(dir, name, versionOk = true) {
  const file = path.join(dir, name);
  const body = versionOk ? 'exec python3 "$@"' : 'echo False';
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

test('--python is stored in state and used by every hook command and by the memory server', async () => {
  const t = await sandbox();
  const py = await fakePython(t.root, 'mypython');
  await install(t.opts({ python: py }));
  assert.equal((await t.json(path.join(t.stateDir, 'state.json'))).python, py);
  const settings = await t.json(path.join(t.claudeHome, 'settings.json'));
  for (const entries of Object.values(settings.hooks)) assert.match(entries[0].hooks[0].command, new RegExp(` --python ${py}( |$)`));
  assert.equal((await t.json(t.claudeJson)).mcpServers.engram.command, py);
  await install(t.opts()); // sticky: a later install without the flag keeps it
  assert.equal((await t.json(t.claudeJson)).mcpServers.engram.command, py);
});

test('an interpreter older than 3.11 is refused before anything is written', async () => {
  const t = await sandbox();
  const old = await fakePython(t.root, 'oldpython', false);
  await assert.rejects(install(t.opts({ python: old })), /3\.11/);
  await assert.rejects(readFile(t.claudeJson));
});

test('without --python the commands and the memory server keep python3', async () => {
  const t = await sandbox();
  await install(t.opts());
  const settings = await t.json(path.join(t.claudeHome, 'settings.json'));
  assert.doesNotMatch(settings.hooks.Stop[0].hooks[0].command, /--python/);
  assert.equal((await t.json(t.claudeJson)).mcpServers.engram.command, 'python3');
});

test('status is healthy with a chosen interpreter', async () => {
  const { status } = await import('../src/install/installer.js');
  const t = await sandbox();
  const py = await fakePython(t.root, 'mypython');
  await install(t.opts({ python: py }));
  const s = await status(t.opts());
  assert.ok(s.ok, JSON.stringify(s.checks?.filter((c) => !c.ok)));
});
