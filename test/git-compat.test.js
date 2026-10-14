import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeRepo } from './helpers/repo.js';
import { resolveCommit } from '../src/util/git.js';

test('resolveCommit works with a git that predates --end-of-options (< 2.24) and still rejects option-shaped refs', async () => {
  const repo = await makeRepo();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.dir, encoding: 'utf8' }).trim();
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const shimDir = await mkdtemp(path.join(os.tmpdir(), 'gl-oldgit-'));
  await writeFile(path.join(shimDir, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--end-of-options" ] && { echo "fatal: Needed a single revision" >&2; exit 128; }; done\nexec '${realGit}' "$@"\n`);
  await chmod(path.join(shimDir, 'git'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${shimDir}${path.delimiter}${saved}`;
  try {
    assert.equal(await resolveCommit(repo.dir, 'main'), head);
    await assert.rejects(resolveCommit(repo.dir, '--output=/tmp/x'), /invalid base ref/);
  } finally {
    process.env.PATH = saved;
    await rm(shimDir, { recursive: true, force: true });
  }
});
