import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

/** Temp git repo with helpers. files: {relpath: content}. */
export async function makeRepo(files = { 'README.md': '# x\n' }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gl-repo-'));
  git(dir, 'init', '-q', '-b', 'main');
  const repo = {
    dir,
    write: async (rel, content, mode) => {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), content);
      if (mode) await chmod(path.join(dir, rel), mode);
    },
    commit: (msg = 'c') => {
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', msg);
      return git(dir, 'rev-parse', 'HEAD').trim();
    },
  };
  for (const [rel, content] of Object.entries(files)) await repo.write(rel, content);
  repo.commit('init');
  return repo;
}
