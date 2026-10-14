import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const assetsRoot = path.join(repoRoot, 'assets');

export const assetPath = (rel) => path.join(assetsRoot, rel);
export const readAssetText = (rel) => readFile(assetPath(rel), 'utf8');
export const readAssetBuffer = (rel) => readFile(assetPath(rel));
export const loadManifest = async () => JSON.parse(await readAssetText('manifest.json'));

/** Relative file paths under `dir`, recursive and sorted. */
export async function listFiles(dir) {
  const out = [];
  async function walk(d, prefix) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const rel = path.join(prefix, e.name);
      if (e.isDirectory()) await walk(path.join(d, e.name), rel);
      else out.push(rel);
    }
  }
  await walk(dir, '');
  return out.sort();
}
