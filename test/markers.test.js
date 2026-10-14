import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectSection, removeSection, listSections } from '../src/core/markers.js';

const open = (id) => `<!-- gentle-lite:${id} -->`;
const close = (id) => `<!-- /gentle-lite:${id} -->`;
const block = (id, body) => `${open(id)}\n${body}\n${close(id)}`;

test('appends a section to empty text', () => {
  assert.equal(injectSection('', 'persona', 'hello'), `${block('persona', 'hello')}\n`);
});

test('appends after existing content, separated by a blank line', () => {
  const out = injectSection('# Mine\n\ntext\n', 'persona', 'hello');
  assert.equal(out, `# Mine\n\ntext\n\n${block('persona', 'hello')}\n`);
});

test('replaces the body when the section exists and keeps surroundings', () => {
  const base = `before\n\n${block('persona', 'old')}\n\nafter\n`;
  const out = injectSection(base, 'persona', 'new');
  assert.equal(out, `before\n\n${block('persona', 'new')}\n\nafter\n`);
});

test('is idempotent', () => {
  const once = injectSection('keep\n', 'a', 'body');
  assert.equal(injectSection(once, 'a', 'body'), once);
});

test('drops duplicate pairs of the same id after the first', () => {
  const base = `${block('a', 'one')}\n\nmid\n\n${block('a', 'two')}\n`;
  const out = injectSection(base, 'a', 'new');
  assert.equal(out, `${block('a', 'new')}\n\nmid\n`);
});

test('repairs an orphan open marker', () => {
  const base = `intro\n${open('a')}\nstray\n`;
  const out = injectSection(base, 'a', 'body');
  assert.ok(!out.includes('stray\n\n<!-- gentle-lite:a -->\nstray'));
  assert.equal(listSections(out).length, 1);
  assert.match(out, /intro/);
  assert.match(out, /stray/);
  assert.equal(out.split(open('a')).length - 1, 1);
});

test('repairs an orphan close marker', () => {
  const base = `intro\n${close('a')}\nafter\n`;
  const out = injectSection(base, 'a', 'body');
  assert.equal(out.split(close('a')).length - 1, 1);
  assert.match(out, /after/);
});

test('does not touch other ids or foreign markers', () => {
  const base = `<!-- gentle-ai:persona -->\nX\n<!-- /gentle-ai:persona -->\n\n${block('b', 'keep')}\n`;
  const out = injectSection(base, 'a', 'new');
  assert.ok(out.includes('<!-- gentle-ai:persona -->\nX\n<!-- /gentle-ai:persona -->'));
  assert.ok(out.includes(block('b', 'keep')));
  assert.ok(out.includes(block('a', 'new')));
});

test('supports nested sections of other ids inside a body', () => {
  const inner = block('remote', 'inner');
  const out = injectSection('', 'routing', `top\n${inner}`);
  assert.deepEqual(listSections(out).map((s) => s.id).sort(), ['remote', 'routing']);
  const updated = injectSection(out, 'routing', 'plain');
  assert.equal(listSections(updated).length, 1);
});

test('empty body removes the section', () => {
  const base = injectSection('keep\n', 'a', 'body');
  assert.equal(injectSection(base, 'a', ''), 'keep\n');
});

test('removeSection restores the original text and ignores missing ids', () => {
  const original = '# Mine\n\ntext\n';
  const withSection = injectSection(original, 'a', 'body');
  assert.equal(removeSection(withSection, 'a'), original);
  assert.equal(removeSection(original, 'zzz'), original);
});

test('removeSection removes a leading section cleanly', () => {
  const text = `${block('a', 'x')}\n\nrest\n`;
  assert.equal(removeSection(text, 'a'), 'rest\n');
});

test('listSections returns ids and bodies in file order', () => {
  const text = `${block('b', 'two')}\n\n${block('a', 'one')}\n`;
  assert.deepEqual(listSections(text), [
    { id: 'b', body: 'two' },
    { id: 'a', body: 'one' },
  ]);
});

test('ids with regex characters are handled literally', () => {
  const out = injectSection('', 'a.b+c', 'x');
  assert.equal(removeSection(out, 'a.b+c'), '');
});
