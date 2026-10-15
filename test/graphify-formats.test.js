import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { graphifyStatus, GRAPHIFY_HINT } from '../src/graphify/probe.js';

// A fake graphify launcher whose shebang points at a fake "python" that reports each requested module as ok/missing.
async function sandbox({ missing = [], shebang = 'python' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-gfmt-'));
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'py.log');
  await mkdir(bin, { recursive: true });
  const py = path.join(root, 'python3');
  await writeFile(py, `#!/bin/sh\n[ "$1" = "-I" ] || exec /bin/sh "$@"\necho "$*" >> "${log}"\nshift; shift\nfor m in "$@"; do\n  case " ${missing.join(' ')} " in *" $m "*) echo "$m missing" ;; *) echo "$m ok" ;; esac\ndone\n`);
  await chmod(py, 0o755);
  const first = shebang === 'python' ? `#!${py}` : '#!/bin/sh';
  await writeFile(path.join(bin, 'graphify'), `${first}\ncase "$1" in --version) echo "graphify 9.9.9" ;; esac\n`);
  await chmod(path.join(bin, 'graphify'), 0o755);
  return { root, bin, log, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('install hint covers sql, anthropic, pdf, office and the R grammar pack in one message', () => {
  assert.match(GRAPHIFY_HINT, /pipx install "graphifyy\[sql,anthropic,pdf,office\]"/);
  assert.match(GRAPHIFY_HINT, /pipx inject graphifyy tree-sitter-language-pack/);
});

test('non-deep status does not run the interpreter and reports no formats', async () => {
  const t = await sandbox();
  const s = await graphifyStatus({ searchPath: t.bin });
  assert.equal(s.formats, null);
  await assert.rejects(readFile(t.log), /ENOENT/);
  assert.doesNotMatch(s.detail, /R:/);
  await t.cleanup();
});

test('deep status reports R, PDF, DOCX and XLSX availability from the launcher interpreter', async () => {
  const t = await sandbox();
  const s = await graphifyStatus({ searchPath: t.bin, deep: true });
  assert.deepEqual(s.formats, { r: true, pdf: true, docx: true, xlsx: true });
  assert.match(s.detail, /R: available/);
  assert.match(s.detail, /PDF: available/);
  assert.match(s.detail, /DOCX: available/);
  assert.match(s.detail, /XLSX: available/);
  assert.doesNotMatch(s.detail, /pipx inject/);
  const asked = (await readFile(t.log, 'utf8')).trim();
  for (const m of ['tree_sitter_language_pack', 'pypdf', 'docx', 'openpyxl']) assert.ok(asked.includes(m), m);
  await t.cleanup();
});

test('deep status names the exact pipx command for each missing format', async () => {
  const t = await sandbox({ missing: ['tree_sitter_language_pack', 'openpyxl'] });
  const s = await graphifyStatus({ searchPath: t.bin, deep: true });
  assert.deepEqual(s.formats, { r: false, pdf: true, docx: true, xlsx: false });
  assert.match(s.detail, /R: NOT available/);
  assert.match(s.detail, /XLSX: NOT available/);
  assert.match(s.detail, /pipx inject graphifyy tree-sitter-language-pack/);
  assert.match(s.detail, /pipx install --force "graphifyy\[sql,anthropic,pdf,office\]"/);
  await t.cleanup();
});

test('deep status says unknown when the launcher shebang is not a python path', async () => {
  const t = await sandbox({ shebang: 'sh' });
  const s = await graphifyStatus({ searchPath: t.bin, deep: true });
  assert.deepEqual(s.formats, { r: null, pdf: null, docx: null, xlsx: null });
  assert.match(s.detail, /R: unknown/);
  assert.match(s.detail, /XLSX: unknown/);
  await t.cleanup();
});
