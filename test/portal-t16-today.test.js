// T16b: Today never shows a partial oldest day without saying so (the feed reads only the newest items; the server flags the cut).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, tree, view, ES } from './helpers/t15w3.js';

const day = (d) => ({ day: d, items: [{ kind: 'memory', id: d, title: `m ${d}`, ts: `${d}T10:00:00Z`, what: 'memory saved' }] });
const home = (cut) => ({ activity: ['2026-11-08', '2026-11-07'].map(day), activity_cut: cut, spending: { available: false }, impact: null, health: { installed: false } });
const notes = (env) => tree(view(env)).filter((e) => /\bday-cut\b/.test(e.className ?? ''));

test('a cut feed notes under its oldest day that earlier activity that day is not shown', async () => {
  const env = await boot('#/', { '/api/wiki/home': home(true) });
  assert.equal(notes(env).length, 1);
  assert.match(notes(env)[0].textContent, /Earlier activity on this day is not shown\./);
  const sections = tree(view(env)).filter((e) => e.tagName === 'section' && /\bday\b/.test(e.className));
  assert.equal(sections.at(-1).children.at(-1), notes(env)[0], 'the note closes the oldest day');
});
test('a feed that is not cut has no note, and the note is in Spanish too', async () => {
  assert.equal(notes(await boot('#/', { '/api/wiki/home': home(false) })).length, 0);
  const es = await boot('#/', { '/api/wiki/home': home(true) }, ES);
  assert.match(notes(es)[0].textContent, /Actividad anterior de este día no se muestra\./);
});
