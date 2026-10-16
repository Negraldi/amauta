// End-to-end: install into a fake HOME, run every registered hook command and MCP server the way
// Claude Code does, check memory.db and the portal, then uninstall and compare with the seeded files.
// Run alone with: node --test test/e2e.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { makeRepo } from './helpers/repo.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(repoRoot, 'bin', 'amauta.js');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

const SEED_SETTINGS = {
  model: 'opus',
  permissions: { defaultMode: 'acceptEdits', allow: ['Bash(ls:*)'] },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-pre-hook' }] }] },
};
const SEED_CLAUDE_JSON = { numStartups: 3, mcpServers: { mine: { command: 'echo', args: ['hi'] } } };
const SEED_CLAUDE_MD = '# My own rules\n\nAlways answer in haiku.\n';

let root, home, claudeHome, claudeJson, stateDir, project, fakeBin, env, settings, mcp, pathEnv;

const hookCommands = (event) => (settings.hooks[event] ?? []).flatMap((e) => e.hooks.map((h) => ({ matcher: e.matcher, command: h.command })));
const runHook = (command, payload) =>
  spawnSync('sh', ['-c', command], { input: JSON.stringify(payload), encoding: 'utf8', cwd: project.dir, env });
const query = (sql) => {
  const r = spawnSync('python3', ['-P', '-c', 'import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute(sys.argv[2]).fetchall()))', path.join(stateDir, 'memory.db'), sql], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

/** Minimal newline-delimited JSON-RPC client for a stdio MCP server entry from claude.json. */
async function withMcp(entry, fn) {
  const child = spawn(entry.command, entry.args ?? [], { cwd: project.dir, env: { ...env, ...(entry.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  let n = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++n;
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    assert.ok(init.result.serverInfo.name);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const list = await call('tools/list', {});
    const callTool = async (name, args) => {
      const r = await call('tools/call', { name, arguments: args });
      assert.ok(!r.result.isError, JSON.stringify(r));
      return r.result.content[0].text;
    };
    return await fn({ tools: list.result.tools.map((t) => t.name), callTool });
  } finally {
    child.stdin.end();
    child.kill();
  }
}

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gl-e2e-'));
  home = path.join(root, 'home');
  claudeHome = path.join(home, '.claude');
  claudeJson = path.join(home, '.claude.json');
  stateDir = path.join(home, '.amauta');
  fakeBin = path.join(root, 'bin');
  await mkdir(claudeHome, { recursive: true });
  await mkdir(fakeBin);
  await writeFile(path.join(claudeHome, 'settings.json'), JSON.stringify(SEED_SETTINGS, null, 2));
  await writeFile(path.join(claudeHome, 'CLAUDE.md'), SEED_CLAUDE_MD);
  await writeFile(claudeJson, JSON.stringify(SEED_CLAUDE_JSON, null, 2));
  // Fake codegraph: only `prompt-hook` is ever executed (it prints nothing).
  await writeFile(path.join(fakeBin, 'codegraph'), '#!/bin/sh\nexit 0\n');
  await chmod(path.join(fakeBin, 'codegraph'), 0o755);
  pathEnv = `${fakeBin}${path.delimiter}${process.env.PATH}`;
  env = { ...process.env, HOME: home, PATH: pathEnv, AMAUTA_CLAUDE_HOME: claudeHome, AMAUTA_CLAUDE_JSON: claudeJson, AMAUTA_STATE_DIR: stateDir };
  project = await makeRepo({ 'README.md': '# e2e project\n', 'package.json': '{}\n' });
  await project.write('odd/tasks/demo.md', '# Demo\n\n- [x] T1 first\n- [ ] T2 second\n');
  project.commit('add tasks');
});

after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test('install --with-sdd --with-rea --with-context7 writes settings hooks, MCP entries and state', async () => {
  const r = spawnSync('node', [CLI, 'install', '--with-sdd', '--with-rea', '--with-context7'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  settings = await readJson(path.join(claudeHome, 'settings.json'));
  mcp = (await readJson(claudeJson)).mcpServers;
  assert.equal(settings.permissions.defaultMode, 'acceptEdits', 'defaultMode preserved');
  assert.equal(settings.model, 'opus');
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop', 'PreToolUse']) {
    assert.ok(hookCommands(event).length > 0, `hooks for ${event}`);
  }
  assert.ok(hookCommands('PreToolUse').some((h) => h.command === 'echo user-pre-hook'), 'user PreToolUse hook kept');
  assert.ok(hookCommands('UserPromptSubmit').some((h) => h.command === 'codegraph prompt-hook'), 'codegraph hook (fake codegraph on PATH)');
  for (const key of ['engram', 'amauta', 'context7', 'rea', 'codegraph', 'mine']) assert.ok(mcp[key], `mcp ${key}`);
  const state = await readJson(path.join(stateDir, 'state.json'));
  assert.equal(state.sdd, true);
  assert.equal(state.telemetry, true);
  assert.ok(existsSync(path.join(claudeHome, 'skills', 'sdd-apply', 'SKILL.md')));
  const md = await readFile(path.join(claudeHome, 'CLAUDE.md'), 'utf8');
  assert.ok(md.startsWith('# My own rules'));
  assert.match(md, /<!-- amauta:/);
  const s = spawnSync('node', [CLI, 'status'], { encoding: 'utf8', env });
  assert.equal(s.status, 0, s.stdout + s.stderr);
});

test('every registered hook command runs under sh -c and exits 0', async () => {
  const transcript = path.join(root, 'sess-1.jsonl');
  await writeFile(transcript, `${JSON.stringify({
    type: 'assistant', sessionId: 'sess-1', timestamp: new Date().toISOString(), cwd: project.dir,
    message: { id: 'msg_e2e_1', model: 'claude-sonnet-5-5', usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33, cache_creation_input_tokens: 44 }, content: [{ type: 'tool_use', id: 'tu_1', name: 'Skill', input: { skill: 'work-unit-commits' } }] },
  })}\n`);
  const base = { session_id: 'sess-1', transcript_path: transcript, cwd: project.dir };
  const payloads = {
    SessionStart: { ...base, hook_event_name: 'SessionStart', source: 'startup' },
    UserPromptSubmit: { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'SECRET-PROMPT-TEXT' },
    PostToolUse: { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} },
    Stop: { ...base, hook_event_name: 'Stop', stop_hook_active: false },
    SubagentStop: { ...base, hook_event_name: 'SubagentStop', agent_transcript_path: transcript },
  };
  for (const [event, payload] of Object.entries(payloads)) {
    for (const { command } of hookCommands(event)) {
      if (command === 'echo user-pre-hook') continue;
      const r = runHook(command, payload);
      assert.equal(r.status, 0, `${event}: ${command}\n${r.stderr}`);
    }
  }
  const pre = hookCommands('PreToolUse').find((h) => /preflight-hook/.test(h.command));
  const agent = (type) => ({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: type, prompt: 'x' } });
  const denied = runHook(pre.command, agent('sdd-apply'));
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const quiet = runHook(pre.command, agent('general-purpose'));
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');
});

test('telemetry events and usage rows landed in memory.db (no prompt text stored)', () => {
  const events = Object.fromEntries(query('select event, count(*) from events group by event'));
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop']) assert.ok(events[e] >= 1, `event ${e}`);
  assert.deepEqual(query("select input, output, cache_read, model from usage_messages where message_id='msg_e2e_1'"), [[11, 22, 33, 'claude-sonnet-5-5']]);
  assert.deepEqual(query("select tool, skill from tool_calls where call_id='tu_1'"), [['Skill', 'work-unit-commits']]);
  assert.ok(!JSON.stringify(query('select * from events')).includes('SECRET-PROMPT-TEXT'));
});

test('memory MCP server (engram entry): initialize, tools/list, mem_save and mem_search', async () => {
  await withMcp(mcp.engram, async ({ tools, callTool }) => {
    for (const t of ['mem_save', 'mem_search', 'mem_context']) assert.ok(tools.includes(t), t);
    await callTool('mem_save', { title: 'e2e decision', content: 'we chose pelican-routing for e2e', type: 'decision', project: 'e2e' });
    const found = await callTool('mem_search', { query: 'pelican', project: 'e2e' });
    assert.match(found, /e2e decision/);
  });
  assert.equal(query("select count(*) from observations where title='e2e decision'")[0][0], 1);
});

test('amauta MCP server: initialize, tools/list and odd_tasks_status', async () => {
  await withMcp(mcp['amauta'], async ({ tools, callTool }) => {
    for (const t of ['odd_tasks_status', 'review_assess', 'skill_registry_refresh', 'review_mode_status']) assert.ok(tools.includes(t), t);
    const out = JSON.parse(await callTool('odd_tasks_status', { cwd: project.dir }));
    assert.deepEqual(out.files, [{ file: 'odd/tasks/demo.md', done: 1, total: 2, next: 'T2 second' }]);
    assert.deepEqual(out.next, { file: 'odd/tasks/demo.md', item: 'T2 second' });
  });
});

test('portal serves /api/overview on 127.0.0.1', async () => {
  const child = spawn('node', [CLI, 'portal', '--port', '0', '--claude-home', claudeHome, '--engram-db', path.join(home, 'none.db')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('portal did not start')), 15000);
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        const m = /(http:\/\/127\.0\.0\.1:\d+)\//.exec(line);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      child.on('exit', (code) => reject(new Error(`portal exited ${code}`)));
    });
    const res = await fetch(`${url}/api/overview`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.available, true);
    assert.equal(body.totals.messages, 1);
    assert.equal(body.totals.output, 22);
    assert.ok(body.events >= 5);
    assert.match(await (await fetch(`${url}/`)).text(), /<html/i);
  } finally {
    child.kill();
  }
});

test('uninstall restores the seeded settings, claude.json and CLAUDE.md and removes managed files', async () => {
  const r = spawnSync('node', [CLI, 'uninstall'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await readJson(path.join(claudeHome, 'settings.json')), SEED_SETTINGS);
  assert.deepEqual(await readJson(claudeJson), SEED_CLAUDE_JSON);
  assert.equal(await readFile(path.join(claudeHome, 'CLAUDE.md'), 'utf8'), SEED_CLAUDE_MD);
  for (const rel of ['skills/sdd-apply', 'agents/sdd-apply.md', 'commands', 'skills/_shared', 'output-styles']) {
    assert.ok(!existsSync(path.join(claudeHome, rel)), `${rel} removed`);
  }
  assert.deepEqual((await readdir(path.join(claudeHome, 'skills')).catch(() => [])), []);
  assert.ok(!existsSync(path.join(stateDir, 'state.json')));
});
