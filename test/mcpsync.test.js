import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf, planMcpSync } from '../src/install/mcpsync.js';
import { readMcpServer, setMcpServer } from '../src/core/toml.js';

const A = { command: 'a', args: ['--x'] };
const A2 = { command: 'a', args: ['--y'] };
const claudeJson = (servers, extra = {}) => `${JSON.stringify({ numStartups: 1, ...extra, mcpServers: servers })}\n`;
const withStdio = (v) => ({ type: 'stdio', ...v });
const tomlOf = (servers) => Object.entries(servers).reduce((t, [n, v]) => setMcpServer(t, n, v), '');
const run = (claude, codex, base = {}, managed = new Set()) => planMcpSync({ claudeText: claudeJson(claude), tomlText: tomlOf(codex), base, managed });
const claudeOut = (r) => JSON.parse(r.claudeText).mcpServers ?? {};

test('added in Claude -> added to Codex; added in Codex -> added to Claude (with type stdio); base records hashes only', () => {
  let r = run({ foo: withStdio(A) }, {});
  assert.deepEqual(r.report.toCodex, ['foo']);
  assert.deepEqual(readMcpServer(r.toml, 'foo').value, A);
  assert.deepEqual(r.base, { foo: hashOf(A) });
  assert.ok(!JSON.stringify(r.base).includes('--x'));
  r = run({}, { bar: A });
  assert.deepEqual(r.report.toClaude, ['bar']);
  assert.deepEqual(claudeOut(r).bar, { type: 'stdio', ...A });
  assert.equal(JSON.parse(r.claudeText).numStartups, 1, 'other Claude keys survive');
});

test('changed on one side only -> copied to the other, from each side', () => {
  const base = { foo: hashOf(A) };
  let r = run({ foo: withStdio(A2) }, { foo: A }, base);
  assert.deepEqual(readMcpServer(r.toml, 'foo').value, A2);
  assert.deepEqual(r.base, { foo: hashOf(A2) });
  r = run({ foo: withStdio(A) }, { foo: A2 }, base);
  assert.deepEqual(claudeOut(r).foo, { type: 'stdio', ...A2 });
  assert.deepEqual(r.base, { foo: hashOf(A2) });
});

test('removed on one side and unchanged on the other -> removed from the other, from each side', () => {
  const base = { foo: hashOf(A) };
  let r = run({}, { foo: A }, base);
  assert.deepEqual(r.report.removedFromCodex, ['foo']);
  assert.equal(readMcpServer(r.toml, 'foo').found, false);
  assert.deepEqual(r.base, {});
  r = run({ foo: withStdio(A) }, {}, base);
  assert.deepEqual(r.report.removedFromClaude, ['foo']);
  assert.ok(!('foo' in claudeOut(r)));
  assert.deepEqual(r.base, {});
});

test('changed differently on both sides, or changed on one and removed on the other -> conflict, nothing overwritten', () => {
  const base = { foo: hashOf(A) };
  let r = run({ foo: withStdio({ command: 'c1' }) }, { foo: { command: 'c2' } }, base);
  assert.deepEqual(r.report.conflicts, ['foo']);
  assert.equal(r.claudeText, null);
  assert.equal(readMcpServer(r.toml, 'foo').value.command, 'c2');
  assert.deepEqual(r.base, base, 'the base is kept so the conflict stays visible');
  r = run({ foo: withStdio(A2) }, {}, base);
  assert.deepEqual(r.report.conflicts, ['foo']);
  r = run({ foo: withStdio(A) }, { foo: A2 }, {}); // never synced and different
  assert.deepEqual(r.report.conflicts, ['foo']);
});

test('only command/args/env are compared; extra keys stay on their side and survive an update', () => {
  const base = { foo: hashOf(A) };
  const r = run({ foo: { type: 'stdio', ...A2, alwaysLoad: true } }, { foo: { ...A, startup_timeout_sec: 30 } }, base);
  assert.deepEqual(readMcpServer(r.toml, 'foo').value, { ...A2, startup_timeout_sec: 30 });
  const same = run({ foo: { ...withStdio(A), alwaysLoad: true } }, { foo: { ...A, startup_timeout_sec: 30 } }, base);
  assert.equal(same.claudeText, null);
  assert.equal(same.toml, tomlOf({ foo: { ...A, startup_timeout_sec: 30 } }));
  const back = run({ foo: { ...withStdio(A), alwaysLoad: true } }, { foo: { ...A2, startup_timeout_sec: 30 } }, base);
  assert.deepEqual(claudeOut(back).foo, { type: 'stdio', ...A2, alwaysLoad: true });
});

test('managed names, the memory server and non-stdio servers are not synced; unsupported ones are named', () => {
  const mem = { command: 'python3', args: ['-P', '-m', 'amauta.memory', 'serve'] };
  const r = run({ engram: withStdio(mem), alias: withStdio(mem), remote: { type: 'http', url: 'https://x.invalid' }, rea: withStdio(A) }, {}, {}, new Set(['engram', 'rea']));
  assert.deepEqual(r.report.toCodex, []);
  assert.deepEqual(r.report.unsupported.map((u) => u.name), ['remote']);
  assert.equal(r.toml, '');
});

test('a corrupt .claude.json stops the sync without touching Codex', () => {
  const r = planMcpSync({ claudeText: '{nope', tomlText: tomlOf({ a: A }), base: {}, managed: new Set() });
  assert.equal(r.report.unreadable, '.claude.json');
  assert.equal(r.claudeText, null);
});
