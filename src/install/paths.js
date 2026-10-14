import os from 'node:os';
import path from 'node:path';

/**
 * Resolve install targets. Precedence: explicit option > environment > default.
 * When the Claude home is customised and the other two are not, they are derived
 * inside it so a sandboxed install can never reach the real home directory.
 */
export function resolveTargets(opts = {}, env = process.env, home = os.homedir()) {
  const claudeHomeInput = opts.claudeHome ?? env.GENTLE_LITE_CLAUDE_HOME;
  const claudeHome = path.resolve(claudeHomeInput ?? path.join(home, '.claude'));
  const custom = claudeHomeInput !== undefined;
  const claudeJson = path.resolve(
    opts.claudeJson ?? env.GENTLE_LITE_CLAUDE_JSON ?? (custom ? path.join(claudeHome, '.claude.json') : path.join(home, '.claude.json')),
  );
  const stateDir = path.resolve(
    opts.stateDir ?? env.GENTLE_LITE_STATE_DIR ?? (custom ? path.join(claudeHome, '.gentle-lite') : path.join(home, '.gentle-lite')),
  );
  return { claudeHome, claudeJson, stateDir };
}
