// The portal launcher on Windows (plan N12h): Edge or Chrome in app mode, explorer as the last resort, and a Start
// menu shortcut written through PowerShell with every path passed as an environment variable (never spliced).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { findBrowser } from '../src/portal/launch.js';
import { windowsBrowsers, windowsOpener, startMenuDir, shortcutCommand, SHORTCUT_SCRIPT } from '../src/portal/windows.js';
import { runInstallLauncher } from '../src/portal/launcher.js';

const ENV = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
  APPDATA: 'C:\\Users\\u\\AppData\\Roaming', SystemRoot: 'C:\\Windows' };
const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };

test('the browser candidates are Edge first, then Chrome, at their standard install paths', () => {
  const list = windowsBrowsers(ENV);
  assert.equal(list[0], 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.ok(list.includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(list.includes('C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(list.every((p) => path.win32.isAbsolute(p)));
  assert.deepEqual(windowsBrowsers({}), [], 'no base folders, no guesses');
});

test('findBrowser on Windows: AMAUTA_BROWSER wins, then the first installed candidate; explorer opens the rest', () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const exists = (p) => p === chrome;
  assert.equal(findBrowser(ENV, () => null, 'win32', exists), chrome);
  assert.equal(findBrowser({ ...ENV, AMAUTA_BROWSER: 'C:\\b\\brave.exe' }, () => null, 'win32', exists), 'C:\\b\\brave.exe');
  assert.equal(findBrowser(ENV, () => null, 'win32', () => false), null);
  assert.equal(windowsOpener(ENV), 'C:\\Windows\\explorer.exe');
});

test('the Start menu shortcut goes to Programs and passes paths only through the environment', () => {
  assert.equal(startMenuDir(ENV), 'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs');
  const hostile = "C:\\it's $(evil)\\amauta.js";
  const cmd = shortcutCommand({ lnk: 'C:\\x\\amauta.lnk', nodePath: 'C:\\node\\node.exe', binPath: hostile });
  assert.equal(cmd.command, 'powershell.exe');
  assert.deepEqual(cmd.args.slice(0, 2), ['-NoProfile', '-NonInteractive']);
  assert.equal(cmd.args.at(-1), SHORTCUT_SCRIPT);
  assert.ok(!SHORTCUT_SCRIPT.includes(hostile) && !cmd.args.some((a) => a.includes('evil')), 'no path in the script text');
  assert.equal(cmd.env.AMAUTA_SHORTCUT_ARGS, `"${hostile}" portal launch`);
  assert.equal(cmd.env.AMAUTA_SHORTCUT_TARGET, 'C:\\node\\node.exe');
  assert.match(SHORTCUT_SCRIPT, /\$env:AMAUTA_SHORTCUT_LNK/);
});

test('install-launcher on Windows runs PowerShell once and reports the shortcut; --remove deletes it', async () => {
  const runs = [];
  const removed = [];
  const deps = { platform: 'win32', env: ENV, nodePath: 'C:\\node\\node.exe', run: (c, a, o) => { runs.push({ c, a, o }); return { status: 0 }; }, remove: (f) => removed.push(f) };
  const io = { stdout: sink(), stderr: sink() };
  assert.equal(await runInstallLauncher([], io, deps), 0);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].c, 'powershell.exe');
  assert.equal(runs[0].o.env.AMAUTA_SHORTCUT_LNK, 'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\amauta.lnk');
  assert.match(io.stdout.text, /installed .*amauta\.lnk/);
  assert.equal(await runInstallLauncher(['--remove'], io, deps), 0);
  assert.equal(removed.length, 1);
  const failing = { ...deps, run: () => ({ status: 1 }) };
  const err = { stdout: sink(), stderr: sink() };
  assert.equal(await runInstallLauncher([], err, failing), 1);
  assert.match(err.stderr.text, /PowerShell/);
});
