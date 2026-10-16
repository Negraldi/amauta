import { spawn } from 'node:child_process';
import os from 'node:os';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot as gitRepoRoot, gitOrNull } from '../util/git.js';
import { resolveTargets } from '../install/paths.js';
import { repoRoot as packageRoot } from '../install/assets.js';
import { findOnPath } from '../codegraph/index.js';
import { GRAPHIFY_HINT } from './probe.js';

export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const DEFAULT_TIMEOUT_SECONDS = 1800;
const KEY_VAR = 'ANTHROPIC_API_KEY';
const OPTIONS = { cwd: { type: 'string' }, model: { type: 'string' }, timeout: { type: 'string' }, 'state-dir': { type: 'string' } };
const KEEP_BYTES = 65536; // of each captured stream: enough to explain a failure, never the whole run

const HINT_NO_KEY = `${KEY_VAR} is not set, so no semantic pass was run. Nothing is sent anywhere without it: \`graphify update\` and the post-commit hook keep the local code graph (SQL and markdown included) up to date with no LLM.`;

const REDACTED = '[redacted]';

// The vendor prefix of an Anthropic key (`sk-ant-`, optionally `api03-`) is public, not key material.
const PUBLIC_PREFIX = /^sk-ant-(?:[a-z]+\d+-)?/;
const MIN_FRAGMENT = 4; // a shorter match with an unknown key shape ("s", "sk") is ordinary text

/**
 * Masks `secret` on a raw text stream. The last secret.length - 1 characters are held back until more text arrives, so a
 * key split across chunks (or never followed by a newline) is still seen whole; that hold-back is the only buffering, so
 * output keeps streaming however long a line is. `end()` has nothing left to wait for: it drops a held tail only when it
 * is a prefix of the secret that goes beyond the public vendor prefix (a truncated key), and emits anything else, so
 * ordinary text that merely ends in "s" or "sk-ant-" survives.
 *
 * Inherent limit: masking is exact-match. A fragment of the key printed on its own in the middle of a stream (shorter
 * than the key, followed by more text) cannot be recognised and is passed through. Only a whole key and a truncated key
 * at the end of the stream are covered.
 */
export function streamMasker(secret) {
  if (!secret) return { push: (text) => text, end: () => '' };
  const floor = Math.max(PUBLIC_PREFIX.exec(secret)?.[0].length ?? 0, MIN_FRAGMENT - 1);
  let held = '';
  return {
    push(text) {
      const parts = (held + text).split(secret);
      const last = parts.pop();
      const safe = Math.max(0, last.length - (secret.length - 1));
      held = last.slice(safe);
      return parts.map((p) => p + REDACTED).join('') + last.slice(0, safe);
    },
    end() {
      const rest = held;
      held = '';
      for (let n = Math.min(rest.length, secret.length - 1); n > floor; n -= 1) if (secret.startsWith(rest.slice(-n))) return rest.slice(0, -n);
      return rest;
    },
  };
}

const killGroup = (child) => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } } };

/**
 * Run a command. The secret is masked in everything we hand back, on the raw stream (a chunk boundary or a missing
 * newline cannot expose it) and it is never passed on argv. stdout is streamed to `onOut` as it is masked; both streams
 * keep only their last KEEP_BYTES of already-masked text. After `timeoutMs` the whole process group is killed.
 */
export function capture(cmd, args, { cwd, env, secret, timeoutMs, onOut, children }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children?.add(child);
    const maskers = { out: streamMasker(secret), err: streamMasker(secret) };
    const tail = { out: '', err: '' };
    const dropped = { out: false, err: false };
    const keep = (name, text) => {
      if (!text) return;
      tail[name] += text;
      if (tail[name].length > KEEP_BYTES) { tail[name] = tail[name].slice(-KEEP_BYTES); dropped[name] = true; }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      const safe = maskers.out.push(d);
      if (!safe) return;
      keep('out', safe);
      onOut?.(safe);
    });
    child.stderr.on('data', (d) => keep('err', maskers.err.push(d)));
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; killGroup(child); }, timeoutMs) : null;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      children?.delete(child);
      const rest = maskers.out.end();
      if (rest) { keep('out', rest); onOut?.(rest); }
      keep('err', maskers.err.end());
      const note = (name) => (dropped[name] ? `[amauta: earlier output truncated, last ${KEEP_BYTES} bytes kept]\n` : '');
      const err = r.err === undefined ? note('err') + tail.err : r.err;
      resolve({ timedOut, out: note('out') + tail.out, ...r, err });
    };
    child.on('error', (e) => finish({ code: null, missing: e.code === 'ENOENT', err: String(e.message).split(secret || '\0').join(REDACTED) }));
    child.on('close', (code) => finish({ code, missing: false }));
  });
}

// The lock helper needs no secrets: it gets only what python3 needs to start, never ANTHROPIC_API_KEY or anything else.
function lockHelperEnv(env = process.env) {
  const out = { PYTHONPATH: path.join(packageRoot, 'python') };
  for (const name of ['PATH', 'HOME', 'LANG']) if (env[name] !== undefined) out[name] = env[name];
  return out;
}

const LOCK_BUSY = 75; // EX_TEMPFAIL from `amauta.graph.lock acquire`: held by someone else

/**
 * Take the per-repo graphify lock. There is no protocol here: python/amauta/graph/lock.py is the one implementation
 * (stale rule, start token, atomic takeover) shared with the post-commit hook and the Python writers; this asks it to
 * record this process as the owner. Returns a release function, or null when the lock is held (fail fast).
 */
export async function takeLock(lock) {
  const result = await new Promise((resolve) => {
    const child = spawn('python3', ['-P', '-m', 'amauta.graph.lock', 'acquire', '--lock', lock, '--pid', String(process.pid)], {
      env: lockHelperEnv(), stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ code: null, err: String(e.message) }));
    child.on('close', (code) => resolve({ code, err }));
  });
  if (result.code === LOCK_BUSY) return null;
  if (result.code !== 0) throw new Error(`could not take the graphify lock: ${result.err.trim() || `lock helper exited ${result.code}`}`);
  const release = async () => { await rm(lock, { recursive: true, force: true }); };
  return release;
}

function parseTimeout(raw, env) {
  const value = raw ?? env.AMAUTA_GRAPHIFY_TIMEOUT;
  if (value === undefined || value === '') return DEFAULT_TIMEOUT_SECONDS;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid timeout ${JSON.stringify(value)}: expected a positive number of seconds`);
  return n;
}

/**
 * `graphify extract <repo> --backend claude --model M`, only when ANTHROPIC_API_KEY is set. The key is read from the
 * environment only to decide, is inherited by the one graphify child that needs it, and is never printed, stored or
 * logged (output is masked, the mirror step runs without it). The run holds the hook's per-repo lock and is killed after
 * the timeout (seconds; default 30 minutes). It installs no process-wide handlers: pass an AbortSignal whose reason is a
 * signal name ('SIGINT'...) to interrupt it; it then kills graphify, releases the lock and returns 128+n.
 */
export async function runSemantic({ cwd = process.cwd(), model, timeout, stateDir, env = process.env, searchPath, signal } = {}, io) {
  const key = env[KEY_VAR];
  if (!key) {
    io.stderr.write(`amauta: ${HINT_NO_KEY}\n`);
    return 1;
  }
  let seconds;
  try { seconds = parseTimeout(timeout, env); } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
  const chosen = model || env.AMAUTA_GRAPHIFY_MODEL || DEFAULT_MODEL;
  const root = (await gitRepoRoot(path.resolve(cwd))) ?? path.resolve(cwd);
  const exe = await findOnPath('graphify', searchPath ?? env.PATH ?? '');
  if (!exe) {
    io.stderr.write(`amauta: ${GRAPHIFY_HINT}\n`);
    return 1;
  }
  const lockRel = (await gitOrNull(root, ['rev-parse', '--git-path', 'amauta-graphify.lock']))?.trim();
  const lock = lockRel ? path.resolve(root, lockRel) : null;
  let release;
  try { release = lock ? await takeLock(lock) : async () => {}; } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
  if (!release) {
    io.stderr.write(`amauta: a graphify refresh is already running for this repository (lock ${lock}); wait for it to finish and run this again\n`);
    return 1;
  }
  // The caller owns signals (see semanticCommand). On abort every detached child of THIS pass is killed with its process
  // group, so an interrupt cannot orphan an extract that keeps calling the API, and `finally` releases the lock.
  const children = new Set();
  const onAbort = () => { for (const child of children) killGroup(child); };
  signal?.addEventListener('abort', onAbort, { once: true });
  const interrupted = () => (signal?.aborted ? 128 + (os.constants.signals[signal.reason] ?? os.constants.signals.SIGTERM) : 0);
  try {
    if (interrupted()) return interrupted();
    io.stdout.write(`amauta: running the semantic pass on ${root} with ${chosen} (this calls the Anthropic API; stops after ${seconds}s)\n`);
    const extract = await capture(exe, ['extract', root, '--backend', 'claude', '--model', chosen], {
      cwd: root, env: { ...env, GRAPHIFY_QUERY_LOG_DISABLE: '1' }, secret: key, timeoutMs: seconds * 1000, onOut: (text) => io.stdout.write(text), children,
    });
    if (interrupted()) return interrupted();
    if (extract.code !== 0) {
      if (extract.err) io.stderr.write(extract.err.endsWith('\n') ? extract.err : `${extract.err}\n`);
      io.stderr.write(extract.timedOut
        ? `amauta: graphify extract timed out after ${seconds}s and was stopped; the graph mirror was not updated (raise --timeout or AMAUTA_GRAPHIFY_TIMEOUT)\n`
        : `amauta: graphify extract failed (exit ${extract.code ?? 'not started'}); the graph mirror was not updated\n`);
      return 1;
    }
    const { [KEY_VAR]: _omit, ...clean } = env;
    const sync = await capture('python3', ['-P', '-m', 'amauta.graph', 'sync', '--repo', root, '--semantic-model', chosen], {
      cwd: root,
      env: { ...clean, PYTHONPATH: path.join(packageRoot, 'python'), AMAUTA_STATE_DIR: resolveTargets({ stateDir }).stateDir },
      secret: key,
      timeoutMs: 120000,
      children,
    });
    if (interrupted()) return interrupted();
    if (sync.code !== 0) {
      io.stderr.write(`amauta: the extraction finished but the graph sync failed: ${(sync.err || sync.out).trim()}\n`);
      return 1;
    }
    io.stdout.write(`amauta: semantic pass done; mirrored ${sync.out.trim()}\n`);
    if (lock && (await stat(`${lock}.pending`).then(() => true, () => false))) {
      io.stdout.write('amauta: a commit (post-commit hook) happened during the pass and its refresh was skipped; run `graphify update .` or commit again to bring the graph up to date\n');
    }
    return 0;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await release();
  }
}

export async function semanticCommand(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true }));
  } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
  // The CLI entrypoint owns signal handling; the library only sees the abort signal.
  const ac = new AbortController();
  const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((name) => [name, () => ac.abort(name)]);
  for (const [name, h] of handlers) process.on(name, h);
  try {
    return await runSemantic({ cwd: values.cwd, model: values.model, timeout: values.timeout, stateDir: values['state-dir'], signal: ac.signal }, io);
  } finally {
    for (const [name, h] of handlers) process.off(name, h);
  }
}
