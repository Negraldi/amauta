// The review pack and the number-fidelity check (plan D11, ADR 0008). `amauta review numbers` matches every number in
// a deliverable against the approved results at the precision shown; `amauta review pack` assembles, mechanically,
// what a lens reads: criteria, contracts, results, deliverables, the changed paths, and the numbers check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractNumbers, checkNumbers } from '../src/review/numbers.js';
import { buildPack } from '../src/review/pack.js';
import { main } from '../src/cli.js';
import { tempDir } from './helpers/tmp.js';

const sink = () => { let s = ''; return { write: (x) => { s += x; }, get text() { return s; } }; };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const write = async (dir, name, text) => { const f = path.join(dir, name); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, text); return f; };

async function project() {
  const dir = await tempDir('pack-');
  for (const args of [['init', '-q', '.'], ['config', 'user.email', 'a@b.c'], ['config', 'user.name', 'T'], ['config', 'commit.gpgsign', 'false']]) git(dir, ...args);
  await write(dir, 'odd/tasks/sales.md', '# Sales\n\n## Acceptance criteria\n\n- AC1 totals reconcile with the source\n- AC2 the deck answers the renewal question\n');
  await write(dir, 'README.md', '# p\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  await write(dir, 'odd/contracts/sales/results.csv', 'region,orders,share\nNorth,1234,0.4123\nSouth,1759,0.5877\n');
  await write(dir, 'odd/contracts/sales/summary.md', 'Total orders: 2993 in 2025-Q3.\n');
  await write(dir, 'odd/deliverables/sales/brief.md',
    '# Orders in 2025\n\n1. North placed 1,234 orders (41.2% of the total).\n2. South placed 1,759 orders.\n3. Total: 2,993.\n4. Growth was 7.5% versus last year.\n\nAs of 2025-09-30.\n');
  await write(dir, 'src/app.py', 'x = 1\n');
  return dir;
}

test('numbers in prose are found with their precision; years, dates and list markers are not numbers', () => {
  const found = extractNumbers('1. North placed 1,234 orders (41.2%) in 2025.\nAs of 2025-09-30, v1.2 shipped.\n');
  assert.deepEqual(found.map((n) => [n.text, n.value, n.decimals, n.percent, n.line]), [['1,234', 1234, 0, false, 1], ['41.2%', 41.2, 1, true, 1]]);
});

test('each deliverable number must exist in the approved results at the precision shown (a share may be a fraction)', async () => {
  const dir = await project();
  const r = await checkNumbers(dir, 'sales');
  assert.deepEqual(r.unmatched.map((u) => [u.file, u.line, u.text]), [['odd/deliverables/sales/brief.md', 6, '7.5%']]);
  assert.equal(r.checked, 5);
});

test('the pack lists criteria, contracts, deliverables, changed paths outside the deliverables folder and the numbers check', async () => {
  const dir = await project();
  const { file, outside, unmatched } = await buildPack({ cwd: dir, feature: 'sales', kind: 'communication' });
  assert.equal(path.relative(dir, file), path.join('odd', 'reviews', 'sales', 'communication-1', 'pack.md'));
  assert.deepEqual(outside, ['src/app.py']);
  assert.equal(unmatched.length, 1);
  const text = await readFile(file, 'utf8');
  for (const needle of ['AC1 totals reconcile', 'odd/contracts/sales/results.csv', 'odd/deliverables/sales/brief.md', 'src/app.py', '7.5%', 'haravec']) assert.ok(text.includes(needle), needle);
  const second = await buildPack({ cwd: dir, feature: 'sales', kind: 'communication' });
  assert.match(second.file, /communication-2/, 'a fresh round gets its own folder');
  const analytical = await buildPack({ cwd: dir, feature: 'sales', kind: 'analytical' });
  assert.match(await readFile(analytical.file, 'utf8'), /taripaq/);
});

test('amauta review numbers exits 1 on unmatched numbers; review pack prints the pack path', async () => {
  const dir = await project();
  const io = { stdout: sink(), stderr: sink() };
  assert.equal(await main(['review', 'numbers', '--feature', 'sales', '--cwd', dir], io), 1);
  assert.match(io.stdout.text, /brief\.md:6: 7\.5% not in the approved results/);
  const p = { stdout: sink(), stderr: sink() };
  assert.equal(await main(['review', 'pack', '--feature', 'sales', '--kind', 'analytical', '--cwd', dir], p), 0);
  assert.match(p.stdout.text, /odd\/reviews\/sales\/analytical-1\/pack\.md/);
  const bad = { stdout: sink(), stderr: sink() };
  assert.notEqual(await main(['review', 'pack', '--feature', '../x', '--cwd', dir], bad), 0);
});
