/**
 * Runs the portable test subset listed in test/portable.json (plan N9): node --test on the Node files, then
 * `<python> -m unittest` on the Python modules, with <python> from AMAUTA_PYTHON or `python`. Exit status: non-zero
 * when either runner fails. Used by CI on Windows; works on every OS.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const list = JSON.parse(readFileSync(path.join(root, 'test', 'portable.json'), 'utf8'));
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit' }).status ?? 1;
const node = run(process.execPath, ['--test', ...list.node]);
const python = run(process.env.AMAUTA_PYTHON || 'python', ['-m', 'unittest', ...list.python]);
process.exitCode = node || python;
