import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadManifest, readAssetText, repoRoot } from '../src/install/assets.js';
import { spawnSync } from 'node:child_process';
import { install, uninstall, status, renderSkillFile } from '../src/install/installer.js';

const exists = (p) => stat(p).then(() => true, () => false);

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-semskill-'));
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state') };
  t.opts = () => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: '' });
  return t;
}

test('the graphify-semantic skill is vendored with a trigger description and the dispatch contract', async () => {
  const manifest = await loadManifest();
  assert.ok(manifest.skills.includes('graphify-semantic'));
  const text = await readAssetText('skills/graphify-semantic/SKILL.md');
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(front, 'frontmatter');
  assert.match(front[1], /^name: graphify-semantic$/m);
  assert.match(front[1], /^description: ".*Trigger:.*"$/m);
  // Dispatch contract: one message, the Read-only graphify-extractor agent on Haiku, a rendered prompt file each.
  assert.match(text, /subagent_type: "graphify-extractor"/);
  assert.doesNotMatch(text, /subagent_type: "general-purpose"/);
  assert.match(text, /model: "haiku"/);
  assert.match(text, /ONE message/i);
  assert.match(text, /amauta\.graph\.semantic_plan/);
  // Subagents never write: the orchestrator saves each reply through the validating helper, and documents are untrusted data.
  assert.match(text, /<prefix> save-chunk <N>/);
  // Replies are untrusted: never route them through a shell (a heredoc terminator in the reply would run as commands).
  assert.doesNotMatch(text, /heredoc|<<|GRAPHIFY_JSON_REPLY|stdin/i);
  assert.match(text, /Write tool/);
  assert.match(text, /save-chunk <N> --repo "<repo>" --input/);
  assert.match(text, /exit code 75/);
  // Retry contract: capped (3 attempts, growing waits), then stop and report; plan and merge are retryable too.
  assert.match(text, /3 attempts/);
  assert.match(text, /5 s.*15 s.*45 s/);
  assert.match(text, /stop and report/i);
  assert.match(text, /plan[^.]*merge[^.]*75|75[^.]*plan[^.]*merge/i);
  // Reply file naming is explicit: <NN> is the two-digit zero-padded chunk number.
  assert.match(text, /<NN>[^.]*two-digit|two-digit[^.]*<NN>/i);
  // Every path argument is quoted for the shell.
  assert.doesNotMatch(text, /--repo <repo>/);
  assert.doesNotMatch(text, /--input <that file>/);
  assert.match(text, /--repo "<repo>"/);
  assert.match(text, /--input "<reply file>"/);
  assert.match(text, /untrusted/i);
  assert.match(text, /never write/i);
  assert.match(text, /<prefix> plan/);
  assert.match(text, /<prefix> validate/);
  assert.match(text, /<prefix> merge/);
  assert.match(text, /prompt_file/);
  // Cost honesty: a real confirmation above the chunk threshold, usage-limit warning, report of tokens and deltas.
  assert.match(text, /usage limits/i);
  assert.match(text, /more than 3 chunks/i);
  assert.match(text, /AskUserQuestion|ask the user/i);
  assert.match(text, /nodes?/i);
  assert.match(text, /tokens/i);
  assert.match(text, /amauta graphify semantic/); // headless alternative (API key)
  assert.doesNotMatch(text, /gentle-ai/);
  assert.ok(text.length < 6000, `skill is ${text.length} chars; keep it concise`);
});

test('the rendered helper command survives a checkout path with spaces and quotes (it is shell-quoted)', () => {
  const dir = "/tmp/a b/it's/python";
  const out = renderSkillFile('graphify-semantic/SKILL.md', Buffer.from('Prefix: `env {{AMAUTA_PYTHONPATH_ENV}} python3 -P -m x`'), dir).toString('utf8');
  const frag = out.match(/`env (.*) python3/)[1];
  const r = spawnSync('sh', ['-c', `set -- ${frag}; printf '%s' "$1"`], { encoding: 'utf8' });
  assert.equal(r.stdout, `PYTHONPATH=${dir}`);
});

test('install renders the helper path, status lists the skill, uninstall removes it', async () => {
  const t = await sandbox();
  try {
    await install(t.opts());
    const file = path.join(t.claudeHome, 'skills', 'graphify-semantic', 'SKILL.md');
    const text = await readFile(file, 'utf8');
    assert.ok(!text.includes('{{'), 'unresolved placeholder');
    assert.ok(text.includes(`PYTHONPATH=${path.join(repoRoot, 'python')} python3 -P -m amauta.graph.semantic_plan`) || text.includes(`'PYTHONPATH=${path.join(repoRoot, 'python')}' python3 -P -m amauta.graph.semantic_plan`), 'absolute helper command');
    const s = await status(t.opts());
    const item = s.items.find((i) => i.name === 'file skills/graphify-semantic/SKILL.md');
    assert.ok(item?.ok, 'status tracks the managed skill file');
    await uninstall(t.opts());
    assert.ok(!(await exists(file)));
  } finally {
    await rm(t.root, { recursive: true, force: true });
  }
});
