import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_ASSIGNMENTS,
  renderAgent,
  engramToolPrefix,
  resolveAssignment,
} from '../src/install/templating.js';

test('default model assignments mirror upstream', () => {
  assert.equal(DEFAULT_MODEL_ASSIGNMENTS['sdd-propose'], 'opus');
  assert.equal(DEFAULT_MODEL_ASSIGNMENTS['sdd-archive'], 'haiku');
  assert.equal(DEFAULT_MODEL_ASSIGNMENTS['jd-judge-a'], 'sonnet');
  assert.equal(DEFAULT_MODEL_ASSIGNMENTS.default, 'sonnet');
});

test('resolveAssignment falls back to default then sonnet and supports {model,effort}', () => {
  assert.deepEqual(resolveAssignment({ default: 'opus' }, 'missing'), { model: 'opus', effort: undefined });
  assert.deepEqual(resolveAssignment({}, 'x'), { model: 'sonnet', effort: undefined });
  assert.deepEqual(resolveAssignment({ x: { model: 'opus', effort: 'high' } }, 'x'), { model: 'opus', effort: 'high' });
});

test('engramToolPrefix depends on the engram plugin', () => {
  assert.equal(engramToolPrefix({}), 'mcp__engram__');
  assert.equal(engramToolPrefix({ enabledPlugins: { 'engram@engram': false } }), 'mcp__engram__');
  assert.equal(engramToolPrefix({ enabledPlugins: { 'engram@engram': true } }), 'mcp__plugin_engram_engram__');
});

const AGENT = [
  '---',
  'name: demo',
  'model: {{CLAUDE_MODEL}}',
  '{{CLAUDE_EFFORT_FRONTMATTER}}',
  'tools: Read, mcp__plugin_engram_engram__mem_search',
  '---',
  '',
  'Body.',
  '',
].join('\n');

const footers = [
  { id: 'codegraph-guidance', body: 'CG' },
  { id: 'agent-language-contract', body: 'LANG' },
];

test('renderAgent resolves model, drops default effort line, rewrites engram prefix and adds footers', () => {
  const out = renderAgent(AGENT, {
    assignment: { model: 'opus' },
    engramPrefix: 'mcp__engram__',
    footers,
  });
  assert.match(out, /^model: opus$/m);
  assert.ok(!out.includes('{{'));
  assert.ok(!out.includes('effort'));
  assert.match(out, /^tools: Read, mcp__engram__mem_search, mcp__codegraph__codegraph_explore$/m);
  assert.match(out, /<!-- amauta:codegraph-guidance -->\nCG\n<!-- \/amauta:codegraph-guidance -->/);
  assert.match(out, /<!-- amauta:agent-language-contract -->/);
  assert.ok(out.indexOf('Body.') < out.indexOf('amauta:codegraph-guidance'));
});

test('renderAgent writes an effort line when configured and keeps the plugin prefix when asked', () => {
  const out = renderAgent(AGENT, {
    assignment: { model: 'sonnet', effort: 'high' },
    engramPrefix: 'mcp__plugin_engram_engram__',
    footers: [],
  });
  assert.match(out, /^effort: high$/m);
  assert.match(out, /mcp__plugin_engram_engram__mem_search/);
});

test('renderAgent leaves empty tools lists alone and is idempotent in its footers', () => {
  const empty = AGENT.replace(/^tools: .*$/m, 'tools: []');
  const out = renderAgent(empty, { assignment: { model: 'sonnet' }, engramPrefix: 'mcp__engram__', footers });
  assert.match(out, /^tools: \[\]$/m);
  assert.equal(out.split('amauta:codegraph-guidance -->').length - 1, 2);
});
