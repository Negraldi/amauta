import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// node:test runs each test file in its own process, so removing on process exit cleans up after every test in the file.
const made = new Set();
process.on('exit', () => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** mkdtemp under the OS temp dir; removed when the test process exits. */
export async function tempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}

/** Synchronous tempDir. */
export function tempDirSync(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}
