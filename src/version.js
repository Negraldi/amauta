import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function packageVersion() {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}
