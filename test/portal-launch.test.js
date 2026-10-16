import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { runLaunch, findBrowser, readRunFile } from '../src/portal/launch.js';

const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'amauta-launch-'));

/** A fake world: servers and browsers are plain objects, time never passes unless sleep() is called. */
function world({ browsers = ['/fake/google-chrome'], ignoreTerm = false, serverStartsAfter = 0, portInUse = null } = {}) {
  const w = { alive: new Set([1]), ports: new Map(), kills: [], spawned: [], browsed: [], nextPid: 5000, clock: 0, failServer: false };
  w.deps = {
    pid: 1,
    findFreePort: async () => portInUse ?? 43210,
    which: (name) => (browsers.includes(name) ? name : browsers.find((b) => path.basename(b) === name) ?? null),
    spawnServer: (command, args, opts) => {
      const pid = w.nextPid++;
      w.spawned.push({ command, args, opts, pid });
      if (w.failServer) return { pid: undefined, onError: (cb) => cb(new Error('spawn python3 ENOENT')) };
      w.alive.add(pid);
      w.ports.set(Number(args[args.indexOf('--port') + 1]), { pid, readyAt: w.clock + serverStartsAfter });
      return { pid, onError: () => {} };
    },
    probe: async (port) => { const s = w.ports.get(port); return !!s && w.alive.has(s.pid) && w.clock >= s.readyAt; },
    isAlive: (pid) => w.alive.has(pid),
    kill: (pid, sig) => { w.kills.push([pid, sig]); if (sig === 'SIGKILL' || !ignoreTerm) w.alive.delete(pid); },
    sleep: async (ms) => { w.clock += ms; },
    spawnBrowser: async (command, args) => { w.browsed.push({ command, args }); return w.onBrowser ? w.onBrowser() : 0; },
    graceMs: 100, pollMs: 10, startTimeoutMs: 1000,
  };
  return w;
}

function setup(extra = []) {
  const state = tmp();
  return { state, args: ['--state-dir', state, ...extra], io: { stdout: sink(), stderr: sink() } };
}

test('start: free port, detached python with --idle-exit 30 and a log, Chrome in app mode, server stopped when the window closes', async () => {
  const w = world();
  const { state, args, io } = setup(['--repo', '/r']);
  w.onBrowser = async () => { assert.ok(readRunFile(state).pid, 'run file exists while the window is open'); return 0; };
  assert.equal(await runLaunch(args, io, w.deps), 0);
  const s = w.spawned[0];
  assert.equal(s.command, 'python3');
  assert.deepEqual(s.args.slice(0, 3), ['-P', '-m', 'amauta.portal']);
  assert.ok(s.args.includes('--port') && s.args.includes('43210'));
  assert.equal(s.args[s.args.indexOf('--idle-exit') + 1], '30');
  assert.equal(s.args[s.args.indexOf('--repo') + 1], path.resolve('/r'));
  assert.equal(s.opts.detached, true);
  assert.ok(s.opts.logFile.startsWith(path.join(state, 'portal')));
  const b = w.browsed[0];
  assert.equal(b.command, '/fake/google-chrome');
  assert.deepEqual(b.args, ['--app=http://127.0.0.1:43210/', `--user-data-dir=${path.join(state, 'portal', 'browser-profile')}`, '--class=amauta-portal', '--no-first-run', '--no-default-browser-check']);
  assert.deepEqual(w.kills, [[5000, 'SIGTERM']]);
  assert.equal(readRunFile(state), null, 'run file removed');
  assert.equal(w.alive.has(5000), false);
});

test('--idle-exit is configurable and validated', async () => {
  const w = world();
  const { args, io } = setup(['--idle-exit', '90']);
  await runLaunch(args, io, w.deps);
  assert.equal(w.spawned[0].args[w.spawned[0].args.indexOf('--idle-exit') + 1], '90');
  const bad = setup(['--idle-exit', '0']);
  assert.equal(await runLaunch(bad.args, bad.io, world().deps), 1);
  assert.match(bad.io.stderr.text, /idle-exit/);
});

test('waits for the server to answer before opening the window', async () => {
  const w = world({ serverStartsAfter: 300 });
  const { args, io } = setup();
  w.onBrowser = async () => { assert.ok(w.clock >= 300); return 0; };
  assert.equal(await runLaunch(args, io, w.deps), 0);
});

test('server that never answers: error, server killed, no window', async () => {
  const w = world({ serverStartsAfter: 1e9 });
  const { state, args, io } = setup();
  assert.equal(await runLaunch(args, io, w.deps), 1);
  assert.equal(w.browsed.length, 0);
  assert.deepEqual(w.kills[0], [5000, 'SIGTERM']);
  assert.equal(readRunFile(state), null);
  assert.match(io.stderr.text, /did not start/);
});

test('python cannot be spawned: clear error, no window', async () => {
  const w = world();
  w.failServer = true;
  const { args, io } = setup();
  assert.equal(await runLaunch(args, io, w.deps), 1);
  assert.match(io.stderr.text, /cannot start/);
  assert.equal(w.browsed.length, 0);
});

test('reuse: a live run file whose port answers is reused and not stopped while another launcher is attached', async () => {
  const w = world();
  const { state, args, io } = setup();
  // first launcher is "running": its window is still open when the second one starts and ends
  const first = (async () => { w.onBrowser = () => new Promise((res) => { w.closeFirst = () => res(0); }); return runLaunch(args, io, w.deps); })();
  await new Promise((r) => setImmediate(r));
  assert.equal(readRunFile(state).pid, 5000);
  const second = world();
  second.alive = w.alive; second.ports = w.ports; second.deps.pid = 2; w.alive.add(2);
  second.deps.spawnBrowser = async (command, a) => { second.browsed.push({ command, a }); return 0; };
  assert.equal(await runLaunch(args, { stdout: sink(), stderr: sink() }, second.deps), 0);
  assert.equal(second.spawned.length, 0, 'no second server');
  assert.equal(second.browsed[0].a[0], '--app=http://127.0.0.1:43210/');
  assert.deepEqual(second.kills, [], 'server stays: first window still open');
  assert.equal(readRunFile(state).pid, 5000);
  w.closeFirst();
  assert.equal(await first, 0);
  assert.deepEqual(w.kills, [[5000, 'SIGTERM']]);
  assert.equal(readRunFile(state), null);
});

test('stale run file (dead pid) is ignored and a fresh server starts', async () => {
  const w = world();
  const { state, args, io } = setup();
  fs.mkdirSync(path.join(state, 'portal'), { recursive: true });
  fs.writeFileSync(path.join(state, 'portal', 'run.json'), JSON.stringify({ pid: 777, port: 40000, url: 'http://127.0.0.1:40000/', started: 'x', launchers: [] }));
  assert.equal(await runLaunch(args, io, w.deps), 0);
  assert.equal(w.spawned.length, 1);
  assert.match(w.browsed[0].args[0], /43210/);
});

test('stale run file (live pid but the port does not answer) is also stale; the foreign process is not killed', async () => {
  const w = world();
  const { state, args, io } = setup();
  w.alive.add(777);
  fs.mkdirSync(path.join(state, 'portal'), { recursive: true });
  fs.writeFileSync(path.join(state, 'portal', 'run.json'), JSON.stringify({ pid: 777, port: 40000, url: 'http://127.0.0.1:40000/', started: 'x', launchers: [] }));
  await runLaunch(args, io, w.deps);
  assert.equal(w.spawned.length, 1);
  assert.ok(!w.kills.some(([pid]) => pid === 777));
});

test('corrupt run file is treated as stale', async () => {
  const w = world();
  const { state, args, io } = setup();
  fs.mkdirSync(path.join(state, 'portal'), { recursive: true });
  fs.writeFileSync(path.join(state, 'portal', 'run.json'), '{nope');
  assert.equal(await runLaunch(args, io, w.deps), 0);
  assert.equal(w.spawned.length, 1);
});

test('server ignoring SIGTERM is killed with SIGKILL after the grace period', async () => {
  const w = world({ ignoreTerm: true });
  const { args, io } = setup();
  await runLaunch(args, io, w.deps);
  assert.deepEqual(w.kills, [[5000, 'SIGTERM'], [5000, 'SIGKILL']]);
});

test('no Chromium-family browser: xdg-open fallback, server left to the idle timer', async () => {
  const w = world({ browsers: ['/fake/xdg-open'] });
  const { state, args, io } = setup();
  assert.equal(await runLaunch(args, io, w.deps), 0);
  assert.deepEqual(w.browsed[0], { command: '/fake/xdg-open', args: ['http://127.0.0.1:43210/'] });
  assert.deepEqual(w.kills, []);
  assert.ok(readRunFile(state), 'run file stays: the server is still running');
  assert.match(io.stderr.text, /idle/);
});

test('no browser and no xdg-open: error before any server is started', async () => {
  const w = world({ browsers: [] });
  const { state, args, io } = setup();
  assert.equal(await runLaunch(args, io, w.deps), 1);
  assert.match(io.stderr.text, /browser/);
  assert.equal(w.spawned.length, 0);
  assert.equal(readRunFile(state), null);
});

test('findBrowser: AMAUTA_BROWSER wins, then the candidate order', () => {
  const which = (n) => ({ chromium: '/u/chromium', 'google-chrome-stable': '/u/gcs' })[n] ?? null;
  assert.equal(findBrowser({ AMAUTA_BROWSER: '/custom/b' }, which), '/custom/b');
  assert.equal(findBrowser({ AMAUTA_BROWSER: 'chromium' }, which), '/u/chromium');
  assert.equal(findBrowser({}, which), '/u/gcs');
  assert.equal(findBrowser({}, () => null), null);
});

test('rejects a bad port and unknown options', async () => {
  const a = setup(['--port', 'abc']);
  assert.equal(await runLaunch(a.args, a.io, world().deps), 1);
  const b = setup(['--host', '0.0.0.0']);
  assert.equal(await runLaunch(b.args, b.io, world().deps), 1);
  assert.match(b.io.stderr.text, /--host/);
});

test('real processes: fake python3 server and fake browser, server gone after the window closes', async () => {
  const bin = tmp();
  const node = process.execPath;
  fs.writeFileSync(path.join(bin, 'python3'), `#!${node}
const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http.createServer((q, r) => r.end('<meta name="portal-token" content="t">')).listen(port, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'fakebrowser'), `#!${node}
require('node:fs').writeFileSync(process.env.FAKE_BROWSER_ARGS, JSON.stringify(process.argv.slice(2)));
setTimeout(() => process.exit(0), 600);
`, { mode: 0o755 });
  const state = tmp();
  const argsFile = path.join(state, 'browser-args.json');
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, AMAUTA_BROWSER: path.join(bin, 'fakebrowser'), FAKE_BROWSER_ARGS: argsFile };
  const io = { stdout: sink(), stderr: sink() };
  assert.equal(await runLaunch(['--state-dir', state], io, {}, env), 0, io.stderr.text);
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  assert.match(args[0], /^--app=http:\/\/127\.0\.0\.1:\d+\/$/);
  const port = Number(new URL(args[0].slice(6)).port);
  assert.equal(readRunFile(state), null);
  await new Promise((r) => setTimeout(r, 100));
  const answers = await new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false)); });
  assert.equal(answers, false, 'server stopped');
});
