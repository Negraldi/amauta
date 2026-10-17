import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopEntry, execQuote, runInstallLauncher, applicationsDir } from '../src/portal/launcher.js';
import { runPortal } from '../src/portal/cli.js';
import { tempDirSync } from './helpers/tmp.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const tmp = () => tempDirSync('amauta-desktop-');
const parse = (text) => Object.fromEntries(text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test('execQuote leaves plain words alone and quotes reserved characters per the Desktop Entry spec', () => {
  assert.equal(execQuote('/usr/bin/node'), '/usr/bin/node');
  assert.equal(execQuote('/home/a b/amauta.js'), '"/home/a b/amauta.js"');
  assert.equal(execQuote('/p/$HOME`x`"y"\\z'), '"/p/\\$HOME\\`x\\`\\"y\\"\\\\z"');
  assert.equal(execQuote('/p/100%/x'), '/p/100%%/x');
  assert.throws(() => execQuote('/p/with\nnewline'), /newline/);
});

test('desktopEntry has the required keys, absolute paths and Terminal=false', () => {
  const e = parse(desktopEntry({ nodePath: '/usr/bin/node', binPath: '/opt/amauta/bin/amauta.js', iconPath: '/opt/amauta/icon.svg' }));
  assert.equal(e.Type, 'Application');
  assert.equal(e.Name, 'amauta');
  assert.ok(e.Comment);
  assert.equal(e.Exec, '/usr/bin/node /opt/amauta/bin/amauta.js portal launch');
  assert.equal(e.Icon, '/opt/amauta/icon.svg');
  assert.equal(e.Terminal, 'false');
  assert.equal(e.Categories, 'Development;');
  assert.equal(e.StartupWMClass, 'amauta-portal');
  assert.ok(desktopEntry({ nodePath: '/n', binPath: '/b', iconPath: '/i' }).startsWith('[Desktop Entry]\n'));
});

test('desktopEntry quotes a node or repo path with spaces and escapes the backslashes of the file format', () => {
  const text = desktopEntry({ nodePath: '/my node/bin/node', binPath: '/src/a"b/bin/amauta.js', iconPath: '/s p/icon.svg' });
  assert.match(text, /^Exec="\/my node\/bin\/node" "\/src\/a\\\\"b\/bin\/amauta\.js" portal launch$/m);
  assert.match(text, /^Icon=\/s p\/icon\.svg$/m);
});

test('applicationsDir: flag, then AMAUTA_APPLICATIONS_DIR, then XDG_DATA_HOME, then ~/.local/share', () => {
  assert.equal(applicationsDir({ flag: '/f' }, { AMAUTA_APPLICATIONS_DIR: '/e' }, '/h'), path.resolve('/f'));
  assert.equal(applicationsDir({}, { AMAUTA_APPLICATIONS_DIR: '/e', XDG_DATA_HOME: '/x' }, '/h'), '/e');
  assert.equal(applicationsDir({}, { XDG_DATA_HOME: '/x' }, '/h'), '/x/applications');
  assert.equal(applicationsDir({}, {}, '/h'), '/h/.local/share/applications');
});

test('install-launcher writes amauta-portal.desktop in the chosen dir, runs update-desktop-database, and --remove deletes it', async () => {
  const dir = path.join(tmp(), 'applications');
  const calls = [];
  const deps = { nodePath: '/usr/bin/node', which: (n) => (n === 'update-desktop-database' ? '/usr/bin/update-desktop-database' : null), run: (cmd, a) => calls.push([cmd, a]) };
  const io = { stdout: sink(), stderr: sink() };
  assert.equal(await runInstallLauncher(['--applications-dir', dir], io, deps), 0);
  const file = path.join(dir, 'amauta-portal.desktop');
  const e = parse(fs.readFileSync(file, 'utf8'));
  assert.equal(e.Exec, `/usr/bin/node ${path.join(repo, 'bin', 'amauta.js')} portal launch`);
  assert.equal(e.Icon, path.join(repo, 'python', 'amauta', 'portal', 'static', 'icon.svg'));
  assert.ok(fs.existsSync(e.Icon));
  assert.deepEqual(calls, [['/usr/bin/update-desktop-database', [dir]]]);
  assert.match(io.stdout.text, /amauta-portal\.desktop/);
  assert.equal(await runInstallLauncher(['--applications-dir', dir, '--remove'], io, deps), 0);
  assert.equal(fs.existsSync(file), false);
  assert.equal(await runInstallLauncher(['--applications-dir', dir, '--remove'], io, deps), 0, 'removing twice is fine');
});

test('install-launcher works without update-desktop-database and rejects unknown options', async () => {
  const dir = tmp();
  const deps = { nodePath: '/n', which: () => null, run: () => assert.fail('must not run') };
  assert.equal(await runInstallLauncher(['--applications-dir', dir], { stdout: sink(), stderr: sink() }, deps), 0);
  const err = sink();
  assert.equal(await runInstallLauncher(['--bogus'], { stdout: sink(), stderr: err }, deps), 1);
  assert.match(err.text, /--bogus/);
});

test('amauta portal dispatches launch and install-launcher to their handlers', async () => {
  const seen = [];
  const io = { stdout: sink(), stderr: sink() };
  await runPortal(['launch', '--x'], io, { launch: async (a) => { seen.push(['launch', a]); return 7; }, install: async (a) => { seen.push(['install', a]); return 8; } });
  await runPortal(['install-launcher', '--remove'], io, { launch: async () => 0, install: async (a) => { seen.push(['install', a]); return 8; } });
  assert.deepEqual(seen, [['launch', ['--x']], ['install', ['--remove']]]);
});

test('plain portal still forwards --idle-exit and validates it', async () => {
  const { buildPortalSpawn } = await import('../src/portal/cli.js');
  const env = { AMAUTA_STATE_DIR: path.join(os.tmpdir(), 'amauta-no-such-state-dir') };  // no portal.json: nothing appended after the option
  assert.deepEqual(buildPortalSpawn(['--idle-exit', '45'], env).args.slice(-2), ['--idle-exit', '45']);
  assert.throws(() => buildPortalSpawn(['--idle-exit', '0'], {}), /idle-exit/);
});
