import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveCodexTargets } from '../src/install/paths.js';

const HOME = '/fake/home';

test('codex defaults point at ~/.codex and ~/.agents/skills', () => {
  assert.deepEqual(resolveCodexTargets({}, {}, HOME), {
    codexHome: '/fake/home/.codex',
    codexSkillsDir: '/fake/home/.agents/skills',
    stateDir: '/fake/home/.amauta',
  });
});

test('flag beats AMAUTA_CODEX_HOME beats CODEX_HOME; skills dir has its own flag and variable', () => {
  const env = { AMAUTA_CODEX_HOME: '/a/codex', CODEX_HOME: '/b/codex', AMAUTA_CODEX_SKILLS_DIR: '/a/skills' };
  const t = resolveCodexTargets({}, env, HOME);
  assert.equal(t.codexHome, '/a/codex');
  assert.equal(t.codexSkillsDir, '/a/skills');
  assert.equal(resolveCodexTargets({ codexHome: '/f/codex', codexSkillsDir: '/f/skills' }, env, HOME).codexHome, '/f/codex');
  assert.equal(resolveCodexTargets({ codexHome: '/f/codex', codexSkillsDir: '/f/skills' }, env, HOME).codexSkillsDir, '/f/skills');
  assert.equal(resolveCodexTargets({}, { CODEX_HOME: '/b/codex' }, HOME).codexHome, '/b/codex');
  assert.equal(resolveCodexTargets({}, { CODEX_HOME: '/b/codex' }, HOME).codexSkillsDir, '/fake/home/.agents/skills');
});

test('a custom codex home keeps the skills dir inside it', () => {
  const t = resolveCodexTargets({ codexHome: '/sandbox/codex' }, {}, HOME);
  assert.equal(t.codexSkillsDir, path.join('/sandbox/codex', '.agents', 'skills'));
});

test('a custom claude home sandboxes codex too and ignores the ambient CODEX_HOME', () => {
  const t = resolveCodexTargets({ claudeHome: '/sandbox/.claude' }, { CODEX_HOME: '/real/codex' }, HOME);
  assert.equal(t.codexHome, path.join('/sandbox/.claude', '.codex'));
  assert.equal(t.codexSkillsDir, path.join('/sandbox/.claude', '.codex', '.agents', 'skills'));
  assert.equal(t.stateDir, path.join('/sandbox/.claude', '.amauta'));
});
