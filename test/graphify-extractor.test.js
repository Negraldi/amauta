import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadManifest, readAssetText } from '../src/install/assets.js';
import { install, status, uninstall } from '../src/install/installer.js';
import { renderAgent } from '../src/install/templating.js';

const exists = (p) => stat(p).then(() => true, () => false);

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gl-extractor-'));
  const t = { root, claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state') };
  t.opts = () => ({ claudeHome: t.claudeHome, claudeJson: t.claudeJson, stateDir: t.stateDir, searchPath: '' });
  return t;
}

const frontmatter = (text) => Object.fromEntries(text.match(/^---\n([\s\S]*?)\n---\n/)[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));

test('renderAgent keeps a locked tool allowlist exactly and adds no footers', () => {
  const template = '---\nname: x\nmodel: {{CLAUDE_MODEL}}\n{{CLAUDE_EFFORT_FRONTMATTER}}\ntools: Read\n---\n\nBody.\n';
  const out = renderAgent(template, { assignment: { model: 'haiku' }, engramPrefix: 'mcp__engram__', footers: [{ id: 'codegraph-guidance', body: 'CG' }], lockTools: true });
  assert.match(out, /^tools: Read$/m);
  assert.ok(!out.includes('codegraph'), out);
  const unlocked = renderAgent(template, { assignment: { model: 'haiku' }, engramPrefix: 'mcp__engram__', footers: [] });
  assert.match(unlocked, /^tools: Read, mcp__codegraph__codegraph_explore$/m, 'default behaviour is unchanged');
});

test('graphify-extractor is a managed agent: Read only, haiku, untrusted-data contract', async () => {
  const manifest = await loadManifest();
  const entry = manifest.agents.find((a) => a.name === 'graphify-extractor');
  assert.ok(entry, 'listed in the manifest');
  assert.equal(entry.toolsLocked, true);
  const template = await readAssetText(`${manifest.agentsDir}/graphify-extractor.md`);
  assert.equal(frontmatter(template).tools, 'Read');
  assert.match(template, /untrusted/i);
  assert.match(template, /ignore/i);
  assert.match(template, /only the JSON object/i);
  assert.match(template, /no (code )?fences/i);
  assert.doesNotMatch(template, /gentle-ai/);
});

test('install renders tools: Read and model: haiku unchanged; status tracks it; uninstall removes it', async () => {
  const t = await sandbox();
  try {
    await install(t.opts());
    const file = path.join(t.claudeHome, 'agents', 'graphify-extractor.md');
    const text = await readFile(file, 'utf8');
    const fm = frontmatter(text);
    assert.equal(fm.tools, 'Read');
    assert.equal(fm.model, 'haiku');
    assert.equal(fm.name, 'graphify-extractor');
    assert.ok(!text.includes('{{') && !text.includes('mcp__'), text);
    assert.ok(!text.includes('gentle-lite:'), 'no footer sections (they describe tools it does not have)');
    const s = await status(t.opts());
    assert.ok(s.items.find((i) => i.name === 'file agents/graphify-extractor.md')?.ok, 'status tracks the agent');
    await install(t.opts()); // idempotent, tools allowlist survives a second run
    assert.equal(frontmatter(await readFile(file, 'utf8')).tools, 'Read');
    await uninstall(t.opts());
    assert.ok(!(await exists(file)));
  } finally {
    await rm(t.root, { recursive: true, force: true });
  }
});
