import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn as nodeSpawn } from 'node:child_process';
import { resolveTargets } from '../install/paths.js';
import { buildPortalSpawn, OPTIONS } from './cli.js';

const LOOPBACK = '127.0.0.1';
const BROWSERS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
const DEFAULT_IDLE_EXIT = '30';

export const runFilePath = (stateDir) => path.join(stateDir, 'portal', 'run.json');

/** The run file, or null when it is missing or unreadable (both mean "no server to reuse"). */
export function readRunFile(stateDir) {
  try {
    const r = JSON.parse(fs.readFileSync(runFilePath(stateDir), 'utf8'));
    return Number.isInteger(r.pid) && Number.isInteger(r.port) ? { launchers: [], ...r } : null;
  } catch {
    return null;
  }
}

function writeRunFile(stateDir, run) {
  const file = runFilePath(stateDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function removeRunFile(stateDir) {
  fs.rmSync(runFilePath(stateDir), { force: true });
}

/** AMAUTA_BROWSER (a path or a command name) wins, then the Chromium-family candidates in order. */
export function findBrowser(env, which) {
  if (env.AMAUTA_BROWSER) return which(env.AMAUTA_BROWSER) ?? (path.isAbsolute(env.AMAUTA_BROWSER) ? env.AMAUTA_BROWSER : null);
  for (const name of BROWSERS) {
    const found = which(name);
    if (found) return found;
  }
  return null;
}

function defaultWhich(env) {
  return (name) => {
    const candidates = path.isAbsolute(name) ? [name] : (env.PATH ?? '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, name));
    for (const c of candidates) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        if (fs.statSync(c).isFile()) return c;
      } catch { /* next */ }
    }
    return null;
  };
}

function defaultDeps(env) {
  return {
    pid: process.pid,
    which: defaultWhich(env),
    findFreePort: () => new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, LOOPBACK, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    }),
    spawnServer: (command, args, { env: childEnv, logFile }) => {
      const fd = fs.openSync(logFile, 'a');
      let failure = null;
      const listeners = [];
      const child = nodeSpawn(command, args, { env: childEnv, detached: true, stdio: ['ignore', fd, fd] });
      child.once('error', (err) => { failure = err; listeners.forEach((cb) => cb(err)); });
      child.unref();
      fs.closeSync(fd);
      return { pid: child.pid, onError: (cb) => { if (failure) cb(failure); else listeners.push(cb); } };
    },
    // Only a real portal page counts as "the server answers": a foreign process on the port must not be adopted.
    probe: (port) => new Promise((resolve) => {
      const req = http.get({ host: LOOPBACK, port, path: '/', headers: { Host: `${LOOPBACK}:${port}` }, timeout: 1000 }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (body.length < 4096) body += c; });
        res.on('end', () => resolve(res.statusCode === 200 && body.includes('portal-token')));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    }),
    isAlive: (pid) => {
      try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
    },
    kill: (pid, sig) => { try { process.kill(pid, sig); } catch { /* already gone */ } },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    spawnBrowser: (command, args) => new Promise((resolve) => {
      const child = nodeSpawn(command, args, { stdio: 'ignore', env });
      const forward = ['SIGINT', 'SIGTERM'].map((sig) => { const fn = () => child.kill(sig); process.on(sig, fn); return [sig, fn]; });
      const done = (code) => { forward.forEach(([sig, fn]) => process.off(sig, fn)); resolve(code); };
      child.on('error', () => done(1));
      child.on('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
    }),
    graceMs: 5000, pollMs: 100, startTimeoutMs: 15000,
  };
}

/** Serialise the check-then-start/attach/detach sections between launcher instances (mkdir is atomic). */
async function withLock(stateDir, deps, fn) {
  const lock = path.join(stateDir, 'portal', 'run.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let waited = 0; ; waited += 50) {
    try { fs.mkdirSync(lock); break; } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
      if (age > 30000 || waited >= 10000) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
      await deps.sleep(50);
    }
  }
  try { return await fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

async function waitUntil(deps, pred, timeoutMs) {
  for (let waited = 0; waited <= timeoutMs; waited += deps.pollMs) {
    if (await pred()) return true;
    await deps.sleep(deps.pollMs);
  }
  return false;
}

async function stopServer(pid, deps) {
  deps.kill(pid, 'SIGTERM');
  if (await waitUntil(deps, () => !deps.isAlive(pid), deps.graceMs)) return;
  deps.kill(pid, 'SIGKILL');
}

export async function runLaunch(args, io, overrides = {}, env = process.env) {
  const deps = { ...defaultDeps(env), ...overrides };
  let values;
  let targets;
  try {
    values = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true }).values;
    buildPortalSpawn(args, env); // validates port, idle-exit and the rest with the exact rules of `amauta portal`
    targets = resolveTargets({ claudeHome: values['claude-home'], stateDir: values['state-dir'] }, env);
  } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
  const stateDir = targets.stateDir;
  const me = deps.pid;
  const browser = findBrowser(env, deps.which);
  const opener = browser ?? deps.which('xdg-open');
  if (!opener) {
    io.stderr.write('amauta portal launch: no Chromium-family browser (google-chrome, chromium) and no xdg-open found; set AMAUTA_BROWSER\n');
    return 1;
  }

  // Attach to a live launcher-started server, or start one.
  const attached = await withLock(stateDir, deps, async () => {
    const run = readRunFile(stateDir);
    if (run && deps.isAlive(run.pid) && (await deps.probe(run.port))) {
      writeRunFile(stateDir, { ...run, launchers: [...new Set([...run.launchers.filter((p) => deps.isAlive(p)), me])] });
      return { run, started: false };
    }
    if (run) removeRunFile(stateDir); // stale: never signal a pid we cannot prove is ours
    const port = values.port !== undefined ? Number(values.port) : await deps.findFreePort();
    const forwarded = [...args.filter((a, i) => !(a === '--port' || args[i - 1] === '--port' || a.startsWith('--port='))), '--port', String(port)];
    if (!args.some((a) => a === '--idle-exit' || a.startsWith('--idle-exit='))) forwarded.push('--idle-exit', DEFAULT_IDLE_EXIT);
    const built = buildPortalSpawn(forwarded, env);
    fs.mkdirSync(path.join(stateDir, 'portal'), { recursive: true });
    const child = deps.spawnServer(built.command, built.args, { env: built.env, detached: true, logFile: path.join(stateDir, 'portal', 'portal.log') });
    let failure = null;
    child.onError((err) => { failure = err; });
    if (child.pid === undefined || failure) {
      io.stderr.write(`amauta portal launch: cannot start ${built.command}: ${failure?.message ?? 'spawn failed'}\n`);
      return null;
    }
    const url = `http://${LOOPBACK}:${port}/`;
    writeRunFile(stateDir, { pid: child.pid, port, url, started: new Date().toISOString(), launchers: [me] });
    const up = await waitUntil(deps, async () => !failure && deps.isAlive(child.pid) && (await deps.probe(port)), deps.startTimeoutMs);
    if (!up) {
      io.stderr.write(`amauta portal launch: the portal did not start (see ${path.join(stateDir, 'portal', 'portal.log')})\n`);
      await stopServer(child.pid, deps);
      removeRunFile(stateDir);
      return null;
    }
    return { run: { pid: child.pid, port, url }, started: true };
  });
  if (!attached) return 1;
  const { run } = attached;

  // The last launcher to close its window stops the server.
  const release = () => withLock(stateDir, deps, async () => {
    const cur = readRunFile(stateDir);
    if (!cur || cur.pid !== run.pid) return;
    const rest = cur.launchers.filter((p) => p !== me && deps.isAlive(p));
    if (rest.length) { writeRunFile(stateDir, { ...cur, launchers: rest }); return; }
    await stopServer(cur.pid, deps);
    removeRunFile(stateDir);
  });

  if (!browser) { // no app mode available: hand over to xdg-open; the server's idle timer ends it
    const code = await deps.spawnBrowser(opener, [run.url]);
    io.stderr.write('amauta portal launch: no Chromium-family browser, opened with xdg-open; the server exits on its own after the idle timeout\n');
    return code === 0 ? 0 : 1;
  }
  const profile = path.join(stateDir, 'portal', 'browser-profile');
  try {
    await deps.spawnBrowser(browser, [`--app=${run.url}`, `--user-data-dir=${profile}`, '--class=amauta-portal', '--no-first-run', '--no-default-browser-check']);
  } finally {
    await release();
  }
  return 0;
}
