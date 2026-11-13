// T14 cross-page agreement, section names: a sentence that sends the reader to another page names it the way the sidebar
// and its tabs do (Usage > Sessions, Settings > Projects and siblings), in English and Spanish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readDicts, STATIC } from './helpers/portalboot.js';

const { en, es, srv } = await readDicts();
const py = await readFile(path.join(STATIC, '..', 'graphsync.py'), 'utf8');

test('the project Sessions tab points to Usage > Sessions in both languages', () => {
  assert.match(en['project.sessionsScope'], /Usage > Sessions/);
  assert.match(es['project.sessionsScope'], /Uso > Sesiones/);
});

test('no text names a section the sidebar does not have', () => {
  const all = [...Object.values(en), ...Object.values(es), ...Object.keys(srv), ...Object.values(srv), py].join('\n');
  assert.doesNotMatch(all, /Activity > |Actividad > /);
  assert.doesNotMatch(all, /Settings > Projects(?! and siblings)|Configuración > Proyectos(?! y hermanos)/);
});
