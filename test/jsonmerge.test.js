import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepMerge, mergeHooks, removeHooksByCommandPrefix } from '../src/core/jsonmerge.js';

test('objects merge deeply, scalars and arrays take the overlay', () => {
  const base = { a: { b: 1, c: [1, 2] }, keep: true };
  const overlay = { a: { b: 2, c: [3], d: 'x' } };
  assert.deepEqual(deepMerge(base, overlay), { a: { b: 2, c: [3], d: 'x' }, keep: true });
});

test('does not mutate inputs', () => {
  const base = { a: { b: 1 } };
  const overlay = { a: { c: 2 } };
  const out = deepMerge(base, overlay);
  out.a.b = 99;
  assert.deepEqual(base, { a: { b: 1 } });
  assert.deepEqual(overlay, { a: { c: 2 } });
});

test('__replace__ replaces wholesale and is unwrapped', () => {
  const base = { s: { command: 'old', env: { A: '1' } } };
  const overlay = { s: { __replace__: { command: 'new' } } };
  assert.deepEqual(deepMerge(base, overlay), { s: { command: 'new' } });
});

test('__replace__ works when the base key is absent and for scalars', () => {
  assert.deepEqual(deepMerge({}, { x: { __replace__: [1] } }), { x: [1] });
  assert.deepEqual(deepMerge({ x: { a: 1 } }, { x: { __replace__: 5 } }), { x: 5 });
});

test('an object with __replace__ plus other keys is treated as a normal object', () => {
  const out = deepMerge({}, { x: { __replace__: 1, y: 2 } });
  assert.deepEqual(out, { x: { __replace__: 1, y: 2 } });
});

test('overlay object over base scalar replaces it', () => {
  assert.deepEqual(deepMerge({ a: 1 }, { a: { b: 2 } }), { a: { b: 2 } });
});

const entry = (command, matcher = '') => ({ matcher, hooks: [{ type: 'command', command, timeout: 30 }] });

test('mergeHooks appends entries and keeps user hooks', () => {
  const settings = { hooks: { Stop: [entry('user-hook')] }, other: 1 };
  const out = mergeHooks(settings, { Stop: [entry('gentle-lite hook review-stop')], SessionStart: [entry('gentle-lite hook review-stop', 'startup')] });
  assert.equal(out.hooks.Stop.length, 2);
  assert.equal(out.hooks.Stop[0].hooks[0].command, 'user-hook');
  assert.equal(out.hooks.SessionStart.length, 1);
  assert.equal(out.other, 1);
});

test('mergeHooks is idempotent on identical commands', () => {
  const add = { Stop: [entry('gentle-lite hook review-stop')] };
  const once = mergeHooks({}, add);
  assert.deepEqual(mergeHooks(once, add), once);
});

test('mergeHooks does not mutate its input', () => {
  const settings = { hooks: { Stop: [entry('a')] } };
  mergeHooks(settings, { Stop: [entry('b')] });
  assert.equal(settings.hooks.Stop.length, 1);
});

test('mergeHooks tolerates a non-array event value by refusing to overwrite', () => {
  assert.throws(() => mergeHooks({ hooks: { Stop: 'weird' } }, { Stop: [entry('a')] }), /unsupported hooks shape/);
});

test('removeHooksByCommandPrefix removes only matching commands', () => {
  const settings = {
    hooks: {
      Stop: [entry('user-hook'), entry('gentle-lite hook review-stop')],
      UserPromptSubmit: [entry('gentle-lite hook skill-registry')],
    },
  };
  const out = removeHooksByCommandPrefix(settings, 'gentle-lite ');
  assert.deepEqual(out.hooks, { Stop: [entry('user-hook')] });
});

test('removeHooksByCommandPrefix splits mixed entries and drops empty hooks key', () => {
  const mixed = { matcher: '', hooks: [{ type: 'command', command: 'keep' }, { type: 'command', command: 'gentle-lite x' }] };
  const out = removeHooksByCommandPrefix({ hooks: { Stop: [mixed] } }, 'gentle-lite ');
  assert.deepEqual(out.hooks.Stop[0].hooks, [{ type: 'command', command: 'keep' }]);
  const only = removeHooksByCommandPrefix({ a: 1, hooks: { Stop: [entry('gentle-lite x')] } }, 'gentle-lite ');
  assert.deepEqual(only, { a: 1 });
});
