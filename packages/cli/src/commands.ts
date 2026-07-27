import { CommandHandler, getPackageJson, Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { cosmologyCommand } from './commands/cosmology';
import { decryptCommand, encryptCommand } from './commands/encrypt';
import { keychainCommand } from './commands/keychain';
import { keysCommand } from './commands/keys';
import { saltCommand } from './commands/salt';
import { secretsCommand } from './commands/secrets';
import { shamirCommand } from './commands/shamir';
import { vaultCommand } from './commands/vault';
import { walletCommand } from './commands/wallet';
import { Handler, takeFirst } from './utils/dispatch';
import { envUsage } from './utils/env';
import { exitCodeFor, messageFor } from './utils/errors';

export const usageText = `
dcrypt — local-first encryption, wallets and team secrets

Usage:
  dcrypt <command> [subcommand] [OPTIONS]

Commands:
  encrypt                 Encrypt data with a passphrase
  decrypt                 Decrypt data with a passphrase
  wallet                  Create BIP39 wallets and derive addresses (offline)
  keys                    Manage your X25519 identity
  secrets                 Team secrets files (.env generation, recipients, rekeying)
  vault                   The local encrypted vault, shared with the desktop app
  keychain                Store named secrets locally, always encrypted
  shamir                  Split and recombine a secret into authenticated shares
  salt                    Two-layer encryption: data under a salt, salt under your passphrase
  cosmology               Read and upgrade data written by the cosmology CLI

Global options:
  --json                  Machine-readable output where supported
  --in <file> / --out     Read input from, and write output to, files ("-" is stdin)
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --version, -v           Print the version
  --help, -h              Show this help; "dcrypt <command> --help" for a command

Nothing in dcrypt makes a network request, and passphrases are never accepted in argv.
${envUsage}
Exit codes:
  1 usage    2 wrong passphrase    3 corrupt input    4 not found    5 not a recipient
`;

export const createCommandMap = (): Record<string, Handler> => ({
  encrypt: encryptCommand,
  decrypt: decryptCommand,
  wallet: walletCommand,
  keys: keysCommand,
  secrets: secretsCommand,
  vault: vaultCommand,
  keychain: keychainCommand,
  shamir: shamirCommand,
  salt: saltCommand,
  cosmology: cosmologyCommand,
});

/** Runs one command and maps thrown errors onto exit codes; used by the bin and by tests. */
export const dispatch = async (argv: ParsedArgs, prompter: Inquirerer): Promise<number> => {
  const commandMap = createCommandMap();
  let { first: command, newArgv } = takeFirst(argv);

  if (command === 'help' || (!command && (argv.help || argv.h))) {
    process.stdout.write(usageText);
    return 0;
  }
  if (!command) {
    const answer = await prompter.prompt(newArgv, [
      {
        type: 'autocomplete',
        name: 'command',
        message: 'What do you want to do?',
        options: Object.keys(commandMap),
      },
    ]);
    command = answer.command as string;
  }

  const handler = commandMap[command];
  if (!handler) {
    process.stdout.write(usageText);
    process.stderr.write(`Error: unknown command: ${command}\n`);
    return 1;
  }

  try {
    await handler(newArgv, prompter);
    return 0;
  } catch (error) {
    process.stderr.write(`Error: ${messageFor(error)}\n`);
    return exitCodeFor(error);
  }
};

export const commands: CommandHandler = async (argv, prompter, _options) => {
  if (argv.version || argv.v) {
    process.stdout.write(`${getPackageJson(__dirname).version}\n`);
    return;
  }
  const code = await dispatch(argv, prompter);
  prompter.close();
  if (code !== 0) process.exit(code);
};
