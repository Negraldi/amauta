import os from 'node:os';
import path from 'node:path';

/**
 * Resolve install targets. Precedence: explicit option > environment > default.
 * When the Claude home is customised and the other two are not, they are derived
 * inside it so a sandboxed install can never reach the real home directory.
 */
export function resolveTargets(opts = {}, env = process.env, home = os.homedir()) {
  const claudeHomeInput = opts.claudeHome ?? env.AMAUTA_CLAUDE_HOME;
  const claudeHome = path.resolve(claudeHomeInput ?? path.join(home, '.claude'));
  const custom = claudeHomeInput !== undefined;
  const claudeJson = path.resolve(
    opts.claudeJson ?? env.AMAUTA_CLAUDE_JSON ?? (custom ? path.join(claudeHome, '.claude.json') : path.join(home, '.claude.json')),
  );
  const stateDir = path.resolve(
    opts.stateDir ?? env.AMAUTA_STATE_DIR ?? (custom ? path.join(claudeHome, '.amauta') : path.join(home, '.amauta')),
  );
  return { claudeHome, claudeJson, stateDir };
}

/**
 * Resolve the Codex install targets. Precedence: explicit option > AMAUTA_CODEX_HOME > CODEX_HOME > default.
 * Skills live in the shared agent skills directory (`~/.agents/skills`) unless AMAUTA_CODEX_SKILLS_DIR says otherwise.
 * A sandbox (custom Claude home, or an explicit Codex home other than `~/.codex`) keeps every Codex path inside
 * itself, and a custom Claude home also ignores the ambient CODEX_HOME, so a test run never reaches the real home.
 */
export function resolveCodexTargets(opts = {}, env = process.env, home = os.homedir()) {
  const claudeHomeInput = opts.claudeHome ?? env.AMAUTA_CLAUDE_HOME;
  const claudeCustom = claudeHomeInput !== undefined;
  const claudeHome = path.resolve(claudeHomeInput ?? path.join(home, '.claude'));
  const explicit = opts.codexHome ?? env.AMAUTA_CODEX_HOME;
  const codexHome = path.resolve(explicit ?? (claudeCustom ? path.join(claudeHome, '.codex') : (env.CODEX_HOME ?? path.join(home, '.codex'))));
  const sandboxed = claudeCustom || (explicit !== undefined && codexHome !== path.join(home, '.codex'));
  const codexSkillsDir = path.resolve(
    opts.codexSkillsDir ?? env.AMAUTA_CODEX_SKILLS_DIR ?? (sandboxed ? path.join(codexHome, '.agents', 'skills') : path.join(home, '.agents', 'skills')),
  );
  const stateDir = path.resolve(
    opts.stateDir ?? env.AMAUTA_STATE_DIR ?? (claudeCustom ? path.join(claudeHome, '.amauta') : path.join(home, '.amauta')),
  );
  return { codexHome, codexSkillsDir, stateDir };
}

/**
 * Where the Claude user config lives, for reading it from the Codex side (MCP servers and personal skills to mirror).
 * Same rules as resolveTargets, except that a sandboxed Codex (custom Codex home that is not the default one) with no
 * explicit Claude paths looks inside its own sandbox, so a test run can never read the real ~/.claude.json.
 */
export function resolveClaudeSource(opts = {}, env = process.env, home = os.homedir()) {
  const explicit = opts.claudeHome ?? env.AMAUTA_CLAUDE_HOME;
  const jsonExplicit = opts.claudeJson ?? env.AMAUTA_CLAUDE_JSON;
  if (explicit !== undefined || jsonExplicit !== undefined) {
    const t = resolveTargets(opts, env, home);
    return { claudeHome: t.claudeHome, claudeJson: t.claudeJson };
  }
  const codexExplicit = opts.codexHome ?? env.AMAUTA_CODEX_HOME;
  if (codexExplicit !== undefined && path.resolve(codexExplicit) !== path.join(home, '.codex')) {
    const sandbox = path.resolve(codexExplicit);
    return { claudeHome: path.join(sandbox, '.claude-source'), claudeJson: path.join(sandbox, '.claude-source.json') };
  }
  return { claudeHome: path.join(home, '.claude'), claudeJson: path.join(home, '.claude.json') };
}
