import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { startMenuDir, shortcutCommand } from './windows.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = 'amauta-portal.desktop';
const RESERVED = /[\s"'\\<>~|&;$*?#()`]/;

/** One Exec argument per the Desktop Entry spec: quote reserved characters, escape inside quotes, the file format doubles the backslashes later (see desktopEntry). */
export function execQuote(arg) {
  if (/[\n\r]/.test(arg)) throw new Error(`path contains a newline: ${JSON.stringify(arg)}`);
  const text = arg.replaceAll('%', '%%');
  if (!RESERVED.test(text)) return text;
  const inner = text.replace(/(["`$\\])/g, '\\$1');
  return `"${inner}"`;
}

export function desktopEntry({ nodePath, binPath, iconPath }) {
  for (const p of [nodePath, binPath, iconPath]) if (/[\n\r]/.test(p)) throw new Error(`path contains a newline: ${JSON.stringify(p)}`);
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=amauta',
    'Comment=amauta control portal and wiki',
    `Exec=${[nodePath, binPath].map(execQuote).join(' ').replaceAll('\\', '\\\\')} portal launch`,
    `Icon=${iconPath}`,
    'Terminal=false',
    'Categories=Development;',
    'StartupWMClass=amauta-portal',
    '',
  ].join('\n');
}

export function applicationsDir(values, env = process.env, home = os.homedir()) {
  if (values.flag) return path.resolve(values.flag);
  if (env.AMAUTA_APPLICATIONS_DIR) return path.resolve(env.AMAUTA_APPLICATIONS_DIR);
  return path.join(env.XDG_DATA_HOME ? path.resolve(env.XDG_DATA_HOME) : path.join(home, '.local', 'share'), 'applications');
}

function defaultWhich(name) {
  for (const d of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const c = path.join(d, name);
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ }
  }
  return null;
}

export async function runInstallLauncher(args, io, overrides = {}) {
  const deps = { platform: process.platform, env: process.env, nodePath: process.execPath, which: defaultWhich,
    run: (cmd, a, o = {}) => spawnSync(cmd, a, { stdio: 'ignore', ...o }), remove: (f) => fs.rmSync(f, { force: true }), ...overrides };
  let values;
  try {
    values = parseArgs({ args, options: { remove: { type: 'boolean' }, 'applications-dir': { type: 'string' } }, allowPositionals: false, strict: true }).values;
  } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 1;
  }
  if (deps.platform === 'win32') return installWindowsShortcut(values.remove, io, deps);
  const dir = applicationsDir({ flag: values['applications-dir'] });
  const file = path.join(dir, ENTRY);
  try {
    if (values.remove) {
      fs.rmSync(file, { force: true });
    } else {
      fs.mkdirSync(dir, { recursive: true });
      const text = desktopEntry({ nodePath: deps.nodePath, binPath: path.join(repoRoot, 'bin', 'amauta.js'), iconPath: path.join(repoRoot, 'python', 'amauta', 'portal', 'static', 'icon.svg') });
      fs.writeFileSync(file, text);
    }
  } catch (err) {
    io.stderr.write(`amauta portal: cannot ${values.remove ? 'remove' : 'write'} ${file}: ${err.message}\n`);
    return 1;
  }
  const updater = deps.which('update-desktop-database');
  if (updater) { try { deps.run(updater, [dir]); } catch { /* optional cache refresh */ } }
  io.stdout.write(values.remove ? `removed ${file}\n` : `installed ${file}\n`);
  return 0;
}

/** Windows: a Start menu shortcut (amauta.lnk) that runs `node <bin> portal launch`, written by PowerShell. */
function installWindowsShortcut(remove, io, deps) {
  const lnk = path.win32.join(startMenuDir(deps.env), 'amauta.lnk');
  if (remove) {
    deps.remove(lnk);
    io.stdout.write(`removed ${lnk}\n`);
    return 0;
  }
  const cmd = shortcutCommand({ lnk, nodePath: deps.nodePath, binPath: path.join(repoRoot, 'bin', 'amauta.js') });
  const r = deps.run(cmd.command, cmd.args, { env: { ...deps.env, ...cmd.env }, windowsHide: true });
  if (!r || r.status !== 0) {
    io.stderr.write(`amauta portal: PowerShell could not write ${lnk}\n`);
    return 1;
  }
  io.stdout.write(`installed ${lnk}\n`);
  return 0;
}
