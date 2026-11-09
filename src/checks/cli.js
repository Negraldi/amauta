/**
 * `amauta check trust|untrust|status [--cwd DIR] [--state-dir DIR]` (plan D6): allow or stop the project checkers that
 * execute repository code in one project, and show which checkers apply there. Side effects: the trust file only.
 */
import { parseArgs } from 'node:util';
import { resolveTargets } from '../install/paths.js';
import { PROJECT_CHECKERS } from './project.js';
import { isTrusted, projectRoot, setTrust } from './trust.js';

const NAMES = PROJECT_CHECKERS.map((c) => c.name).join(', ');

async function runCheck(args, io) {
  let values;
  let sub;
  try {
    const options = { cwd: { type: 'string' }, 'state-dir': { type: 'string' } };
    ({ values, positionals: [sub] } = parseArgs({ args, options, allowPositionals: true }));
  } catch (err) {
    io.stderr.write(`amauta: ${err.message}\n`);
    return 2;
  }
  const cwd = values.cwd ?? process.cwd();
  const { stateDir } = resolveTargets({ stateDir: values['state-dir'] });
  if (!['trust', 'untrust', 'status'].includes(sub)) {
    io.stderr.write('usage: amauta check trust|untrust|status [--cwd DIR] [--state-dir DIR]\n');
    return 2;
  }
  const root = await projectRoot(cwd);
  if (!root) {
    io.stderr.write(`amauta check: ${cwd} is not inside a git repository\n`);
    return 1;
  }
  if (sub === 'status') {
    const trusted = (await isTrusted(stateDir, root)) ? 'yes' : 'no';
    io.stdout.write(`${root}\ntrusted: ${trusted}\nproject checkers: ${NAMES} (when installed and configured)\n`);
    return 0;
  }
  await setTrust(stateDir, root, sub === 'trust');
  io.stdout.write(sub === 'trust'
    ? `trusted ${root}: at Stop amauta may now run ${NAMES} here (they execute this project's code)\n`
    : `no longer trusted: ${root}\n`);
  return 0;
}

export function registerCheckCommands(commands) {
  commands.set('check', { summary: 'Allow the code-executing project checkers in one project (trust, untrust, status)', run: runCheck });
}
