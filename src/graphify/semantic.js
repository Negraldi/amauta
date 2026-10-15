import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot as gitRepoRoot } from '../util/git.js';
import { resolveTargets } from '../install/paths.js';
import { repoRoot as packageRoot } from '../install/assets.js';
import { findOnPath } from '../codegraph/index.js';

export const DEFAULT_MODEL = 'claude-haiku-5-5';
const KEY_VAR = 'ANTHROPIC_API_KEY';
const OPTIONS = { cwd: { type: 'string' }, model: { type: 'string' }, 'state-dir': { type: 'string' } };

const HINT_NO_KEY = `${KEY_VAR} is not set, so no semantic pass was run. Nothing is sent anywhere without it: \`graphify update\` and the post-commit hook keep the local code graph (SQL and markdown included) up to date with no LLM.`;
const HINT_NO_GRAPHIFY = 'graphify not found on PATH. Install it with: pipx install "graphifyy[sql,anthropic]"';

/** Run a command, collecting its output. The secret is masked in everything we hand back; it is never passed on argv. */
function capture(cmd, args, { cwd, env, secret }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const mask = (text) => (secret ? text.split(secret).join('[redacted]') : text);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ code: null, missing: e.code === 'ENOENT', out: '', err: mask(String(e.message)) }));
    child.on('close', (code) => resolve({ code, missing: false, out: mask(out), err: mask(err) }));
  });
}

/**
 * `graphify extract <repo> --backend claude --model M`, only when ANTHROPIC_API_KEY is set. The key is read from the
 * environment only to decide, is inherited by the one graphify child that needs it, and is never printed, stored or
 * logged (output is masked, the mirror step runs without it).
 */
export async function runSemantic({ cwd = process.cwd(), model, stateDir, env = process.env, searchPath } = {}, io) {
  const key = env[KEY_VAR];
  if (!key) {
    io.stderr.write(`gentle-lite: ${HINT_NO_KEY}\n`);
    return 1;
  }
  const chosen = model || env.GENTLE_LITE_GRAPHIFY_MODEL || DEFAULT_MODEL;
  const root = (await gitRepoRoot(path.resolve(cwd))) ?? path.resolve(cwd);
  const exe = await findOnPath('graphify', searchPath ?? env.PATH ?? '');
  if (!exe) {
    io.stderr.write(`gentle-lite: ${HINT_NO_GRAPHIFY}\n`);
    return 1;
  }
  io.stdout.write(`gentle-lite: running the semantic pass on ${root} with ${chosen} (this calls the Anthropic API)\n`);
  const extract = await capture(exe, ['extract', root, '--backend', 'claude', '--model', chosen], { cwd: root, env: { ...env, GRAPHIFY_QUERY_LOG_DISABLE: '1' }, secret: key });
  if (extract.out) io.stdout.write(extract.out);
  if (extract.code !== 0) {
    if (extract.err) io.stderr.write(extract.err.endsWith('\n') ? extract.err : `${extract.err}\n`);
    io.stderr.write(`gentle-lite: graphify extract failed (exit ${extract.code ?? 'not started'}); the graph mirror was not updated\n`);
    return 1;
  }
  const { [KEY_VAR]: _omit, ...clean } = env;
  const sync = await capture('python3', ['-P', '-m', 'gentle_lite.graph', 'sync', '--repo', root, '--semantic-model', chosen], {
    cwd: root,
    env: { ...clean, PYTHONPATH: path.join(packageRoot, 'python'), GENTLE_LITE_STATE_DIR: resolveTargets({ stateDir }).stateDir },
    secret: key,
  });
  if (sync.code !== 0) {
    io.stderr.write(`gentle-lite: the extraction finished but the graph sync failed: ${(sync.err || sync.out).trim()}\n`);
    return 1;
  }
  io.stdout.write(`gentle-lite: semantic pass done; mirrored ${sync.out.trim()}\n`);
  return 0;
}

export async function semanticCommand(args, io) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true }));
  } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
  return runSemantic({ cwd: values.cwd, model: values.model, stateDir: values['state-dir'] }, io);
}
