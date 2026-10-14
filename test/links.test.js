import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { install } from '../src/install/installer.js';

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

test('every relative markdown link in installed skills, agents and commands resolves', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-links-'));
  try {
    const claudeHome = path.join(root, 'home', '.claude');
    await install({ claudeHome, claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state'), searchPath: '', withSdd: true });
    const problems = [];
    for (const dir of ['skills', 'agents', 'commands']) {
      for (const file of (await walk(path.join(claudeHome, dir))).filter((f) => f.endsWith('.md'))) {
        const text = await readFile(file, 'utf8');
        if (/\.\.md\b|\.-pi\.md/.test(text)) problems.push(`${path.relative(claudeHome, file)}: stripped file name`);
        for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
          const target = m[1].split('#')[0];
          if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
          const ok = await stat(path.resolve(path.dirname(file), target)).then(() => true, () => false);
          if (!ok) problems.push(`${path.relative(claudeHome, file)} -> ${m[1]}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
