/**
 * Platform layer (plan N8, ADR 0003): the few places where Windows differs from POSIX.
 *
 * Every function takes the platform as an argument (default `process.platform`) so both branches are testable on any
 * OS. No side effects except `killTree`, which signals or runs `taskkill`. Failure mode: lookups return null, kills
 * ignore a process that is already gone.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import path from 'node:path';

/** Absolute path of an executable `name` on `searchPath`, honouring PATHEXT on Windows; null when absent. */
export async function findOnPath(name, searchPath = process.env.PATH ?? '', opts = {}) {
  const { platform = process.platform, pathext = process.env.PATHEXT } = opts;
  const win = platform === 'win32';
  const exts = win ? ['', ...(pathext || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  const delimiter = win ? ';' : path.delimiter;
  for (const dir of searchPath.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (win && ext === '' && !path.extname(name)) continue; // a bare name on Windows needs an extension
      const candidate = path.join(dir, name + ext);
      try {
        if (!(await stat(candidate)).isFile()) continue;
        if (!win) await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/**
 * One argument of a hook command line. POSIX: single quotes only when needed (the shell is sh). Windows: double
 * quotes and forward slashes, which Git Bash, cmd and PowerShell all read as one path; characters that would be
 * interpreted inside double quotes are refused.
 */
export function quoteArg(arg, platform = process.platform) {
  if (platform === 'win32') {
    if (/["$`%!\n]/.test(arg)) throw new Error(`${arg} cannot be quoted safely for a Windows hook command`);
    return `"${arg.replaceAll('\\', '/')}"`;
  }
  return /^[A-Za-z0-9_./@:+,=-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** The `fs.symlink` type for a directory link: a junction on Windows (no administrator rights), a symlink elsewhere. */
export const linkType = (platform = process.platform) => (platform === 'win32' ? 'junction' : 'dir');

/** Kill a process and its children: the process group on POSIX (spawned detached), `taskkill /T /F` on Windows. */
export function killTree(pid, { platform = process.platform, kill = process.kill.bind(process), spawn = nodeSpawn } = {}) {
  if (platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      // already gone
    }
    return;
  }
  try {
    kill(-pid, 'SIGKILL');
  } catch {
    try {
      kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}
