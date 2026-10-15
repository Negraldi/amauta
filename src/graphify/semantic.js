import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
const STALE_LOCK_MS = 15 * 60 * 1000; // same age gate as the post-commit hook

const HINT_NO_KEY = `${KEY_VAR} is not set, so no semantic pass was run. Nothing is sent anywhere without it: \`graphify update\` and the post-commit hook keep the local code graph (SQL and markdown included) up to date with no LLM.`;

/**
 * Run a command. The secret is masked in everything we hand back (line by line, so a chunk boundary cannot split it);
 * it is never passed on argv. stdout can be streamed to `onOut` as lines complete; both streams keep only their last
 * KEEP_BYTES. After `timeoutMs` the whole process group is killed and the result says so.
 */
function capture(cmd, args, { cwd, env, secret, timeoutMs, onOut }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const mask = (text) => (secret ? text.split(secret).join('[redacted]') : text);
    const tail = { out: '', err: '' };
    const dropped = { out: false, err: false };
    const partial = { out: '' };
    const keep = (name, text) => {
      tail[name] += text;
      if (tail[name].length > KEEP_BYTES) { tail[name] = tail[name].slice(-KEEP_BYTES); dropped[name] = true; }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      partial.out += d;
      const cut = partial.out.lastIndexOf('\n');
      if (cut < 0) return;
      const done = mask(partial.out.slice(0, cut + 1));
      partial.out = partial.out.slice(cut + 1);
      keep('out', done);
      onOut?.(done);
    });
    child.stderr.on('data', (d) => keep('err', d));
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs) : null;
    const finish = (r) => {
      clearTimeout(timer);
      if (partial.out) { const rest = mask(partial.out); partial.out = ''; keep('out', rest); onOut?.(rest); }
      // A truncated tail may start inside the secret: drop the partial first line so masking stays exact.
      for (const name of ['out', 'err']) if (dropped[name]) tail[name] = tail[name].slice(tail[name].indexOf('\n') + 1);
      const note = (name) => (dropped[name] ? `[gentle-lite: earlier output truncated, last ${KEEP_BYTES} bytes kept]\n` : '');
      resolve({ timedOut, out: note('out') + mask(tail.out), err: note('err') + mask(tail.err), ...r });
    };
    child.on('error', (e) => finish({ code: null, missing: e.code === 'ENOENT', err: mask(String(e.message)) }));
    child.on('close', (code) => finish({ code, missing: false }));
  });
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/**
 * Take the post-commit hook's per-repo lock (same directory, same stale rule: older than 15 minutes AND owner gone), so the
 * hook's `graphify update` and this pass never write graphify-out together. Returns null when it is held (fail fast).
 */
async function takeLock(lock) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(lock);
      await writeFile(path.join(lock, 'pid'), `${process.pid}\n`);
      return async () => { await rm(lock, { recursive: true, force: true }); };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const age = Date.now() - (await stat(lock).then((s) => s.mtimeMs, () => Date.now()));
    const owner = Number.parseInt(await readFile(path.join(lock, 'pid'), 'utf8').then((t) => t, () => ''), 10);
    if (age > STALE_LOCK_MS && !(owner > 0 && pidAlive(owner))) await rm(lock, { recursive: true, force: true });
    else return null;
  }
  return null;
}

function parseTimeout(raw, env) {
  const value = raw ?? env.GENTLE_LITE_GRAPHIFY_TIMEOUT;
  if (value === undefined || value === '') return DEFAULT_TIMEOUT_SECONDS;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid timeout ${JSON.stringify(value)}: expected a positive number of seconds`);
  return n;
}

/**
 * `graphify extract <repo> --backend claude --model M`, only when ANTHROPIC_API_KEY is set. The key is read from the
 * environment only to decide, is inherited by the one graphify child that needs it, and is never printed, stored or
 * logged (output is masked, the mirror step runs without it). The run holds the hook's per-repo lock and is killed after
 * the timeout (seconds; default 30 minutes).
 */
export async function runSemantic({ cwd = process.cwd(), model, timeout, stateDir, env = process.env, searchPath } = {}, io) {
  const key = env[KEY_VAR];
  if (!key) {
    io.stderr.write(`gentle-lite: ${HINT_NO_KEY}\n`);
    return 1;
  }
  let seconds;
  try { seconds = parseTimeout(timeout, env); } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
  const chosen = model || env.GENTLE_LITE_GRAPHIFY_MODEL || DEFAULT_MODEL;
  const root = (await gitRepoRoot(path.resolve(cwd))) ?? path.resolve(cwd);
  const exe = await findOnPath('graphify', searchPath ?? env.PATH ?? '');
  if (!exe) {
    io.stderr.write(`gentle-lite: ${GRAPHIFY_HINT}\n`);
    return 1;
  }
  const lockRel = (await gitOrNull(root, ['rev-parse', '--git-path', 'gentle-lite-graphify.lock']))?.trim();
  const lock = lockRel ? path.resolve(root, lockRel) : null;
  const release = lock ? await takeLock(lock) : () => {};
  if (!release) {
    io.stderr.write(`gentle-lite: a graphify refresh is already running for this repository (lock ${lock}); wait for it to finish and run this again\n`);
    return 1;
  }
  try {
    io.stdout.write(`gentle-lite: running the semantic pass on ${root} with ${chosen} (this calls the Anthropic API; stops after ${seconds}s)\n`);
    const extract = await capture(exe, ['extract', root, '--backend', 'claude', '--model', chosen], {
      cwd: root, env: { ...env, GRAPHIFY_QUERY_LOG_DISABLE: '1' }, secret: key, timeoutMs: seconds * 1000, onOut: (text) => io.stdout.write(text),
    });
    if (extract.code !== 0) {
      if (extract.err) io.stderr.write(extract.err.endsWith('\n') ? extract.err : `${extract.err}\n`);
      io.stderr.write(extract.timedOut
        ? `gentle-lite: graphify extract timed out after ${seconds}s and was stopped; the graph mirror was not updated (raise --timeout or GENTLE_LITE_GRAPHIFY_TIMEOUT)\n`
        : `gentle-lite: graphify extract failed (exit ${extract.code ?? 'not started'}); the graph mirror was not updated\n`);
      return 1;
    }
    const { [KEY_VAR]: _omit, ...clean } = env;
    const sync = await capture('python3', ['-P', '-m', 'gentle_lite.graph', 'sync', '--repo', root, '--semantic-model', chosen], {
      cwd: root,
      env: { ...clean, PYTHONPATH: path.join(packageRoot, 'python'), GENTLE_LITE_STATE_DIR: resolveTargets({ stateDir }).stateDir },
      secret: key,
      timeoutMs: 120000,
    });
    if (sync.code !== 0) {
      io.stderr.write(`gentle-lite: the extraction finished but the graph sync failed: ${(sync.err || sync.out).trim()}\n`);
      return 1;
    }
    io.stdout.write(`gentle-lite: semantic pass done; mirrored ${sync.out.trim()}\n`);
    if (lock && (await stat(`${lock}.pending`).then(() => true, () => false))) {
      io.stdout.write('gentle-lite: a commit (post-commit hook) happened during the pass and its refresh was skipped; run `graphify update .` or commit again to bring the graph up to date\n');
    }
    return 0;
  } finally {
    await release();
  }
}

export async function semanticCommand(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true }));
  } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
  return runSemantic({ cwd: values.cwd, model: values.model, timeout: values.timeout, stateDir: values['state-dir'] }, io);
}
