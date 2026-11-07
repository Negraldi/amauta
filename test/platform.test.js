// Platform layer (plan N8, ADR 0003): PATHEXT lookup, argument quoting, directory links and process-tree kill differ on
// Windows. The Windows branches are exercised with an injected platform so they are tested on every OS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findOnPath, killTree, linkType, quoteArg } from '../src/core/platform.js';
import { tempDir } from './helpers/tmp.js';

test('findOnPath finds an executable on POSIX and a PATHEXT match on Windows', async () => {
  const dir = await tempDir('plat-');
  await writeFile(path.join(dir, 'tool'), '#!/bin/sh\n');
  await chmod(path.join(dir, 'tool'), 0o755);
  await writeFile(path.join(dir, 'other.CMD'), '@echo off\n');
  const posix = { platform: 'linux' };
  assert.equal(await findOnPath('tool', dir, posix), path.join(dir, 'tool'));
  assert.equal(await findOnPath('other', dir, posix), null);
  const win = { platform: 'win32', pathext: '.EXE;.CMD' };
  assert.equal(await findOnPath('other', dir, win), path.join(dir, 'other.CMD'));
  assert.equal(await findOnPath('other.CMD', dir, win), path.join(dir, 'other.CMD'));
});

test('quoteArg keeps the POSIX quoting and uses double quotes and forward slashes on Windows', () => {
  assert.equal(quoteArg('/a/b.js', 'linux'), '/a/b.js');
  assert.equal(quoteArg('/my dir/b.js', 'linux'), "'/my dir/b.js'");
  assert.equal(quoteArg('C:\\Program Files\\amauta\\bin\\amauta.js', 'win32'), '"C:/Program Files/amauta/bin/amauta.js"');
  assert.throws(() => quoteArg('C:\\a"b', 'win32'), /cannot be quoted/);
});

test('directory links are junctions on Windows (no administrator rights needed) and symlinks elsewhere', () => {
  assert.equal(linkType('win32'), 'junction');
  assert.equal(linkType('linux'), 'dir');
});

test('killTree kills the process group on POSIX and runs taskkill /T /F on Windows', () => {
  const calls = [];
  killTree(4242, { platform: 'win32', spawn: (cmd, args) => calls.push([cmd, ...args]) });
  assert.deepEqual(calls, [['taskkill', '/PID', '4242', '/T', '/F']]);
  const killed = [];
  killTree(4242, { platform: 'linux', kill: (pid, sig) => killed.push([pid, sig]) });
  assert.deepEqual(killed, [[-4242, 'SIGKILL']]);
});
