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
  t.opts = (extra = {}) => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: '', ...extra }); // searchPath '': codegraph (external) is never detected from the host PATH
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
const SECRET_PATHS = ['**/.env', '**/.env.*', '~/.ssh/**', '~/.aws/credentials', '~/.config/gh/hosts.yml', '**/*.pem', '**/*.key', '**/secrets/**'];
const SECRET_DENY = SECRET_PATHS.flatMap((p) => [`Read(${p})`, `Edit(${p})`]);
const USER_MD = '# My notes\n\nSome custom text I wrote.\n';

test('fresh install creates every component', async () => {
  const t = await sandbox();
  const res = await install(t.opts());
  assert.equal(res.changed, true);

  const md = await readFile(t.p('CLAUDE.md'), 'utf8');
  const ids = listSections(md).map((s) => s.id);
  for (const id of ['persona', 'engram-protocol', 'orchestrator', 'codegraph-guidance']) {
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
  assert.deepEqual(settings.permissions.ask, ['Bash(git push --force*)', 'Bash(git reset --hard*)', 'Bash(rm -rf*)']);
  assert.deepEqual(settings.permissions.deny, SECRET_DENY, 'secret-read deny set is installed');
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['PostToolUse', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit']); // telemetry hooks are on by default
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'amauta.js');
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, `node ${bin} hook skill-registry`);
  assert.equal(settings.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, `node ${bin} hook review-stop`);

  const cj = await readJson(t.claudeJson);
  assert.deepEqual(Object.keys(cj.mcpServers).sort(), ['amauta', 'engram']); // rea and context7 are opt-in
  assert.equal(cj.mcpServers['amauta'].command, 'node');
  assert.ok(path.isAbsolute(cj.mcpServers['amauta'].args[0]));
  assert.match(cj.mcpServers['amauta'].args[0], /src[\\/]mcp[\\/]server\.js$/);
  assert.equal((await stat(t.claudeJson)).mode & 0o777, 0o600);

  const state = await readJson(path.join(t.stateDir, 'state.json'));
  assert.equal(state.schema, 'amauta.state/v1');
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
  assert.deepEqual(settings.permissions.deny, ['Bash(custom-deny)', ...SECRET_DENY]);
  assert.ok(settings.permissions.ask.includes('Bash(rm -rf*)'));
  assert.equal(settings.hooks.Stop.length, 4); // mine + review-stop + telemetry + usage
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'my-own-stop-hook');
  assert.deepEqual(settings.enabledPlugins, { 'other@market': true });

  const cj = await readJson(t.claudeJson);
  assert.deepEqual(cj.oauthAccount, { email: 'x@example.com' });
  assert.deepEqual(cj.mcpServers.custom, { command: 'my-server' });
  assert.deepEqual(cj.mcpServers.context7, { command: 'my-own-context7' });
  assert.ok(!('rea' in cj.mcpServers));
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

test('install replaces legacy PATH-based amauta hooks and keeps user hooks; uninstall removes quoted entries', async () => {
  const legacy = { type: 'command', command: 'amauta hook review-stop' };
  const mine = { type: 'command', command: 'echo mine' };
  const t = await sandbox({ settings: { hooks: { Stop: [{ matcher: '', hooks: [legacy, mine] }] } } });
  await install(t.opts());
  const cmds = (await readJson(t.p('settings.json'))).hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(!cmds.includes('amauta hook review-stop'));
  assert.ok(cmds.includes('echo mine'));
  assert.ok(cmds.some((c) => /^node \S+amauta\.js hook review-stop$/.test(c)));
  // A hand-written quoted variant is also recognised on uninstall.
  const s = await readJson(t.p('settings.json'));
  s.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command: "node '/my dir/bin/amauta.js' hook review-stop" }] });
  await writeFile(t.p('settings.json'), JSON.stringify(s));
  await uninstall(t.opts());
  const left = (await readJson(t.p('settings.json'))).hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
  assert.deepEqual(left, ['echo mine']);
  await t.cleanup();
});

const NESTED_ROUTING = [
  '<!-- amauta:agent-routing -->',
  '## Implementation Routing',
  '',
  '- Delegate mapping when 4+ files are needed.',
  '',
  '<!-- amauta:remote-authorization -->',
  '## Remote operation authorization',
  '',
  'Permission to develop locally does not authorize remote execution.',
  '- Do not reuse ambient SSH agents.',
  '<!-- /amauta:remote-authorization -->',
  '<!-- /amauta:agent-routing -->',
].join('\n');

async function seedStaleRouting(t, { listInState }) {
  await install(t.opts());
  const md = await readFile(t.p('CLAUDE.md'), 'utf8');
  await writeFile(t.p('CLAUDE.md'), `${md}\n${NESTED_ROUTING}\n\nMy trailing note.\n`);
  const statePath = path.join(t.stateDir, 'state.json');
  const state = await readJson(statePath);
  if (listInState) state.claude_md_sections.push(...listInState);
  await writeFile(statePath, JSON.stringify(state));
}

for (const [name, listInState] of [['only the outer id is in state', ['agent-routing']], ['both ids are in state, nested one first', ['remote-authorization', 'agent-routing']], ['state does not list it at all (reset or missing state)', null]]) {
  test(`stale-section removal handles the real nested agent-routing/remote-authorization shape: ${name}`, async () => {
    const t = await sandbox({ claudeMd: USER_MD });
    await seedStaleRouting(t, { listInState });
    await install(t.opts());
    const after = await readFile(t.p('CLAUDE.md'), 'utf8');
    assert.ok(!/agent-routing|remote-authorization|Remote operation authorization|Implementation Routing/.test(after), after);
    assert.ok(after.startsWith(USER_MD));
    assert.ok(after.includes('My trailing note.'));
    assert.deepEqual(listSections(after).map((x) => x.id).sort(), ['codegraph-guidance', 'engram-protocol', 'orchestrator', 'persona']);
    // convergence: state no longer lists the retired ids and a further install writes nothing
    const state = await readJson(path.join(t.stateDir, 'state.json'));
    assert.ok(!state.claude_md_sections.includes('agent-routing') && !state.claude_md_sections.includes('remote-authorization'));
    const again = await install(t.opts());
    assert.equal(again.changed, false);
    assert.equal(await readFile(t.p('CLAUDE.md'), 'utf8'), after);
    await t.cleanup();
  });
}

test('every hook amauta registers, including the codegraph prompt hook, carries a timeout', async () => {
  const t = await sandbox();
  const bin = path.join(t.root, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'codegraph'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await install(t.opts({ searchPath: bin, withSdd: true }));
  const settings = await readJson(t.p('settings.json'));
  const hooks = Object.values(settings.hooks).flatMap((es) => es.flatMap((e) => e.hooks));
  assert.ok(hooks.some((h) => h.command === 'codegraph prompt-hook'));
  assert.ok(hooks.length >= 8);
  for (const h of hooks) assert.ok(Number.isInteger(h.timeout) && h.timeout > 0 && h.timeout <= 60, `no sane timeout on: ${h.command}`);
  await t.cleanup();
});

async function fakeCodegraph(t) {
  const bin = path.join(t.root, 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'codegraph'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return bin;
}
const stripTimeouts = (settings, only = () => true) => {
  for (const entries of Object.values(settings.hooks)) for (const e of entries) for (const h of e.hooks) if (only(h)) delete h.timeout;
};
const allHooks = (settings) => Object.values(settings.hooks).flatMap((es) => es.flatMap((e) => e.hooks));

test('re-install adds the missing timeout to hooks we own (codegraph prompt hook and our own commands) but never to a user-owned hook', async () => {
  const t = await sandbox();
  const bin = await fakeCodegraph(t);
  await install(t.opts({ searchPath: bin }));
  const s = await readJson(t.p('settings.json'));
  stripTimeouts(s);
  await writeFile(t.p('settings.json'), JSON.stringify(s));
  await install(t.opts({ searchPath: bin }));
  const hooks = allHooks(await readJson(t.p('settings.json')));
  assert.ok(hooks.some((h) => h.command === 'codegraph prompt-hook'));
  for (const h of hooks) assert.ok(Number.isInteger(h.timeout) && h.timeout > 0, `no timeout after re-install: ${h.command}`);

  // a codegraph prompt hook the user registered themselves is theirs: left exactly as written
  const u = await sandbox({ settings: { hooks: { UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'codegraph prompt-hook' }] }] } } });
  const ubin = await fakeCodegraph(u);
  await install(u.opts({ searchPath: ubin }));
  await install(u.opts({ searchPath: ubin }));
  const mine = allHooks(await readJson(u.p('settings.json'))).filter((h) => h.command === 'codegraph prompt-hook');
  assert.equal(mine.length, 1);
  assert.ok(!('timeout' in mine[0]));
  await t.cleanup();
  await u.cleanup();
});

test('status reports the size of each CLAUDE.md block and warns above the 20k-char budget', async () => {
  const t = await sandbox({ claudeMd: USER_MD });
  await install(t.opts());
  const ok = await status(t.opts());
  assert.equal(ok.sizes.budget, 20000);
  assert.deepEqual(ok.sizes.blocks.map((b) => b.id).sort(), ['codegraph-guidance', 'engram-protocol', 'orchestrator', 'persona']);
  for (const b of ok.sizes.blocks) assert.ok(b.chars > 0 && b.lines > 0);
  assert.equal(ok.sizes.total, ok.sizes.blocks.reduce((n, b) => n + b.chars, 0));
  assert.ok(ok.sizes.total <= ok.sizes.budget, `shipped blocks use ${ok.sizes.total} chars`);
  assert.equal(ok.sizes.over, false);
  assert.deepEqual(ok.warnings, []);

  const md = await readFile(t.p('CLAUDE.md'), 'utf8');
  await writeFile(t.p('CLAUDE.md'), md.replace('<!-- /amauta:orchestrator -->', `${'x'.repeat(21000)}\n<!-- /amauta:orchestrator -->`));
  const big = await status(t.opts());
  assert.equal(big.sizes.over, true);
  assert.match(big.warnings.join('\n'), /20000/);
  await t.cleanup();
});

test('rea and context7 are opt-in, sticky across plain re-installs, never overwrite a user entry, and uninstall removes only ours', async () => {
  const t = await sandbox({ claudeJson: USER_CLAUDE_JSON });
  await install(t.opts({ withRea: true, withContext7: true }));
  let cj = await readJson(t.claudeJson);
  assert.deepEqual(cj.mcpServers.context7, { command: 'my-own-context7' }); // user's entry wins
  assert.deepEqual(cj.mcpServers.rea.args, ['-y', 'rea-agents@6.4.0', 'mcp']);
  await install(t.opts()); // plain re-install keeps the choice
  assert.ok((await readJson(t.claudeJson)).mcpServers.rea);
  await uninstall(t.opts());
  cj = await readJson(t.claudeJson);
  assert.deepEqual(Object.keys(cj.mcpServers).sort(), ['context7', 'custom']);

  const u = await sandbox();
  await install(u.opts({ withContext7: true }));
  const entry = (await readJson(u.claudeJson)).mcpServers.context7;
  assert.equal(entry.args[1], '--package=@upstash/context7-mcp@2.2.5');
  assert.ok(!('rea' in (await readJson(u.claudeJson)).mcpServers));
  await t.cleanup();
  await u.cleanup();
});

test('state that predates the rea/context7 opt-in keeps entries it registered and untouched, carries the choice forward, and uninstall still removes them', async () => {
  const t = await sandbox({ claudeJson: { mcpServers: { custom: { command: 'my-server' } } } });
  await install(t.opts({ withRea: true, withContext7: true }));
  const statePath = path.join(t.stateDir, 'state.json');
  const state = await readJson(statePath);
  delete state.rea; // a pre-T15 state has neither key
  delete state.context7;
  await writeFile(statePath, JSON.stringify(state));
  // the user edited rea's entry: it is theirs now and must not be adopted or refreshed
  const cj = await readJson(t.claudeJson);
  cj.mcpServers.rea = { ...cj.mcpServers.rea, env: { MINE: '1' } };
  await writeFile(t.claudeJson, JSON.stringify(cj));
  await install(t.opts());
  const after = await readJson(t.claudeJson);
  assert.ok(after.mcpServers.context7, 'untouched context7 entry is kept');
  assert.deepEqual(after.mcpServers.rea.env, { MINE: '1' });
  const next = await readJson(statePath);
  assert.equal(next.context7, true);
  assert.equal(next.rea, false);
  assert.ok('context7' in next.mcp_added && !('rea' in next.mcp_added));
  await install(t.opts()); // stable
  assert.equal((await readJson(statePath)).context7, true);
  await uninstall(t.opts());
  assert.deepEqual(Object.keys((await readJson(t.claudeJson)).mcpServers).sort(), ['custom', 'rea']);
  await t.cleanup();
});

test('permissions: ask and deny rules are merged, user rules kept, uninstall removes only the entries we added', async () => {
  const t = await sandbox({ settings: { permissions: { defaultMode: 'plan', ask: ['Bash(mine*)', 'Bash(rm -rf*)'], deny: ['Bash(custom-deny)', 'Read(**/.env)'] } } });
  await install(t.opts());
  let after = await readJson(t.p('settings.json'));
  assert.equal(after.permissions.defaultMode, 'plan');
  assert.deepEqual(after.permissions.deny, ['Bash(custom-deny)', 'Read(**/.env)', ...SECRET_DENY.filter((d) => d !== 'Read(**/.env)')]);
  assert.deepEqual(after.permissions.ask, ['Bash(mine*)', 'Bash(rm -rf*)', 'Bash(git push --force*)', 'Bash(git reset --hard*)']);
  await install(t.opts()); // idempotent
  assert.deepEqual((await readJson(t.p('settings.json'))).permissions, after.permissions);
  await uninstall(t.opts());
  after = await readJson(t.p('settings.json'));
  assert.deepEqual(after.permissions, { defaultMode: 'plan', ask: ['Bash(mine*)', 'Bash(rm -rf*)'], deny: ['Bash(custom-deny)', 'Read(**/.env)'] });
  await t.cleanup();
});

test('permissions: re-install never strips deny rules recorded by a pre-T15 state (legacy deny_added); status reports them', async () => {
  const legacy = ['Read(.env)', 'Read(Library/Keychains/*)'];
  const t = await sandbox({ settings: { permissions: { deny: ['Bash(custom-deny)', ...legacy] } } });
  await install(t.opts());
  const statePath = path.join(t.stateDir, 'state.json');
  const state = await readJson(statePath);
  state.deny_added = legacy;
  await writeFile(statePath, JSON.stringify(state));
  await install(t.opts());
  const after = await readJson(t.p('settings.json'));
  for (const d of legacy) assert.ok(after.permissions.deny.includes(d), `kept ${d}`);
  const st = await status(t.opts());
  assert.deepEqual(st.permissions.legacy_deny, legacy);
  await install(t.opts()); // legacy report survives a further re-install
  assert.deepEqual((await status(t.opts())).permissions.legacy_deny, legacy);
  await uninstall(t.opts());
  const left = (await readJson(t.p('settings.json'))).permissions.deny;
  assert.deepEqual(left, ['Bash(custom-deny)', ...legacy]); // uninstall removes only schema entries
  await t.cleanup();
});

test('permissions: a deny rule the user also lists is never recorded as ours, and an overlay entry the user deleted comes back on re-install and is removed again on uninstall', async () => {
  const t = await sandbox({ settings: { permissions: { deny: ['Read(~/.ssh/**)'] } } });
  await install(t.opts());
  const state = await readJson(path.join(t.stateDir, 'state.json'));
  assert.ok(!state.permissions_added.deny.includes('Read(~/.ssh/**)'));
  assert.equal(state.permissions_added.deny.length, SECRET_DENY.length - 1);
  // user deletes one of our entries and keeps editing: re-install re-adds it (it is still part of the overlay)
  const s = await readJson(t.p('settings.json'));
  s.permissions.deny = s.permissions.deny.filter((d) => d !== 'Edit(**/*.pem)');
  await writeFile(t.p('settings.json'), JSON.stringify(s));
  await install(t.opts());
  assert.ok((await readJson(t.p('settings.json'))).permissions.deny.includes('Edit(**/*.pem)'));
  await uninstall(t.opts());
  assert.deepEqual((await readJson(t.p('settings.json'))).permissions, { deny: ['Read(~/.ssh/**)'] });
  await t.cleanup();
});

test('permissions: state from the T15 schema (ask_added only) keeps tracking its ask rules and gains the deny set', async () => {
  const t = await sandbox();
  await install(t.opts());
  const statePath = path.join(t.stateDir, 'state.json');
  const state = await readJson(statePath);
  state.ask_added = state.permissions_added.ask;
  delete state.permissions_added;
  await writeFile(statePath, JSON.stringify(state));
  const s = await readJson(t.p('settings.json'));
  delete s.permissions.deny;
  await writeFile(t.p('settings.json'), JSON.stringify(s));
  await install(t.opts());
  const after = await readJson(t.p('settings.json'));
  assert.deepEqual(after.permissions.deny, SECRET_DENY);
  await uninstall(t.opts());
  assert.ok(!(await exists(t.p('settings.json'))) || !('permissions' in (await readJson(t.p('settings.json')))));
  await t.cleanup();
});

test('status lists the permission rules (ask and deny) and the CLAUDE.md budget in the CLI output', async () => {
  const t = await sandbox();
  await install(t.opts());
  const st = await status(t.opts());
  assert.deepEqual(st.permissions.ask.map((r) => r.rule), ['Bash(git push --force*)', 'Bash(git reset --hard*)', 'Bash(rm -rf*)']);
  assert.deepEqual(st.permissions.deny.map((r) => r.rule), SECRET_DENY);
  assert.ok([...st.permissions.ask, ...st.permissions.deny].every((r) => r.present));
  await t.cleanup();
});
