#!/usr/bin/env node
import { CLI, CLIOptions, getPackageJson } from 'inquirerer';

import { commands } from './commands';

export * from './commands';
export * from './utils/dispatch';
export * from './utils/errors';
export * from './utils/io';
export * from './utils/passphrase';
export * from './utils/stash';

export const options: Partial<CLIOptions> = {
  minimistOpts: {
    alias: { v: 'version', h: 'help' },
    // everything after `--` belongs to `dcrypt secrets run`
    '--': true,
    string: ['in', 'out', 'passphrase-file', 'salt-file', 'aad', 'vault', 'file', 'format'],
  },
};

if (require.main === module) {
  const app = new CLI(commands, {
    ...options,
    version: `dcrypt@${getPackageJson(__dirname).version}`,
  });
  app.run().catch((error: unknown) => {
    process.stderr.write(`Unexpected error: ${String(error)}\n`);
    process.exit(1);
  });
}
