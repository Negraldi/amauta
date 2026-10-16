import path from 'node:path';
import { assetPath, listFiles, readAssetBuffer } from './assets.js';

const posix = (rel) => rel.split(path.sep).join('/');

/** Skill files (relative posix path -> Buffer), copied byte for byte: archify needs no install-time rendering and no npm engine. */
export async function renderArchifyFiles(manifest) {
  const { skillDir } = manifest.archify;
  const files = new Map();
  for (const rel of await listFiles(assetPath(skillDir))) {
    const p = posix(rel);
    files.set(`skills/archify/${p}`, await readAssetBuffer(`${skillDir}/${p}`));
  }
  return files;
}

/** Path of the installed CLI, the file `amauta status` checks and the portal runs. */
export const archifyCli = (claudeHome) => path.join(claudeHome, 'skills', 'archify', 'bin', 'archify.mjs');
