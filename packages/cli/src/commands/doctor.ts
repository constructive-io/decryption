import { ParsedArgs } from 'minimist';

import { wantsHelp } from '../utils/dispatch';
import { CliError } from '../utils/errors';
import { emit } from '../utils/io';
import { count } from '../utils/text';
import { runDoctor } from '../workspace/doctor';
import { findWorkspace } from '../workspace/layout';

export const doctorUsage = `
Doctor Command:

  dcrypt doctor [OPTIONS]

  Check this machine and this workspace: Node.js, your identity, recipients.txt,
  each section, and what git would let through. Warns when there is no recovery
  recipient. Reads only; asks for no passphrase.

  Exits 0 when nothing failed (warnings included), 1 otherwise.

Options:
  --workspace <dir>       The workspace root (default: the nearest folder upwards with a
                          recipients.txt, otherwise the current folder)
  --json                  Machine-readable output
  --help, -h              Show this help message
`;

export const doctorCommand = async (argv: ParsedArgs): Promise<void> => {
  if (wantsHelp(argv, doctorUsage)) return;
  const workspace = findWorkspace(argv);
  const checks = await runDoctor(workspace);
  const failed = checks.filter((check) => check.level === 'fail').length;
  const warned = checks.filter((check) => check.level === 'warn').length;

  emit(argv, { workspace: workspace.root, ok: failed === 0, checks }, () =>
    [
      `workspace: ${workspace.root}`,
      ...checks.map(({ level, name, message }) => `${level.padEnd(4)}  ${name}: ${message}`),
      `${failed} failed, ${count(warned, 'warning')}`,
    ].join('\n')
  );
  if (failed) throw new CliError(`doctor found ${count(failed, 'problem')}`);
};
