// scripts/migrate.sh and scripts/rollback.sh run only against a fake HOME with stub `gentle-ai` and `claude`
// executables that record their argv. `--assume-yes` is test-only (skips the y/N prompts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, chmod, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATE = path.join(repoRoot, 'scripts', 'migrate.sh');
const ROLLBACK = path.join(repoRoot, 'scripts', 'rollback.sh');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const GENTLE_AI_STUB = `#!/usr/bin/env bash
echo "gentle-ai $*" >> "$STUB_LOG"
if [ "$1" = "uninstall" ]; then
  if [ -n "\${STUB_UNINSTALL_FAIL:-}" ]; then echo "Error: flag provided but not defined: -agent" >&2; exit 1; fi
  python3 - "$HOME/.claude" <<'PY'
import json, re, sys
home = sys.argv[1]
md = open(home + "/CLAUDE.md").read()
md = re.sub(r"<!-- gentle-ai:(\\S+) -->.*?<!-- /gentle-ai:\\1 -->\\n?", "", md, flags=re.S)
open(home + "/CLAUDE.md", "w").write(md)
s = json.load(open(home + "/settings.json"))
for ev, entries in list(s.get("hooks", {}).items()):
    for e in entries:
        e["hooks"] = [h for h in e["hooks"] if not h["command"].startswith("gentle-ai ")]
    s["hooks"][ev] = [e for e in entries if e["hooks"]]
json.dump(s, open(home + "/settings.json", "w"), indent=2)
PY
fi
exit 0
`;
const CLAUDE_STUB = `#!/usr/bin/env bash
echo "claude $*" >> "$STUB_LOG"
exit 0
`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-migrate-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'stub.log');
  const claude = path.join(home, '.claude');
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(claude, 'projects', 'proj'), { recursive: true });
  await mkdir(path.join(claude, 'agents'), { recursive: true });
  await mkdir(path.join(claude, 'skills', 'mine'), { recursive: true });
  await mkdir(path.join(home, '.gentle-ai', 'backups'), { recursive: true });
  await mkdir(path.join(home, '.engram'), { recursive: true });
  await writeFile(path.join(bin, 'gentle-ai'), GENTLE_AI_STUB);
  await writeFile(path.join(bin, 'claude'), CLAUDE_STUB);
  await chmod(path.join(bin, 'gentle-ai'), 0o755);
  await chmod(path.join(bin, 'claude'), 0o755);
  const sections = ['orchestrator', 'persona', 'skills', 'engram'].map((id) => `<!-- gentle-ai:${id} -->\ntext of ${id}\n<!-- /gentle-ai:${id} -->\n`).join('\n');
  await writeFile(path.join(claude, 'CLAUDE.md'), `# My rules\n\nmine\n\n${sections}`);
  await writeFile(path.join(claude, 'settings.json'), JSON.stringify({
    model: 'opus',
    permissions: { defaultMode: 'acceptEdits' },
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'gentle-ai skill-registry refresh' }, { type: 'command', command: 'echo user-hook' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'gentle-ai review stop-hook' }] }],
    },
  }, null, 2));
  await writeFile(path.join(claude, 'settings.local.json'), '{"permissions":{"allow":["Bash(ls:*)"]},"note":"keep me  exactly"}\n');
  await writeFile(path.join(claude, 'agents', 'gentle-old.md'), 'old agent\n');
  await writeFile(path.join(claude, 'skills', 'mine', 'SKILL.md'), 'my skill\n');
  await writeFile(path.join(claude, 'projects', 'proj', 'a.jsonl'), '{"a":1}\n');
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({
    numStartups: 7,
    theme: 'dark',
    mcpServers: { engram: { command: 'engram', args: ['mcp'] }, codegraph: { command: 'codegraph' }, rea: { command: 'rea' }, context7: { command: 'ctx7' } },
  }, null, 2));
  await writeFile(path.join(home, '.gentle-ai', 'backups', 'x.txt'), 'backup\n');
  const db = path.join(home, '.engram', 'engram.db');
  const py = [
    'import sqlite3,sys',
    'c=sqlite3.connect(sys.argv[1])',
    'c.execute("create table sessions(id text primary key, project text, directory text, started_at text, ended_at text, summary text)")',
    'c.execute("create table observations(id integer primary key, sync_id text, session_id text, project text, scope text, type text, title text, content text, topic_key text, created_at text, updated_at text, revision_count integer, deleted_at text)")',
    'c.execute("create table user_prompts(id integer primary key, sync_id text, session_id text, project text, content text, created_at text)")',
    'c.execute("insert into sessions(id,project,started_at) values(\'s1\',\'p\',\'2026-01-01\')")',
    'c.executemany("insert into observations(id,session_id,project,scope,type,title,content,created_at,updated_at,revision_count) values(?,?,?,?,?,?,?,?,?,?)",[(i,"s1","p","project","note","title %d"%i,"zebra content %d"%i,"2026-01-01","2026-01-01",1) for i in (1,2,3)])',
    'c.execute("insert into user_prompts(id,session_id,project,content,created_at) values(1,\'s1\',\'p\',\'hi\',\'2026-01-01\')")',
    'c.commit()',
  ].join('\n');
  const r = spawnSync('python3', ['-P', '-c', py, db], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    STUB_LOG: log,
    LANG: 'C.UTF-8',
  };
  return { root, home, claude, bin, log, env, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const run = (script, args, f, extraEnv = {}) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...f.env, ...extraEnv }, input: '', timeout: 180000 });

/** path -> sha256 for every regular file under dir (relative paths), plus directory entries. */
async function tree(dir, base = dir, out = {}) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p);
    if (e.isDirectory()) { out[`${rel}/`] = 'dir'; await tree(p, base, out); } else if (e.isFile()) out[rel] = sha(await readFile(p));
  }
  return out;
}
const read = (...p) => readFile(path.join(...p), 'utf8');

test('migrate.sh without --execute is a dry run: prints the actions and changes nothing', async () => {
  const f = await fixture();
  try {
    const before = await tree(f.home);
    const r = run(MIGRATE, [], f);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const phase of ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6']) assert.match(r.stdout, new RegExp(phase));
    assert.match(r.stdout, /dry run/i);
    assert.match(r.stdout, /gentle-ai uninstall --agent claude-code/);
    assert.doesNotMatch(r.stdout, /--yes/);
    assert.deepEqual(await tree(f.home), before, 'dry run must not touch the fake HOME');
    const stubLog = await readFile(f.log, 'utf8').catch(() => '');
    assert.doesNotMatch(stubLog, /uninstall|telemetry disable|plugin disable/);
  } finally { await f.cleanup(); }
});

test('migrate.sh --execute migrates, keeps settings.local.json, then rollback.sh restores the config', async () => {
  const f = await fixture();
  try {
    const pre = {
      md: await read(f.claude, 'CLAUDE.md'),
      settings: await read(f.claude, 'settings.json'),
      local: await readFile(path.join(f.claude, 'settings.local.json')),
      json: JSON.parse(await read(f.home, '.claude.json')),
      agent: await read(f.claude, 'agents', 'gentle-old.md'),
    };
    const r = run(MIGRATE, ['--execute', '--assume-yes'], f);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const stubLog = await read(f.log);
    assert.match(stubLog, /^gentle-ai telemetry disable$/m);
    assert.match(stubLog, /^gentle-ai uninstall --agent claude-code$/m, 'uninstall must run without --yes');
    assert.match(stubLog, /^claude plugin disable engram@engram --scope user$/m);

    const md = await read(f.claude, 'CLAUDE.md');
    assert.doesNotMatch(md, /gentle-ai:/);
    assert.match(md, /gentle-lite:/);
    assert.match(md, /# My rules/);
    assert.doesNotMatch(await read(f.claude, 'settings.json'), /gentle-ai /);
    assert.deepEqual(await readFile(path.join(f.claude, 'settings.local.json')), pre.local);
    assert.ok((await stat(path.join(f.home, '.gentle-lite', 'memory.db'))).size > 0);
    assert.match(r.stdout, /observations/);
    assert.match(r.stdout, /Claude Code/);

    const runs = await readdir(path.join(f.home, 'gentle-lite-migration'));
    assert.equal(runs.length, 1);
    const backupDir = path.join(f.home, 'gentle-lite-migration', runs[0]);
    assert.ok((await stat(path.join(backupDir, 'backup.tar.gz'))).size > 0);
    assert.ok((await stat(path.join(backupDir, 'migrate.log'))).size > 0);
    assert.ok(!(r.stdout + (await read(backupDir, 'migrate.log'))).includes('numStartups'), 'never print config contents');

    // a conversation written after the backup must survive the rollback
    await writeFile(path.join(f.claude, 'projects', 'proj', 'later.jsonl'), '{"later":1}\n');
    await writeFile(path.join(f.home, '.claude.json'), JSON.stringify({ ...JSON.parse(await read(f.home, '.claude.json')), numStartups: 99 }, null, 2));

    // idempotent re-run: nothing breaks, the original backup is kept
    const again = run(MIGRATE, ['--execute', '--assume-yes'], f);
    assert.equal(again.status, 0, again.stdout + again.stderr);

    const rb = run(ROLLBACK, [backupDir, '--assume-yes'], f);
    assert.equal(rb.status, 0, rb.stdout + rb.stderr);
    assert.equal(await read(f.claude, 'CLAUDE.md'), pre.md);
    assert.equal(await read(f.claude, 'settings.json'), pre.settings);
    assert.equal(await read(f.claude, 'agents', 'gentle-old.md'), pre.agent);
    assert.deepEqual(await readFile(path.join(f.claude, 'settings.local.json')), pre.local);
    const json = JSON.parse(await read(f.home, '.claude.json'));
    assert.deepEqual(json.mcpServers, pre.json.mcpServers);
    assert.equal(json.numStartups, 99, 'only mcpServers is restored in ~/.claude.json');
    assert.equal(await read(f.claude, 'projects', 'proj', 'later.jsonl'), '{"later":1}\n');
    assert.equal(await read(f.claude, 'projects', 'proj', 'a.jsonl'), '{"a":1}\n');
    assert.match(await read(f.log), /^claude plugin enable engram@engram --scope user$/m);
    assert.match(rb.stdout, /sha256/i);
  } finally { await f.cleanup(); }
});

test('migrate.sh stops when gentle-ai uninstall rejects --agent, and never reaches the install', async () => {
  const f = await fixture();
  try {
    const r = run(MIGRATE, ['--execute', '--assume-yes'], f, { STUB_UNINSTALL_FAIL: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /does not support 'uninstall --agent'/);
    assert.doesNotMatch(await read(f.log), /plugin disable/);
    assert.doesNotMatch(await read(f.claude, 'CLAUDE.md'), /gentle-lite:/);
    assert.ok((await stat(path.join(f.home, 'gentle-lite-migration'))).isDirectory(), 'the backup of phase 1 exists');
  } finally { await f.cleanup(); }
});

test('rollback.sh refuses a backup whose checksum does not match and changes nothing', async () => {
  const f = await fixture();
  try {
    assert.equal(run(MIGRATE, ['--execute', '--assume-yes'], f).status, 0);
    const dir = path.join(f.home, 'gentle-lite-migration', (await readdir(path.join(f.home, 'gentle-lite-migration')))[0]);
    await writeFile(path.join(dir, 'backup.tar.gz.sha256'), `${'0'.repeat(64)}  backup.tar.gz\n`);
    const before = await tree(f.claude);
    const r = run(ROLLBACK, [dir, '--assume-yes'], f);
    assert.notEqual(r.status, 0);
    assert.deepEqual(await tree(f.claude), before);
  } finally { await f.cleanup(); }
});
