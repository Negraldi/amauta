import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'amauta.js');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });

test('package.json declares the bin, engines and scripts', () => {
  assert.equal(pkg.name, 'amauta');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.bin['amauta'], 'bin/amauta.js');
  assert.equal(pkg.engines.node, '>=22');
  assert.match(pkg.scripts.test, /node --test/);
  assert.match(pkg.scripts.test, /unittest/);
});

test('--help prints usage and the command list, exit 0', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: amauta/);
  assert.match(r.stdout, /Commands:/);
  assert.match(r.stdout, /version/);
});

test('no arguments behaves like --help', () => {
  const r = run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: amauta/);
});

test('version prints the package version', () => {
  const r = run('version');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('unknown command exits 1 with a message on stderr', () => {
  const r = run('definitely-not-a-command');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command: definitely-not-a-command/);
  assert.equal(r.stdout, '');
});
