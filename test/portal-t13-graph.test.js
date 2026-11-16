// T13 re-critique, graph: every node kind the graph can hold is a word in English and Spanish (no raw "concept" beside
// translated kinds), short enough for the Kind column; an unknown kind still shows as sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDicts } from './helpers/portalboot.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// graphify's file_type values: the semantic pass validates against FILE_TYPES; the AST pass also writes video nodes.
async function graphKinds() {
  const src = await readFile(path.join(ROOT, 'python', 'amauta', 'extras', 'graphify_semantic', 'semantic_plan.py'), 'utf8');
  const set = /^FILE_TYPES = \{([^}]*)\}/m.exec(src)[1];
  return [...new Set([...set.matchAll(/"(\w+)"/g)].map((m) => m[1]).concat('video'))];
}

test('every graph node kind has a label in en and es', async () => {
  const { en, es } = await readDicts();
  for (const k of await graphKinds()) {
    assert.ok(en[`graph.kind.${k}`], `en graph.kind.${k}`);
    assert.ok(es[`graph.kind.${k}`], `es graph.kind.${k}`);
  }
});

test('kind labels stay short enough not to wrap in the Kind column', async () => {
  const { en, es } = await readDicts();
  for (const d of [en, es]) for (const [k, v] of Object.entries(d)) if (k.startsWith('graph.kind.')) assert.ok(v.length <= 14, `${k}: ${v}`);
});
