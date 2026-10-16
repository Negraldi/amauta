import path from 'node:path';
import { assetPath, listFiles, readAssetText } from './assets.js';
import { renderAgent, resolveAssignment } from './templating.js';
import { sddCommand } from './servers.js';

const posix = (rel) => rel.split(path.sep).join('/');

/** Fill the placeholders of an SDD markdown asset. */
export const renderSddText = (text) => text.replaceAll('{{AMAUTA_SDD}}', sddCommand());

/** Managed files (relative posix path -> Buffer) of the optional SDD module. */
export async function renderSddFiles(manifest, { assignments, engramPrefix, footers }) {
  const sdd = manifest.sdd;
  const files = new Map();
  const addTree = async (srcDir, destPrefix) => {
    for (const rel of await listFiles(assetPath(srcDir))) {
      const p = posix(rel);
      files.set(`${destPrefix}/${p}`, Buffer.from(renderSddText(await readAssetText(`${srcDir}/${p}`)), 'utf8'));
    }
  };
  for (const skill of sdd.skills) await addTree(`${sdd.skillsDir}/${skill}`, `skills/${skill}`);
  await addTree(sdd.sharedDir, 'skills/_shared');
  await addTree(sdd.commandsDir, 'commands');
  for (const agent of sdd.agents) {
    const template = await readAssetText(`${sdd.agentsDir}/${agent.name}.md`);
    const text = renderAgent(template, { assignment: resolveAssignment(assignments, agent.modelKey), engramPrefix, footers });
    files.set(`agents/${agent.name}.md`, Buffer.from(text, 'utf8'));
  }
  return files;
}
