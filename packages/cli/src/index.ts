#!/usr/bin/env node
import { CLI, CLIOptions, getPackageJson } from 'inquirerer';

import { commands } from './commands';

export * from './commands';
export * from './utils/bytes';
export * from './utils/dispatch';
export * from './utils/errors';
export * from './utils/io';
export * from './utils/passphrase';
export * from './utils/recipients';
export * from './utils/stash';
export * from './utils/temp';

export const options: Partial<CLIOptions> = {
  minimistOpts: {
    alias: { v: 'version', h: 'help' },
    // everything after `--` belongs to `dcrypt secrets run`
    '--': true,
    string: [
      'in',
      'out',
      'passphrase-file',
      'salt-file',
      'aad',
      'vault',
      'file',
      'format',
      'kdf',
      'recipient',
      'recipients-file',
      'workspace',
    ],
    // declared so that a flag never takes the positional after it as its value:
    // `dcrypt encrypt --binary "some text"`, `dcrypt decrypt-workspace --force finance`
    boolean: ['binary', 'force', 'json', 'staged', 'all'],
  },
};

/**
 * Runs `dcrypt` with this process's arguments. The `decryption` package's `dcrypt` command calls
 * this, so `npm install -g decryption` and `npm install -g @decryption/cli` behave the same.
 */
export async function main(): Promise<void> {
  const app = new CLI(commands, {
    ...options,
    // The prompter attaches a line reader to stdin as soon as it is constructed. When stdin is a
    // pipe or a file it is data (or nothing), never a keyboard: a reader there would take bytes
    // away from `--in -`, and a prompt would read the data as its answer.
    noTty: !process.stdin.isTTY,
    version: `dcrypt@${getPackageJson(__dirname).version}`,
  });
  try {
    await app.run();
  } catch (error: unknown) {
    process.stderr.write(`Unexpected error: ${String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
