import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { assess } from '../src/review/assess.js';
import { makeRepo } from './helpers/repo.js';

const committed = (r) => assess({ cwd: r.dir, baseRef: 'HEAD~1', committedOnly: true });
const codes = (res) => res.reasons.map((x) => x.code);

test('docs and images only are passive and not due', async () => {
  const r = await makeRepo();
  await r.write('docs/guide.md', '# g\n');
  await r.write('logo.png', 'png');
  r.commit();
  const res = await committed(r);
  assert.equal(res.risk, 'passive');
  assert.equal(res.review_due, false);
  assert.equal(res.review_due_reason, 'passive');
  assert.deepEqual(res.changed_paths.sort(), ['docs/guide.md', 'logo.png']);
  await rm(r.dir, { recursive: true });
});

test('path tokens auth/security/webhook/payments are high risk', async () => {
  const r = await makeRepo();
  await r.write('src/auth/login.js', 'export const a = 1;\n');
  r.commit();
  const res = await committed(r);
  assert.equal(res.risk, 'high');
  assert.equal(res.review_due, true);
  assert.equal(res.review_due_reason, 'high_risk');
  assert.deepEqual(res.reasons[0], { code: 'sensitive_path', path: 'src/auth/login.js', detail: 'auth' });
  assert.equal(res.changed_lines, 1);
  await rm(r.dir, { recursive: true });
});

test('shell sources, CI workflows and executable-bit changes are high', async () => {
  const r = await makeRepo({ 'tool.js': 'x\n' });
  await r.write('run.sh', 'echo hi\n');
  await r.write('.github/workflows/ci.yml', 'name: ci\n');
  await r.write('tool.js', 'x\n', 0o755);
  r.commit();
  const res = await committed(r);
  assert.equal(res.risk, 'high');
  assert.ok(codes(res).includes('shell_source'));
  assert.ok(codes(res).includes('ci_workflow'));
  assert.ok(res.reasons.some((x) => x.code === 'executable_mode' && x.path === 'tool.js'));
  await rm(r.dir, { recursive: true });
});

test('added process-boundary sinks are high; removed ones and docs are not', async () => {
  const r = await makeRepo({ 'a.js': "import { exec } from 'x';\nexec(1);\n" });
  await r.write('b.js', "import { spawn } from 'node:child_process';\n");
  await r.write('notes.md', 'call eval( here\n');
  r.commit();
  let res = await committed(r);
  assert.equal(res.risk, 'high');
  assert.deepEqual(res.reasons.filter((x) => x.code === 'process_boundary').map((x) => x.path), ['b.js']);
  await r.write('a.js', 'noop();\n');
  r.commit();
  res = await committed(r);
  assert.equal(res.risk, 'medium');
  await rm(r.dir, { recursive: true });
});

test('config files are medium configuration_change; other code is medium executable_change', async () => {
  const r = await makeRepo();
  await r.write('package.json', '{}\n');
  await r.write('Dockerfile', 'FROM x\n');
  r.commit();
  let res = await committed(r);
  assert.equal(res.risk, 'medium');
  assert.deepEqual([...new Set(codes(res))], ['configuration_change']);
  assert.equal(res.review_due, false);
  assert.equal(res.review_due_reason, 'under_budget');
  await r.write('lib/util.js', 'export const x = 1;\n');
  r.commit();
  res = await committed(r);
  assert.deepEqual(codes(res), ['executable_change']);
  await rm(r.dir, { recursive: true });
});

test('a medium change of 400+ lines reaches the slice budget', async () => {
  const r = await makeRepo();
  await r.write('lib/big.js', 'x\n'.repeat(400));
  r.commit();
  const res = await committed(r);
  assert.equal(res.risk, 'medium');
  assert.equal(res.changed_lines, 400);
  assert.equal(res.review_due, true);
  assert.equal(res.review_due_reason, 'slice_budget_reached');
  await rm(r.dir, { recursive: true });
});

test('working tree candidate: tracked changes count, untracked files do not', async () => {
  const r = await makeRepo();
  await r.write('untracked/auth.js', 'x\n');
  let res = await assess({ cwd: r.dir });
  assert.equal(res.risk, 'passive');
  assert.deepEqual(res.changed_paths, []);
  await r.write('README.md', '# changed\n');
  res = await assess({ cwd: r.dir });
  assert.deepEqual(res.changed_paths, ['README.md']);
  await rm(r.dir, { recursive: true });
});
