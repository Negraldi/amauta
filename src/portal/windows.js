/**
 * The portal launcher on Windows (ADR 0005, plan N12h).
 *
 * Input: the environment (ProgramFiles, LOCALAPPDATA, APPDATA, SystemRoot). Output: browser candidates, the opener of
 * last resort and the PowerShell command that writes a Start menu shortcut. Side effects: none; callers run the
 * command. Every path reaches PowerShell as an environment variable, so a quote or `$( )` in a path is only text.
 */
import path from 'node:path';

const W = path.win32;

/** Edge first (it ships with Windows), then Chrome per machine and per user. Missing base folders give no guesses. */
export function windowsBrowsers(env) {
  const out = [];
  const edge = [env['ProgramFiles(x86)'], env.ProgramFiles];
  const chrome = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA];
  for (const base of edge) if (base) out.push(W.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  for (const base of chrome) if (base) out.push(W.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return out;
}

/** Without Edge or Chrome, explorer opens the address in the default browser. */
export const windowsOpener = (env) => W.join(env.SystemRoot || 'C:\\Windows', 'explorer.exe');

export const startMenuDir = (env) => W.join(env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');

export const SHORTCUT_SCRIPT = [
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:AMAUTA_SHORTCUT_LNK)',
  '$s.TargetPath = $env:AMAUTA_SHORTCUT_TARGET',
  '$s.Arguments = $env:AMAUTA_SHORTCUT_ARGS',
  '$s.IconLocation = $env:AMAUTA_SHORTCUT_TARGET + ",0"',
  '$s.Description = "amauta control portal and wiki"',
  '$s.WindowStyle = 7',
  '$s.Save()',
].join('; ');

/** The shortcut runs `node <bin> portal launch`; Windows argument quoting wraps the bin path in double quotes. */
export function shortcutCommand({ lnk, nodePath, binPath }) {
  if (/["\r\n]/.test(binPath)) throw new Error(`unsupported character in path: ${JSON.stringify(binPath)}`);
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHORTCUT_SCRIPT],
    env: { AMAUTA_SHORTCUT_LNK: lnk, AMAUTA_SHORTCUT_TARGET: nodePath, AMAUTA_SHORTCUT_ARGS: `"${binPath}" portal launch` },
  };
}
