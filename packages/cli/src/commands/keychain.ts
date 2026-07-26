import { decryptFromString, encryptToString } from '@decryption/core';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { CliError, EXIT } from '../utils/errors';
import { emit, readInput, writeOutput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { keychainPath, readKeychain, writeKeychain } from '../utils/stash';
import { resolveKdf } from './encrypt';

export const keychainUsage = `
Keychain Command:

  dcrypt keychain <subcommand> [name] [OPTIONS]

  Store named secrets locally, each encrypted under your passphrase. Values are
  always encrypted — there is no plaintext mode.

Subcommands:
  set <name>              Store a value
  get <name>              Print a value
  del <name>              Remove a value
  list                    List entry names (no values)

Options:
  --in <file>             Read the value from a file ("-" for stdin)
  --out <file>            Write the value to a file instead of stdout
  --kdf <profile>         interactive | moderate | sensitive   (default: moderate)
  --json                  Machine-readable output
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --help, -h              Show this help message

Examples:
  dcrypt keychain set github-token --in token.txt
  dcrypt keychain get github-token --out token.txt
  dcrypt keychain list
`;

const nameFrom = (argv: ParsedArgs): { name: string; newArgv: ParsedArgs } => {
  const { first, newArgv } = takeFirst(argv);
  const name = first ?? (typeof argv.name === 'string' ? argv.name : undefined);
  if (!name) throw new CliError('an entry name is required');
  return { name, newArgv };
};

const set = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { name, newArgv } = nameFrom(argv);
  const { first: inline, newArgv: rest } = takeFirst(newArgv);
  const value = readInput(rest, inline);
  const passphrase = await resolvePassphrase(rest, prompter, { confirm: true });
  const keychain = readKeychain();
  keychain.entries[name] = encryptToString(value, passphrase, {
    aad: `dcrypt-keychain:${name}`,
    kdf: resolveKdf(rest.kdf),
  });
  writeKeychain(keychain);
  emit(rest, { name, path: keychainPath() }, () => `stored ${name} in ${keychainPath()}`);
};

const get = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { name, newArgv } = nameFrom(argv);
  const entry = readKeychain().entries[name];
  if (!entry) throw new CliError(`no keychain entry named ${name}`, EXIT.notFound);
  const passphrase = await resolvePassphrase(newArgv, prompter);
  writeOutput(newArgv, decryptFromString(entry, passphrase, { aad: `dcrypt-keychain:${name}` }));
};

const del = (argv: ParsedArgs): void => {
  const { name, newArgv } = nameFrom(argv);
  const keychain = readKeychain();
  if (!(name in keychain.entries)) {
    throw new CliError(`no keychain entry named ${name}`, EXIT.notFound);
  }
  delete keychain.entries[name];
  writeKeychain(keychain);
  emit(newArgv, { name, deleted: true }, () => `removed ${name}`);
};

const list = (argv: ParsedArgs): void => {
  const names = Object.keys(readKeychain().entries).sort();
  emit(argv, { entries: names }, () => names.join('\n'));
};

export const keychainCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  await runSubcommand(argv, prompter, {
    name: 'keychain',
    usage: keychainUsage,
    handlers: { set, get, del, list },
  });
};
