import { execFile } from 'node:child_process';
import { access, constants, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

// codegraph (https://github.com/colbymchenry/codegraph) is an external tool: detected on PATH, never vendored.
// The npm package is @colbymchenry/codegraph (the unscoped `codegraph` package on npm is a different project).
export const CODEGRAPH_HINT = 'codegraph not found on PATH. Install it with: npm i -g @colbymchenry/codegraph';

const PROJECT_MARKERS = [
  '.git', 'package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'go.mod', 'Cargo.toml', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'mix.exs', 'CMakeLists.txt', 'Package.swift',
];

const exists = (p) => stat(p).then(() => true, () => false);

/** Absolute path of an executable named `name` on `searchPath` (default $PATH), or null. */
export async function findOnPath(name, searchPath = process.env.PATH ?? '') {
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      const st = await stat(candidate);
      if (!st.isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

const real = (p) => realpath(p).catch(() => path.resolve(p));
const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/**
 * Resolve `dir` and refuse anything that is not a real project root: the home directory, the filesystem root,
 * temporary directories, missing directories and directories without a project marker.
 */
export async function checkProjectDir(dir, { home = os.homedir(), tmpRoots = [os.tmpdir(), '/tmp', '/var/tmp'] } = {}) {
  const resolved = path.resolve(dir);
  if (!(await stat(resolved).then((s) => s.isDirectory(), () => false))) throw new Error(`refusing: ${resolved} does not exist or is not a directory`);
  const target = await real(resolved);
  if (target === path.parse(target).root) throw new Error('refusing: the filesystem root is not a project');
  if (target === (await real(home))) throw new Error('refusing: the home directory is not a project');
  for (const tmp of tmpRoots) {
    if (within(target, await real(tmp))) throw new Error(`refusing: ${target} is inside a temporary directory`);
  }
  let marked = false;
  for (const marker of PROJECT_MARKERS) {
    if (await exists(path.join(target, marker))) { marked = true; break; }
  }
  if (!marked) throw new Error(`refusing: ${target} is not a project root (no .git, package.json, pyproject.toml, ... found); run it from the repository root`);
  return target;
}

export async function codegraphStatus({ cwd = process.cwd(), searchPath } = {}) {
  const found = await findOnPath('codegraph', searchPath);
  return {
    onPath: found !== null,
    path: found,
    indexed: await exists(path.join(path.resolve(cwd), '.codegraph')),
    hint: found === null ? CODEGRAPH_HINT : null,
  };
}

/** `codegraph init -y` in a checked project root. Arguments are passed as an argv array, never through a shell. */
export async function codegraphInit({ cwd = process.cwd(), searchPath, home, tmpRoots } = {}, io) {
  let root;
  try {
    root = await checkProjectDir(cwd, { ...(home ? { home } : {}), ...(tmpRoots ? { tmpRoots } : {}) });
  } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
  const exe = await findOnPath('codegraph', searchPath);
  if (!exe) {
    io.stderr.write(`gentle-lite: ${CODEGRAPH_HINT}\n`);
    return 1;
  }
  return new Promise((resolve) => {
    execFile(exe, ['init', '-y'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: searchPath ? { ...process.env, PATH: searchPath } : process.env }, (err, stdout, stderr) => {
      if (stdout) io.stdout.write(stdout);
      if (stderr) io.stderr.write(stderr);
      if (err) {
        io.stderr.write(`gentle-lite: codegraph init failed: ${err.message}\n`);
        resolve(typeof err.code === 'number' ? err.code : 1);
      } else {
        resolve(0);
      }
    });
  });
}

const OPTIONS = { cwd: { type: 'string' } };

async function run(args, io) {
  const [sub, ...rest] = args;
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false, strict: true }));
  } catch (err) {
    io.stderr.write(`gentle-lite: ${err.message}\n`);
    return 1;
  }
  const cwd = path.resolve(values.cwd ?? process.cwd());
  if (sub === 'init') return codegraphInit({ cwd }, io);
  if (sub === 'status') {
    const s = await codegraphStatus({ cwd });
    io.stdout.write(`codegraph: ${s.onPath ? s.path : 'not on PATH'}\nindex (.codegraph/) in ${cwd}: ${s.indexed ? 'present' : 'missing'}\n`);
    if (s.hint) io.stdout.write(`${s.hint}\n`);
    return 0;
  }
  io.stderr.write('gentle-lite: usage: gentle-lite codegraph <init|status> [--cwd DIR]\n');
  return 1;
}

export function registerCodegraphCommands(commands) {
  commands.set('codegraph', { summary: 'Initialize / inspect the external codegraph index of a project (init|status --cwd)', run });
}
