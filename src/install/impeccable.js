import { execFile } from 'node:child_process';
import { readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { assetPath, listFiles, readAssetBuffer } from './assets.js';
import { findOnPath } from '../codegraph/index.js';
import { shellQuote } from './servers.js';

const posix = (rel) => rel.split(path.sep).join('/');
const NPM_TIMEOUT_MS = 5 * 60 * 1000;

/** Where the pinned npm engine lives and the CLI inside it. */
export const enginePaths = (stateDir) => {
  const dir = path.join(stateDir, 'impeccable');
  return { dir, cli: path.join(dir, 'node_modules', 'impeccable', 'cli', 'bin', 'cli.js'), pkg: path.join(dir, 'node_modules', 'impeccable', 'package.json') };
};

/** Skill files (relative posix path -> Buffer); markdown gets the install-time paths, scripts stay byte for byte. */
export async function renderImpeccableFiles(manifest, { stateDir }) {
  const { skillDir } = manifest.impeccable;
  const dir = shellQuote(path.join(stateDir, 'skills', 'impeccable')); // the amauta skill store, reached through both runtimes' links
  const cli = `node ${shellQuote(enginePaths(stateDir).cli)}`;
  const files = new Map();
  for (const rel of await listFiles(assetPath(skillDir))) {
    const p = posix(rel);
    let buf = await readAssetBuffer(`${skillDir}/${p}`);
    if (p.endsWith('.md')) {
      buf = Buffer.from(buf.toString('utf8').replaceAll('{{AMAUTA_IMPECCABLE_DIR}}', dir).replaceAll('{{AMAUTA_IMPECCABLE_CLI}}', cli), 'utf8');
    }
    files.set(`skills/impeccable/${p}`, buf);
  }
  return files;
}

/** Installed engine version, or null when the package is missing or unreadable. */
export async function engineVersion(stateDir) {
  try {
    const v = JSON.parse(await readFile(enginePaths(stateDir).pkg, 'utf8')).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

const run = (file, args, options) =>
  new Promise((resolve) => {
    execFile(file, args, { ...options, encoding: 'utf8', timeout: NPM_TIMEOUT_MS }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });

/**
 * Install the pinned engine unless that exact version is already in place. No optional dependencies (puppeteer) and no
 * install scripts. Never throws: the outcome is `{ engine: 'present' | 'installed' | 'failed', version?, detail? }`.
 */
export async function ensureEngine({ stateDir, version, searchPath }) {
  const have = await engineVersion(stateDir);
  if (have === version) return { engine: 'present', version };
  const npm = await findOnPath('npm', searchPath);
  if (!npm) return { engine: 'failed', detail: 'npm not found on PATH' };
  const { dir } = enginePaths(stateDir);
  await mkdir(dir, { recursive: true });
  const args = ['install', '--prefix', dir, `impeccable@${version}`, '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'];
  const { error, stderr } = await run(npm, args, { cwd: dir });
  if (error) return { engine: 'failed', detail: (stderr || error.message).trim().split('\n').slice(-3).join(' | ') };
  const got = await engineVersion(stateDir);
  if (got !== version) return { engine: 'failed', detail: `npm finished but impeccable ${got ?? 'is missing'} (expected ${version})` };
  return { engine: 'installed', version };
}

export const removeEngine = (stateDir) => rm(enginePaths(stateDir).dir, { recursive: true, force: true });
