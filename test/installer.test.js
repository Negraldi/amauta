import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, stat, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, uninstall, status } from '../src/install/installer.js';
import { listSections } from '../src/core/markers.js';

const exists = (p) => stat(p).then(() => true, () => false);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

async function sandbox(seed = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-install-'));
  const t = {
    root,
    claudeHome: path.join(root, 'home', '.claude'),
    claudeJson: path.join(root, 'home', 'claude.json'),
    stateDir: path.join(root, 'state'),
  };
  t.p = (...a) => path.join(t.claudeHome, ...a);
  await mkdir(t.claudeHome, { recursive: true });
  if (seed.claudeMd !== undefined) await writeFile(t.p('CLAUDE.md'), seed.claudeMd);
  if (seed.settings) await writeFile(t.p('settings.json'), `${JSON.stringify(seed.settings, null, 2)}\n`);
  if (seed.claudeJson) await writeFile(t.claudeJson, `${JSON.stringify(seed.claudeJson, null, 2)}\n`);
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, ...extra });
  t.cleanup = () => rm(root, { recursive: true, force: true });
  return t;
}

async function snapshotTree(dir) {
  const out = {};
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out[path.relative(dir, full)] = (await readFile(full)).toString('base64');
    }
  }
  if (await exists(dir)) await walk(dir);
  return out;
}

const USER_SETTINGS = {
  model: 'opus',
  permissions: { defaultMode: 'auto', deny: ['Bash(custom-deny)'], allow: ['Bash(ls)'] },
  hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'my-own-stop-hook' }] }] },
  enabledPlugins: { 'other@market': true },
};
const USER_CLAUDE_JSON = {
  oauthAccount: { email: 'x@example.com' },
  mcpServers: { custom: { command: 'my-server' }, context7: { command: 'my-own-context7' } },
};
const USER_MD = '# My notes\n\nSome custom text I wrote.\n';

test('fresh install creates every component', async () => {
  const t = await sandbox();
  const res = await install(t.opts());
  assert.equal(res.changed, true);

  const md = await readFile(t.p('CLAUDE.md'), 'utf8');
  const ids = listSections(md).map((s) => s.id);
  for (const id of ['persona', 'engram-protocol', 'orchestrator', 'agent-routing', 'codegraph-guidance']) {
    assert.ok(ids.includes(id), `missing section ${id}`);
  }
  assert.ok(!md.includes('{{'), 'unresolved template placeholder in CLAUDE.md');
  assert.match(md, /Organic Driven Development/);

  assert.ok(await exists(t.p('output-styles', 'gentleman.md')));
  assert.ok(await exists(t.p('skills', 'judgment-day', 'SKILL.md')));
  assert.ok(await exists(t.p('skills', '_shared', 'skill-resolver.md')));
  assert.ok(!(await exists(t.p('skills', '_shared', 'odd-orchestrator-sections.md'))));

  const risk = await readFile(t.p('agents', 'review-risk.md'), 'utf8');
  assert.match(risk, /^model: sonnet$/m);
  assert.ok(!risk.includes('{{'));
  assert.ok(!risk.includes('mcp__plugin_engram'));

  const settings = await readJson(t.p('settings.json'));
  assert.equal(settings.outputStyle, 'Gentleman');
  assert.ok(!('defaultMode' in settings.permissions), 'must not force a defaultMode');
  assert.equal(settings.permissions.deny.length, 24);
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['SessionStart', 'Stop', 'UserPromptSubmit']);
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'gentle-lite.js');
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, `node ${bin} hook skill-registry`);
  assert.equal(settings.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, `node ${bin} hook review-stop`);

  const cj = await readJson(t.claudeJson);
  assert.deepEqual(Object.keys(cj.mcpServers).sort(), ['codegraph', 'context7', 'engram', 'gentle-lite', 'rea']);
  assert.equal(cj.mcpServers.context7.args[1], '--package=@upstash/context7-mcp@2.2.5');
  assert.equal(cj.mcpServers['gentle-lite'].command, 'node');
  assert.ok(path.isAbsolute(cj.mcpServers['gentle-lite'].args[0]));
  assert.match(cj.mcpServers['gentle-lite'].args[0], /src[\\/]mcp[\\/]server\.js$/);
  assert.equal((await stat(t.claudeJson)).mode & 0o777, 0o600);

  const state = await readJson(path.join(t.stateDir, 'state.json'));
  assert.equal(state.schema, 'gentle-lite.state/v1');
  assert.equal(state.rdd_mode, 'off');
  assert.equal(state.claude_home, t.claudeHome);
  assert.ok(state.installed_at);
  assert.equal(state.model_assignments.default, 'sonnet');
  assert.ok(state.components.includes('agents'));
  await t.cleanup();
});

test('install keeps pre-existing user content', async () => {
  const t = await sandbox({ claudeMd: USER_MD, settings: USER_SETTINGS, claudeJson: USER_CLAUDE_JSON });
  await install(t.opts());

  const md = await readFile(t.p('CLAUDE.md'), 'utf8');
  assert.ok(md.startsWith(USER_MD));

  const settings = await readJson(t.p('settings.json'));
  assert.equal(settings.model, 'opus');
  assert.equal(settings.permissions.defaultMode, 'auto');
  assert.deepEqual(settings.permissions.allow, ['Bash(ls)']);
  assert.ok(settings.permissions.deny.includes('Bash(custom-deny)'));
  assert.ok(settings.permissions.deny.includes('Read(.env)'));
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'my-own-stop-hook');
  assert.deepEqual(settings.enabledPlugins, { 'other@market': true });

  const cj = await readJson(t.claudeJson);
  assert.deepEqual(cj.oauthAccount, { email: 'x@example.com' });
  assert.deepEqual(cj.mcpServers.custom, { command: 'my-server' });
  assert.deepEqual(cj.mcpServers.context7, { command: 'my-own-context7' });
  assert.ok(cj.mcpServers.rea);
  await t.cleanup();
});

test('a second install changes nothing and creates no backup', async () => {
  const t = await sandbox({ claudeMd: USER_MD, settings: USER_SETTINGS, claudeJson: USER_CLAUDE_JSON });
  await install(t.opts());
  const homeBefore = await snapshotTree(t.root);
  const backupsBefore = await readdir(path.join(t.stateDir, 'backups'));
  const res = await install(t.opts());
  assert.equal(res.changed, false);
  assert.deepEqual(await snapshotTree(t.root), homeBefore);
  assert.deepEqual(await readdir(path.join(t.stateDir, 'backups')), backupsBefore);
  await t.cleanup();
});

test('the first install backs up existing targets before writing', async () => {
  const t = await sandbox({ claudeMd: USER_MD, settings: USER_SETTINGS, claudeJson: USER_CLAUDE_JSON });
  const res = await install(t.opts());
  assert.ok(res.backup);
  const manifest = await readJson(path.join(res.backup, 'manifest.json'));
  const orig = manifest.entries.find((e) => e.original_path === t.p('CLAUDE.md'));
  assert.equal(orig.existed, true);
  assert.equal(await readFile(path.join(res.backup, orig.snapshot_path), 'utf8'), USER_MD);
  const agent = manifest.entries.find((e) => e.original_path === t.p('agents', 'review-risk.md'));
  assert.equal(agent.existed, false);
  const state = await readJson(path.join(t.stateDir, 'state.json'));
  assert.equal(state.last_backup, res.backup);
  await t.cleanup();
});

test('uninstall restores the pre-install state exactly', async () => {
  const t = await sandbox({ claudeMd: USER_MD, settings: USER_SETTINGS, claudeJson: USER_CLAUDE_JSON });
  await install(t.opts());
  const res = await uninstall(t.opts());
  assert.equal(res.changed, true);

  assert.equal(await readFile(t.p('CLAUDE.md'), 'utf8'), USER_MD);
  assert.deepEqual(await readJson(t.p('settings.json')), USER_SETTINGS);
  assert.deepEqual(await readJson(t.claudeJson), USER_CLAUDE_JSON);
  assert.ok(!(await exists(t.p('skills'))));
  assert.ok(!(await exists(t.p('agents'))));
  assert.ok(!(await exists(t.p('output-styles', 'gentleman.md'))));
  assert.ok(!(await exists(path.join(t.stateDir, 'state.json'))));
  await t.cleanup();
});

test('uninstall from a fresh install removes the files install created', async () => {
  const t = await sandbox();
  await install(t.opts());
  await uninstall(t.opts());
  assert.deepEqual(await snapshotTree(t.claudeHome), {});
  assert.ok(!(await exists(t.claudeJson)));
  await t.cleanup();
});

test('install then uninstall then install again works', async () => {
  const t = await sandbox({ claudeMd: USER_MD });
  await install(t.opts());
  await uninstall(t.opts());
  const res = await install(t.opts());
  assert.equal(res.changed, true);
  assert.ok(await exists(t.p('skills', 'judgment-day', 'SKILL.md')));
  await t.cleanup();
});

test('--dry-run writes nothing', async () => {
  const t = await sandbox({ claudeMd: USER_MD });
  const res = await install(t.opts({ dryRun: true }));
  assert.equal(res.dryRun, true);
  assert.ok(res.files.length > 10);
  assert.equal(await readFile(t.p('CLAUDE.md'), 'utf8'), USER_MD);
  assert.ok(!(await exists(t.stateDir)));
  assert.ok(!(await exists(t.claudeJson)));
  await t.cleanup();
});

test('engram plugin enabled: no engram MCP entry and plugin tool prefix in agents', async () => {
  const t = await sandbox({ settings: { enabledPlugins: { 'engram@engram': true } } });
  await install(t.opts());
  const cj = await readJson(t.claudeJson);
  assert.ok(!('engram' in cj.mcpServers));
  const judge = await readFile(t.p('agents', 'jd-judge-a.md'), 'utf8');
  assert.match(judge, /mcp__plugin_engram_engram__mem_search/);
  await t.cleanup();
});

test('without the engram plugin the direct MCP prefix is used', async () => {
  const t = await sandbox();
  await install(t.opts());
  const judge = await readFile(t.p('agents', 'jd-judge-a.md'), 'utf8');
  assert.match(judge, /mcp__engram__mem_search/);
  assert.match(judge, /mcp__codegraph__codegraph_explore/);
  await t.cleanup();
});

test('model assignments in state.json are honoured on re-install', async () => {
  const t = await sandbox();
  await install(t.opts());
  const sp = path.join(t.stateDir, 'state.json');
  const state = await readJson(sp);
  state.model_assignments['jd-judge-a'] = 'opus';
  await writeFile(sp, `${JSON.stringify(state, null, 2)}\n`);
  await install(t.opts());
  assert.match(await readFile(t.p('agents', 'jd-judge-a.md'), 'utf8'), /^model: opus$/m);
  assert.equal((await readJson(sp)).model_assignments['jd-judge-a'], 'opus');
  await t.cleanup();
});

test('a user-edited managed file is kept on re-install and uninstall unless --force', async () => {
  const t = await sandbox();
  await install(t.opts());
  const f = t.p('agents', 'review-risk.md');
  await writeFile(f, 'my own reviewer\n');
  const res = await install(t.opts());
  assert.ok(res.skipped.some((s) => s.endsWith('review-risk.md')));
  assert.equal(await readFile(f, 'utf8'), 'my own reviewer\n');
  await uninstall(t.opts());
  assert.equal(await readFile(f, 'utf8'), 'my own reviewer\n');
  assert.ok(!(await exists(t.p('agents', 'review-risk.md.bak'))));

  await install(t.opts({ force: true }));
  assert.match(await readFile(f, 'utf8'), /R1 Risk/);
  await t.cleanup();
});

test('an unparsable .claude.json aborts before anything is written', async () => {
  const t = await sandbox({ claudeMd: USER_MD });
  await writeFile(t.claudeJson, '{ not json');
  await assert.rejects(install(t.opts()), /claude\.json/);
  assert.equal(await readFile(t.p('CLAUDE.md'), 'utf8'), USER_MD);
  assert.ok(!(await exists(t.p('skills'))));
  assert.ok(!(await exists(t.stateDir)));
  await t.cleanup();
});

test('neutral persona installs the neutral output style', async () => {
  const t = await sandbox();
  await install(t.opts({ persona: 'neutral' }));
  assert.equal((await readJson(t.p('settings.json'))).outputStyle, 'Neutral');
  assert.match(await readFile(t.p('output-styles', 'gentleman.md'), 'utf8'), /^name: Neutral$/m);
  await t.cleanup();
});

test('uninstall restores a previous outputStyle', async () => {
  const t = await sandbox({ settings: { outputStyle: 'Explanatory' } });
  await install(t.opts());
  assert.equal((await readJson(t.p('settings.json'))).outputStyle, 'Gentleman');
  await uninstall(t.opts());
  assert.deepEqual(await readJson(t.p('settings.json')), { outputStyle: 'Explanatory' });
  await t.cleanup();
});

test('status reports installed and missing components', async () => {
  const t = await sandbox();
  let s = await status(t.opts());
  assert.equal(s.installed, false);
  await install(t.opts());
  s = await status(t.opts());
  assert.equal(s.installed, true);
  assert.equal(s.ok, true);
  assert.ok(s.items.every((i) => i.ok), JSON.stringify(s.items.filter((i) => !i.ok)));
  await rm(t.p('agents', 'review-risk.md'));
  s = await status(t.opts());
  assert.equal(s.ok, false);
  assert.ok(s.items.some((i) => !i.ok && /review-risk/.test(i.name)));
  await t.cleanup();
});

test('uninstall without state still strips markers and hooks', async () => {
  const t = await sandbox({ claudeMd: USER_MD, settings: USER_SETTINGS });
  await install(t.opts());
  await rm(path.join(t.stateDir, 'state.json'));
  await uninstall(t.opts());
  assert.equal(await readFile(t.p('CLAUDE.md'), 'utf8'), USER_MD);
  assert.deepEqual((await readJson(t.p('settings.json'))).hooks, USER_SETTINGS.hooks);
  await t.cleanup();
});

test('install replaces legacy PATH-based gentle-lite hooks and keeps user hooks; uninstall removes quoted entries', async () => {
  const legacy = { type: 'command', command: 'gentle-lite hook review-stop' };
  const mine = { type: 'command', command: 'echo mine' };
  const t = await sandbox({ settings: { hooks: { Stop: [{ matcher: '', hooks: [legacy, mine] }] } } });
  await install(t.opts());
  const cmds = (await readJson(t.p('settings.json'))).hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(!cmds.includes('gentle-lite hook review-stop'));
  assert.ok(cmds.includes('echo mine'));
  assert.ok(cmds.some((c) => /^node \S+gentle-lite\.js hook review-stop$/.test(c)));
  // A hand-written quoted variant is also recognised on uninstall.
  const s = await readJson(t.p('settings.json'));
  s.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command: "node '/my dir/bin/gentle-lite.js' hook review-stop" }] });
  await writeFile(t.p('settings.json'), JSON.stringify(s));
  await uninstall(t.opts());
  const left = (await readJson(t.p('settings.json'))).hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
  assert.deepEqual(left, ['echo mine']);
  await t.cleanup();
});
