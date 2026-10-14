import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'gentle-lite.js');
const run = (args, input = '{}', env = {}) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', input, env: { ...process.env, ...env } });
const exists = (p) => stat(p).then(() => true, () => false);

test('hooks fail open on malformed stdin, empty stdin and missing fields', () => {
  for (const name of ['skill-registry', 'review-stop']) {
    for (const input of ['not json', '', '[]', '{}']) {
      const r = run(['hook', name], input);
      assert.equal(r.status, 0, `${name} <- ${JSON.stringify(input)}`);
      assert.equal(r.stdout, '');
    }
  }
});

test('an unknown hook name exits 1 with a message', () => {
  const r = run(['hook', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown hook: nope/);
});

test('skill-registry hook writes the registry for the payload cwd and prints nothing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-hook-'));
  const claudeHome = path.join(root, 'claude');
  const project = path.join(root, 'proj');
  await mkdir(path.join(claudeHome, 'skills', 'foo'), { recursive: true });
  await writeFile(path.join(claudeHome, 'skills', 'foo', 'SKILL.md'), '---\nname: foo\ndescription: Trigger: foo.\n---\n');
  await mkdir(path.join(project, '.atl'), { recursive: true }); // project opted in
  await writeFile(path.join(project, 'package.json'), '{}');
  const r = run(['hook', 'skill-registry'], JSON.stringify({ cwd: project, hook_event_name: 'UserPromptSubmit', session_id: 't' }), {
    GENTLE_LITE_CLAUDE_HOME: claudeHome,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(await readFile(path.join(project, '.atl', 'skill-registry.md'), 'utf8'), /\| `foo` \| Trigger: foo\. \| user \|/);
  assert.ok(!(await exists(path.join(project, '.gitignore'))), 'hook uses --no-gitignore semantics');
  await rm(root, { recursive: true });
});

test('skill-registry hook never creates .atl in a project that did not opt in', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-hook-'));
  const project = path.join(root, 'proj');
  await mkdir(project);
  await writeFile(path.join(project, 'package.json'), '{}');
  const r = run(['hook', 'skill-registry'], JSON.stringify({ cwd: project }), { GENTLE_LITE_CLAUDE_HOME: path.join(root, 'claude') });
  assert.equal(r.status, 0);
  assert.ok(!(await exists(path.join(project, '.atl'))));
  await rm(root, { recursive: true });
});
