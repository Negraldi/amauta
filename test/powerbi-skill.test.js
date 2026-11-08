// The powerbi-report skill (plan D9b): registered, concise, its references linked, the PBIR tools it names exist, and
// install renders the portable helper command in the skill and its references.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadManifest, readAssetText, repoRoot } from '../src/install/assets.js';
import { install } from '../src/install/installer.js';
import { tempDir } from './helpers/tmp.js';

const REFS = ['statistical-contracts', 'calculation-placement', 'clean-report-design', 'semantic-model-conventions', 'pbir-authoring-notes', 'visual-catalog'];

test('the skill is registered with a trigger, links every reference and names only commands that exist', async () => {
  assert.ok((await loadManifest()).skills.includes('powerbi-report'));
  const text = await readAssetText('skills/powerbi-report/SKILL.md');
  assert.match(/^---\n([\s\S]*?)\n---\n/.exec(text)[1], /^description: "Trigger: [^"\n]+"$/m);
  assert.ok(text.length < 6000, `${text.length} chars`);
  for (const ref of REFS) assert.match(text, new RegExp(`\\(references/${ref}\\.md\\)`), ref);
  for (const cmd of ['lint', 'layout', 'diff', 'dictionary', 'rename']) {
    assert.match(text, new RegExp(`amauta\\.extras\\.pbir ${cmd}`), cmd);
    const r = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'amauta.js'), 'py', 'amauta.extras.pbir', cmd, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
  }
  const all = [text, ...(await Promise.all(REFS.map((r) => readAssetText(`skills/powerbi-report/references/${r}.md`))))].join('\n');
  for (const banned of [/receipt/i, /harness/i, /PyAutoGUI/, /Example Organization/, /\$\{[A-Z_]+\}/, /gentle-ai/]) assert.doesNotMatch(all, banned, String(banned));
});

test('install renders the helper command in the skill and in its references', async () => {
  const root = await tempDir('pbi-');
  const opts = { claudeHome: path.join(root, 'home', '.claude'), claudeJson: path.join(root, 'home', 'claude.json'), stateDir: path.join(root, 'state'), searchPath: '' };
  await install(opts);
  const dir = path.join(opts.claudeHome, 'skills', 'powerbi-report');
  const files = ['SKILL.md', ...(await readdir(path.join(dir, 'references'))).map((f) => path.join('references', f))];
  for (const f of files) assert.ok(!(await readFile(path.join(dir, f), 'utf8')).includes('{{'), f);
  assert.match(await readFile(path.join(dir, 'references', 'semantic-model-conventions.md'), 'utf8'), /amauta\.js'? py amauta\.extras\.pbir lint/);
});
