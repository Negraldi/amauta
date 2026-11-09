// ODD task file format (docs/odd.md): required sections, and the MCP status tool and the portal parser count the same
// checklist items (top-level `- [ ]`, `- [x]`, `- [!]` only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolByName } from '../src/mcp/tools.js';
import { tempDir } from './helpers/tmp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['## Objective', '## Tasks', '## Acceptance criteria', '## Progress', '## Next step'];
const status = (cwd) => toolByName.get('odd_tasks_status').run({ cwd });

/** done/total per file as the portal parser counts them. */
function portalCounts(files) {
  const code = 'import json,sys\nfrom amauta.portal.wikifeature import parse_tasks\n' +
    'print(json.dumps([[sum(1 for t in parse_tasks(open(f).read()) if t["done"]), len(parse_tasks(open(f).read()))] for f in sys.argv[1:]]))';
  const r = spawnSync('python3', ['-P', '-c', code, ...files], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: path.join(root, 'python') } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('a blocked item [!] is open and counted; nested checkboxes are notes, not tasks', async () => {
  const dir = await tempDir('odd-');
  await mkdir(path.join(dir, 'odd', 'tasks'), { recursive: true });
  await writeFile(path.join(dir, 'odd', 'tasks', 'x.md'), '# Feature: x\n\n## Tasks\n\n- [x] A1 done\n- [!] A2 waits on the user\n  - [ ] a note\n- [ ] A3 later\n');
  const out = await status(dir);
  assert.deepEqual(out.files, [{ file: 'odd/tasks/x.md', done: 1, total: 3, blocked: 1, next: 'A2 waits on the user' }]);
  assert.deepEqual(portalCounts([path.join(dir, 'odd', 'tasks', 'x.md')]), [[1, 3]]);
});

test('every task file in this repository has the required sections', async () => {
  for (const name of (await readdir(path.join(root, 'odd', 'tasks'))).filter((n) => n.endsWith('.md'))) {
    const text = await readFile(path.join(root, 'odd', 'tasks', name), 'utf8');
    assert.match(text, /^# Feature: \S/, `${name}: title`);
    for (const h of REQUIRED) assert.ok(text.split('\n').includes(h), `${name}: missing ${h}`);
  }
});

test('the MCP status tool and the portal count the same items in every repository task file', async () => {
  const out = await status(root);
  const counts = portalCounts(out.files.map((f) => path.join(root, f.file)));
  assert.deepEqual(out.files.map((f) => [f.done, f.total]), counts);
});
