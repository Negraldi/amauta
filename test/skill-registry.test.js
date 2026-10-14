import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, stat, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { refreshRegistry, parseFrontmatter, isProjectDir } from '../src/registry/skill-registry.js';

const exists = (p) => stat(p).then(() => true, () => false);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-reg-'));
  const t = { root, claudeHome: path.join(root, 'claude'), project: path.join(root, 'proj') };
  await mkdir(t.project);
  await writeFile(path.join(t.project, 'package.json'), '{}');
  t.skill = async (base, name, body) => {
    await mkdir(path.join(base, name), { recursive: true });
    await writeFile(path.join(base, name, 'SKILL.md'), body);
  };
  return t;
}

test('parseFrontmatter handles quotes and folded block scalars', () => {
  const fm = parseFrontmatter('---\nname: "x"\ndescription: >\n  Trigger: a.\n  More text.\nlicense: MIT\n---\nbody');
  assert.equal(fm.name, 'x');
  assert.equal(fm.description, 'Trigger: a. More text.');
  assert.equal(fm.license, 'MIT');
});

test('guard skips root, home and directories without a project marker', async () => {
  const t = await fixture();
  assert.equal(await isProjectDir('/'), false);
  assert.equal(await isProjectDir(t.project, t.project), false);
  const bare = path.join(t.root, 'bare');
  await mkdir(bare);
  assert.equal((await refreshRegistry({ cwd: bare, claudeHome: t.claudeHome })).status, 'skipped');
  assert.ok(!(await exists(path.join(bare, '.atl'))));
  assert.equal(await isProjectDir(t.project), true);
  await rm(t.root, { recursive: true });
});

test('writes the registry: project wins, _shared and skill-registry excluded, table format', async () => {
  const t = await fixture();
  await t.skill(path.join(t.claudeHome, 'skills'), 'foo', '---\nname: foo\ndescription: user foo | pipe\n---\n');
  await t.skill(path.join(t.claudeHome, 'skills'), 'bar', '---\nname: bar\ndescription: "Trigger: bar."\n---\n');
  await t.skill(path.join(t.claudeHome, 'skills'), '_shared', '---\nname: shared\n---\n');
  await t.skill(path.join(t.claudeHome, 'skills'), 'skill-registry', '---\nname: skill-registry\n---\n');
  await t.skill(path.join(t.project, '.claude', 'skills'), 'foo', '---\nname: foo\ndescription: project foo\n---\n');
  const r = await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome });
  assert.equal(r.status, 'refreshed');
  assert.equal(r.count, 2);
  const md = await readFile(path.join(t.project, '.atl', 'skill-registry.md'), 'utf8');
  assert.match(md, /^# Skill Registry — proj$/m);
  assert.match(md, /^\| Skill \| Trigger \/ description \| Scope \| Path \|$/m);
  assert.match(md, /^\| `foo` \| project foo \| project \| `.*proj\/\.claude\/skills\/foo\/SKILL\.md` \|$/m);
  assert.match(md, /^\| `bar` \| Trigger: bar\. \| user \|/m);
  assert.ok(!md.includes('_shared') && !md.includes('`skill-registry`'));
  assert.ok(md.indexOf('`bar`') < md.indexOf('`foo`'));
  await rm(t.root, { recursive: true });
});

test('cache hit does not rewrite; content change or --force regenerates', async () => {
  const t = await fixture();
  const skills = path.join(t.claudeHome, 'skills');
  await t.skill(skills, 'foo', '---\nname: foo\ndescription: one\n---\n');
  const out = path.join(t.project, '.atl', 'skill-registry.md');
  const cache = path.join(t.project, '.atl', '.skill-registry.cache.json');
  await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome });
  assert.match(JSON.parse(await readFile(cache, 'utf8')).fingerprint, /^[0-9a-f]{40}$/);
  const old = new Date(Date.now() - 86400000);
  await utimes(out, old, old);
  const mtimeBefore = (await stat(out)).mtimeMs;
  const hit = await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome });
  assert.equal(hit.status, 'cache-hit');
  assert.equal((await stat(out)).mtimeMs, mtimeBefore);
  await t.skill(skills, 'foo', '---\nname: foo\ndescription: two\n---\n');
  assert.equal((await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome })).status, 'refreshed');
  assert.match(await readFile(out, 'utf8'), /\| two \|/);
  assert.equal((await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome, force: true })).status, 'refreshed');
  await rm(t.root, { recursive: true });
});

test('adds .atl/ to .gitignore once unless disabled', async () => {
  const t = await fixture();
  await mkdir(path.join(t.project, '.git'));
  await writeFile(path.join(t.project, '.gitignore'), 'node_modules');
  await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome });
  await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome, force: true });
  const gi = await readFile(path.join(t.project, '.gitignore'), 'utf8');
  assert.equal(gi, 'node_modules\n\n# Local AI runtime state\n.atl/\n');

  const other = path.join(t.root, 'other');
  await mkdir(other);
  await writeFile(path.join(other, 'package.json'), '{}');
  await refreshRegistry({ cwd: other, claudeHome: t.claudeHome, gitignore: false });
  assert.ok(!(await exists(path.join(other, '.gitignore'))));
  await rm(t.root, { recursive: true });
});

test('optIn writes only when .atl exists or .gitignore lists it; never creates files otherwise', async () => {
  const t = await fixture();
  const none = await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome, gitignore: false, optIn: true });
  assert.equal(none.status, 'skipped');
  assert.ok(!(await exists(path.join(t.project, '.atl'))));
  await writeFile(path.join(t.project, '.gitignore'), 'node_modules\n.atl/\n');
  assert.equal((await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome, gitignore: false, optIn: true })).status, 'refreshed');
  const t2 = await fixture();
  await mkdir(path.join(t2.project, '.atl'));
  assert.equal((await refreshRegistry({ cwd: t2.project, claudeHome: t2.claudeHome, gitignore: false, optIn: true })).status, 'refreshed');
  await rm(t.root, { recursive: true });
  await rm(t2.root, { recursive: true });
});

test('a symlinked .atl is never written through', async () => {
  const t = await fixture();
  const elsewhere = path.join(t.root, 'elsewhere');
  await mkdir(elsewhere);
  await symlink(elsewhere, path.join(t.project, '.atl'));
  const r = await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome, gitignore: false });
  assert.equal(r.status, 'skipped');
  assert.deepEqual(await readdir(elsewhere), []);
  await rm(t.root, { recursive: true });
});

test('paths under the home directory are rendered as ~/...', async () => {
  const t = await fixture();
  await t.skill(path.join(t.claudeHome, 'skills'), 'foo', '---\nname: foo\ndescription: d\n---\n');
  await refreshRegistry({ cwd: t.project, claudeHome: t.claudeHome, gitignore: false, home: t.root });
  const md = await readFile(path.join(t.project, '.atl', 'skill-registry.md'), 'utf8');
  assert.ok(!md.includes(t.root), 'absolute home path leaked');
  assert.match(md, /`~\/claude\/skills\/foo\/SKILL\.md`/);
  assert.match(md, /^- ~\/claude\/skills$/m);
  await rm(t.root, { recursive: true });
});
