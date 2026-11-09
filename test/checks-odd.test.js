// The ODD rule (plan D8, ADR 0006): checking a task off in odd/tasks/*.md is refused while the changed files have
// errors the checks engine sees. Unchecked or already-checked items, and a clean tree, pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dispatchEvent } from '../src/hooks/dispatch.js';
import { tempDir } from './helpers/tmp.js';
import { PY } from './helpers/python.js';

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const write = async (dir, name, text) => { const f = path.join(dir, name); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, text); return f; };
const TASKS = '# Feature\n\n## Tasks\n\n- [x] T1 first\n- [ ] T2 second\n- [ ] T3 third\n';

async function world() {
  const dir = await tempDir('odd-');
  for (const args of [['init', '-q', '.'], ['config', 'user.email', 'a@b.c'], ['config', 'user.name', 'T'], ['config', 'commit.gpgsign', 'false']]) git(dir, ...args);
  const tasks = await write(dir, 'odd/tasks/feature.md', TASKS);
  await write(dir, 'src/a.json', '{"ok": true}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  const stateDir = await tempDir('odd-state-');
  const edit = () => dispatchEvent({ event: 'PostToolUse', names: ['checks'], stateDir, python: PY,
    payload: { hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: dir, tool_input: { file_path: tasks } } });
  return { dir, tasks, edit };
}

test('checking a task off while a changed file has errors is refused, naming the task and the errors', async () => {
  const w = await world();
  await write(w.dir, 'src/a.json', '{"ok": true,}\n');
  await write(w.dir, 'odd/tasks/feature.md', TASKS.replace('- [ ] T2 second', '- [x] T2 second'));
  const d = await w.edit();
  assert.equal(d.decision, 'block');
  assert.match(d.reason, /T2/);
  assert.match(d.reason, /src\/a\.json:1:\d+: error: .+ \[json\]/);
  assert.match(d.reason, /leave the task open|uncheck/);
});

test('the same check-off passes on a clean tree; editing other lines never triggers the rule', async () => {
  const w = await world();
  await write(w.dir, 'odd/tasks/feature.md', TASKS.replace('- [ ] T2 second', '- [x] T2 second'));
  assert.equal(await w.edit(), null);
  const w2 = await world();
  await write(w2.dir, 'src/a.json', '{"ok": true,}\n');
  await write(w2.dir, 'odd/tasks/feature.md', `${TASKS}\n## Progress\n\n- note\n`);
  assert.equal(await w2.edit(), null, 'no new check-off: the Stop check reports the error later');
});
