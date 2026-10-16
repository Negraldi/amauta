import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveTargets } from '../src/install/paths.js';

const HOME = '/fake/home';

test('defaults point at the home directory', () => {
  const t = resolveTargets({}, {}, HOME);
  assert.deepEqual(t, {
    claudeHome: '/fake/home/.claude',
    claudeJson: '/fake/home/.claude.json',
    stateDir: '/fake/home/.amauta',
  });
});

test('env variables override defaults and flags override env', () => {
  const env = {
    AMAUTA_CLAUDE_HOME: '/e/home',
    AMAUTA_CLAUDE_JSON: '/e/c.json',
    AMAUTA_STATE_DIR: '/e/state',
  };
  assert.deepEqual(resolveTargets({}, env, HOME), { claudeHome: '/e/home', claudeJson: '/e/c.json', stateDir: '/e/state' });
  assert.equal(resolveTargets({ claudeHome: '/f/home' }, env, HOME).claudeHome, '/f/home');
});

test('a custom claude home never leaks into the real home', () => {
  const t = resolveTargets({ claudeHome: '/sandbox/.claude' }, {}, HOME);
  assert.equal(t.claudeJson, path.join('/sandbox/.claude', '.claude.json'));
  assert.equal(t.stateDir, path.join('/sandbox/.claude', '.amauta'));
});

test('relative paths are resolved to absolute', () => {
  const t = resolveTargets({ claudeHome: 'rel/dir' }, {}, HOME);
  assert.ok(path.isAbsolute(t.claudeHome));
});
