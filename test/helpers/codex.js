import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './tmp.js';

export const exists = (p) => stat(p).then(() => true, () => false);

/** Temp Codex sandbox: codex home, skills dir and state dir inside one temp root (removed at process exit). */
export async function codexSandbox(seed = {}) {
  const root = await tempDir('gl-codex-');
  const t = {
    root,
    codexHome: path.join(root, 'codex'),
    skillsDir: path.join(root, 'agents-skills'),
    stateDir: path.join(root, 'state'),
  };
  t.p = (...a) => path.join(t.codexHome, ...a);
  await mkdir(t.codexHome, { recursive: true });
  for (const [name, text] of Object.entries(seed)) await writeFile(t.p(name), text);
  t.opts = (extra = {}) => ({ codexHome: t.codexHome, codexSkillsDir: t.skillsDir, stateDir: t.stateDir, searchPath: '', ...extra });
  t.read = (name) => readFile(t.p(name), 'utf8');
  return t;
}
