// odd/tasks/upgrade-next.md U2: a real 0.4.0 install (its own code, taken from the git history) in temporary homes,
// then the current installer over it. The new install leaves no 0.4.0 hook command or server path behind, status is
// clean, and the dry-run preview the upgrade shows reports the legacy entries before anything is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../src/install/assets.js';
import { defaultPreviewInstall } from '../src/install/upgrade-plan.js';
import { tempDir } from './helpers/tmp.js';

const V040 = 'c973336bc752799909ecdca14f764072d25d78b0'; // the commit tagged v0.4.0, the latest release on main
const has040 = spawnSync('git', ['-C', repoRoot, 'cat-file', '-e', `${V040}^{commit}`]).status === 0;

function run(cwd, args, env) {
  const r = spawnSync(process.execPath, [path.join(cwd, 'bin', 'amauta.js'), ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const commandsOf = (settings) => Object.values(settings.hooks ?? {}).flat()
  .flatMap((entry) => (entry.hooks ?? []).map((h) => h.command ?? ''));

test('a 0.4.0 install upgrades to the current version cleanly', { skip: !has040 && 'the v0.4.0 commit is not in this clone (shallow?)' }, async () => {
  const root = await tempDir('amauta-e2e-upg-');
  const old = path.join(root, 'amauta-0.4.0');
  await mkdir(old);
  const tar = spawnSync('git', ['-C', repoRoot, 'archive', '--format=tar', V040], { maxBuffer: 1 << 28 });
  assert.equal(tar.status, 0, String(tar.stderr));
  assert.equal(spawnSync('tar', ['-x', '-C', old], { input: tar.stdout }).status, 0, 'unpack 0.4.0');
  const home = path.join(root, 'home');
  const flags = ['--claude-home', path.join(home, '.claude'), '--claude-json', path.join(home, '.claude.json'),
    '--state-dir', path.join(root, 'state')];
  const env = { ...process.env, HOME: home, USERPROFILE: home, AMAUTA_NO_NETWORK: '1' };
  for (const k of Object.keys(env)) if (k.startsWith('AMAUTA_') && k !== 'AMAUTA_NO_NETWORK') delete env[k];

  const first = run(old, ['install', ...flags], env);
  assert.equal(first.code, 0, first.out);
  const settingsFile = path.join(home, '.claude', 'settings.json');
  const before = commandsOf(JSON.parse(await readFile(settingsFile, 'utf8')));
  assert.ok(before.some((c) => c.includes(old)), 'the 0.4.0 hooks point at the 0.4.0 checkout');

  const preview = await defaultPreviewInstall(repoRoot, flags);
  assert.equal(preview.code, 0, 'the current installer previews over the 0.4.0 install');
  assert.ok(preview.report.files.length > 0, 'it would write files');

  const next = run(repoRoot, ['install', ...flags], env);
  assert.equal(next.code, 0, next.out);
  const after = commandsOf(JSON.parse(await readFile(settingsFile, 'utf8')));
  assert.deepEqual(after.filter((c) => c.includes(old)), [], 'no hook command of 0.4.0 is left');
  assert.ok(after.some((c) => c.includes(' hook event ')), 'the hooks have the current form');
  const servers = JSON.parse(await readFile(path.join(home, '.claude.json'), 'utf8')).mcpServers ?? {};
  assert.deepEqual(Object.entries(servers).filter(([, s]) => JSON.stringify(s).includes(old)).map(([k]) => k), [],
    'no MCP server still runs the 0.4.0 checkout');
  const status = run(repoRoot, ['status', ...flags], env);
  assert.equal(status.code, 0, status.out);
});
