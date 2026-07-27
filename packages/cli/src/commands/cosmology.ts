import { armor, encrypt } from '@decryption/core';
import {
  crypt as compatEncrypt,
  decrypt as compatDecrypt,
  decryptWithEncryptedSalt,
  encryptWithEncryptedSalt,
} from '@decryption/cosmology-compat';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { fromEnv } from '../utils/env';
import { CliError } from '../utils/errors';
import { readInput, writeOutput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { resolveKdf } from './encrypt';

export const cosmologyUsage = `
Cosmology Command:

  dcrypt cosmology <subcommand> [OPTIONS]

  Read and write data in the cosmology CLI's format (CryptoJS AES). That format
  is unauthenticated and derives its key with a single round of MD5 — prefer
  "dcrypt encrypt" for anything new, and use "upgrade" to migrate old data.

Subcommands:
  decrypt                 Decrypt an old blob and print the plaintext
  encrypt                 Encrypt in the old format, for tools that still read it
  upgrade                 Decrypt an old blob and re-encrypt it with a new passphrase

Options:
  --in <file>             Read the ciphertext from a file ("-" for stdin)
  --out <file>            Write output to a file
  --salt-file <file>      Read the old salt from a file (avoids putting it in argv)
  --encrypted-salt <s>    The two-layer scheme's encrypted salt
  --passphrase-file <p>   New passphrase, for "upgrade"
  --passphrase-stdin      Read the new passphrase from stdin
  --help, -h              Show this help message

Environment:
  SALT, ENCRYPTED_SALT    The cosmology CLI's own variables, still honoured

Examples:
  dcrypt cosmology decrypt --in old.txt --salt-file salt.txt
  SALT=... dcrypt cosmology decrypt --in old.txt
  dcrypt cosmology encrypt --in plain.txt --salt-file salt.txt --out old.txt
  dcrypt cosmology upgrade --in old.txt --salt-file salt.txt --out new.dcrypt
`;

const readSalt = async (argv: ParsedArgs, prompter: Inquirerer): Promise<string> => {
  const file = argv['salt-file'] ?? argv.saltFile;
  if (typeof file === 'string' && file.length) {
    return readInput({ ...argv, in: file } as ParsedArgs).trim();
  }
  if (argv.salt !== undefined) {
    throw new CliError(
      'refusing to read the old salt from argv (it is visible in `ps`); use --salt-file <path> or SALT'
    );
  }
  const envSalt = fromEnv('salt');
  if (envSalt !== undefined) return envSalt.trim();
  const { salt } = await prompter.prompt<{ salt: string }>({} as { salt: string }, [
    { type: 'password', name: 'salt', message: 'Legacy salt', required: true },
  ]);
  return String(salt);
};

const readLegacyPlaintext = async (argv: ParsedArgs, prompter: Inquirerer): Promise<string> => {
  const { first, newArgv } = takeFirst(argv);
  const ciphertext = readInput(newArgv, first).trim();
  const salt = await readSalt(newArgv, prompter);
  const encryptedSalt =
    newArgv['encrypted-salt'] ?? newArgv.encryptedSalt ?? fromEnv('encryptedSalt');
  return typeof encryptedSalt === 'string' && encryptedSalt.length
    ? decryptWithEncryptedSalt(salt, encryptedSalt, ciphertext)
    : compatDecrypt(salt, ciphertext);
};

const decryptCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  writeOutput(argv, await readLegacyPlaintext(argv, prompter));
};

const encryptCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const plaintext = readInput(newArgv, first);
  const salt = await readSalt(newArgv, prompter);
  const encryptedSalt =
    newArgv['encrypted-salt'] ?? newArgv.encryptedSalt ?? fromEnv('encryptedSalt');
  const ciphertext =
    typeof encryptedSalt === 'string' && encryptedSalt.length
      ? encryptWithEncryptedSalt(salt, encryptedSalt, plaintext)
      : compatEncrypt(salt, plaintext);
  writeOutput(newArgv, ciphertext);
};

const upgrade = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const plaintext = await readLegacyPlaintext(argv, prompter);
  const passphrase = await resolvePassphrase(argv, prompter, {
    confirm: true,
    message: 'New passphrase',
  });
  writeOutput(argv, armor(encrypt(plaintext, passphrase, { kdf: resolveKdf(argv.kdf) })));
};

export const cosmologyCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  await runSubcommand(argv, prompter, {
    name: 'cosmology',
    usage: cosmologyUsage,
    handlers: { decrypt: decryptCmd, encrypt: encryptCmd, upgrade },
  });
};
