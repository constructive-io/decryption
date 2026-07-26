import { armor, encrypt } from '@decryption/core';
import { decrypt as legacyDecrypt, decryptWithEncryptedSalt } from '@decryption/legacy';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { CliError } from '../utils/errors';
import { readInput, writeOutput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { resolveKdf } from './encrypt';

export const legacyUsage = `
Legacy Command:

  dcrypt legacy <subcommand> [OPTIONS]

  Read data written by the old encryption demo and @cosmology/core (CryptoJS AES).
  That format is unauthenticated and derives its key with a single round of MD5 —
  use "upgrade" to move it onto the modern format as soon as you can.

Subcommands:
  decrypt                 Decrypt an old blob and print the plaintext
  upgrade                 Decrypt an old blob and re-encrypt it with a new passphrase

Options:
  --in <file>             Read the ciphertext from a file ("-" for stdin)
  --out <file>            Write output to a file
  --salt-file <file>      Read the old salt from a file (avoids putting it in argv)
  --encrypted-salt <s>    The two-layer scheme's encrypted salt
  --passphrase-file <p>   New passphrase, for "upgrade"
  --passphrase-stdin      Read the new passphrase from stdin
  --help, -h              Show this help message

Examples:
  dcrypt legacy decrypt --in old.txt --salt-file salt.txt
  dcrypt legacy upgrade --in old.txt --salt-file salt.txt --out new.dcrypt
`;

const readSalt = async (argv: ParsedArgs, prompter: Inquirerer): Promise<string> => {
  const file = argv['salt-file'] ?? argv.saltFile;
  if (typeof file === 'string' && file.length) {
    return readInput({ ...argv, in: file } as ParsedArgs).trim();
  }
  if (argv.salt !== undefined) {
    throw new CliError(
      'refusing to read the old salt from argv (it is visible in `ps`); use --salt-file <path>'
    );
  }
  const { salt } = await prompter.prompt<{ salt: string }>({} as { salt: string }, [
    { type: 'password', name: 'salt', message: 'Legacy salt', required: true },
  ]);
  return String(salt);
};

const readLegacyPlaintext = async (argv: ParsedArgs, prompter: Inquirerer): Promise<string> => {
  const { first, newArgv } = takeFirst(argv);
  const ciphertext = readInput(newArgv, first).trim();
  const salt = await readSalt(newArgv, prompter);
  const encryptedSalt = newArgv['encrypted-salt'] ?? newArgv.encryptedSalt;
  return typeof encryptedSalt === 'string' && encryptedSalt.length
    ? decryptWithEncryptedSalt(salt, encryptedSalt, ciphertext)
    : legacyDecrypt(salt, ciphertext);
};

const decryptCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  writeOutput(argv, await readLegacyPlaintext(argv, prompter));
};

const upgrade = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const plaintext = await readLegacyPlaintext(argv, prompter);
  const passphrase = await resolvePassphrase(argv, prompter, {
    confirm: true,
    message: 'New passphrase',
  });
  writeOutput(argv, armor(encrypt(plaintext, passphrase, { kdf: resolveKdf(argv.kdf) })));
};

export const legacyCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  await runSubcommand(argv, prompter, {
    name: 'legacy',
    usage: legacyUsage,
    handlers: { decrypt: decryptCmd, upgrade },
  });
};
