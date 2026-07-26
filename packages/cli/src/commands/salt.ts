import { base64 } from '@decryption/base';
import { decryptFromString, encryptToString } from '@decryption/core';
import { randomBytes } from '@decryption/hashes/utils';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { CliError, EXIT } from '../utils/errors';
import { emit, readInput, writeOutput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { readJson, writeJson } from '../utils/stash';
import { resolveKdf } from './encrypt';

export const saltUsage = `
Salt Command:

  dcrypt salt <subcommand> [OPTIONS]

  Two-layer encryption, the modern replacement for the old salt-encrypt/salt-decrypt
  flow: a random high-entropy salt encrypts the data, and your passphrase encrypts
  the salt. Rotating the passphrase then only re-encrypts the salt, not the data.

Subcommands:
  generate                Print a fresh random salt
  encrypt                 Encrypt data under a new salt, and the salt under your passphrase
  decrypt                 Unwrap the salt, then the data

Options:
  --bytes <n>             Salt size for "generate"        (default: 32)
  --kdf <profile>         interactive | moderate | sensitive  (default: moderate)
  --in <file>             Read the plaintext/ciphertext from a file ("-" for stdin)
  --salt-file <file>      Where the encrypted salt lives  (default: alongside --out)
  --out <file>            Write output to a file
  --json                  Machine-readable output (both layers in one object)
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --help, -h              Show this help message

Examples:
  dcrypt salt generate
  dcrypt salt encrypt --in secrets.txt --out secrets.dcrypt --salt-file secrets.salt
  dcrypt salt decrypt --in secrets.dcrypt --salt-file secrets.salt
`;

interface SaltBundle {
  dcrypt: 1;
  salt: string;
  ciphertext: string;
}

const generate = (argv: ParsedArgs): void => {
  const bytes = Number(argv.bytes ?? 32);
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128) {
    throw new CliError('--bytes must be an integer between 16 and 128');
  }
  const salt = base64.encode(randomBytes(bytes));
  emit(argv, { salt }, () => salt);
};

const encryptCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const plaintext = readInput(newArgv, first);
  const passphrase = await resolvePassphrase(newArgv, prompter, { confirm: true });

  const saltBytes = randomBytes(32);
  const salt = base64.encode(saltBytes);
  const bundle: SaltBundle = {
    dcrypt: 1,
    salt: encryptToString(salt, passphrase, { aad: 'dcrypt-salt', kdf: resolveKdf(newArgv.kdf) }),
    ciphertext: encryptToString(plaintext, salt, {
      aad: 'dcrypt-salt-payload',
      kdf: resolveKdf(newArgv.kdf),
    }),
  };
  saltBytes.fill(0);

  const saltFile = saltFileOf(newArgv);
  if (saltFile) {
    writeJson(saltFile, { dcrypt: 1, salt: bundle.salt });
    writeOutput(newArgv, bundle.ciphertext);
    return;
  }
  emit(newArgv, bundle, () => JSON.stringify(bundle, null, 2));
};

const decryptCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const bundle = loadBundle(newArgv, first);
  const passphrase = await resolvePassphrase(newArgv, prompter);
  const salt = decryptFromString(bundle.salt, passphrase, { aad: 'dcrypt-salt' });
  writeOutput(newArgv, decryptFromString(bundle.ciphertext, salt, { aad: 'dcrypt-salt-payload' }));
};

const loadBundle = (argv: ParsedArgs, inline?: string): SaltBundle => {
  const saltFile = saltFileOf(argv);
  const input = readInput(argv, inline).trim();
  if (saltFile) {
    const { salt } = readJson<{ salt?: string }>(saltFile);
    if (!salt) throw new CliError(`${saltFile} does not contain an encrypted salt`, EXIT.corrupt);
    return { dcrypt: 1, salt, ciphertext: input };
  }
  let parsed: Partial<SaltBundle>;
  try {
    parsed = JSON.parse(input) as Partial<SaltBundle>;
  } catch {
    throw new CliError('expected a salt bundle as JSON, or pass --salt-file', EXIT.corrupt);
  }
  if (!parsed.salt || !parsed.ciphertext) {
    throw new CliError('salt bundle must have "salt" and "ciphertext"', EXIT.corrupt);
  }
  return { dcrypt: 1, salt: parsed.salt, ciphertext: parsed.ciphertext };
};

const saltFileOf = (argv: ParsedArgs): string | undefined => {
  const value = argv['salt-file'] ?? argv.saltFile;
  return typeof value === 'string' && value.length ? value : undefined;
};

export const saltCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  await runSubcommand(argv, prompter, {
    name: 'salt',
    usage: saltUsage,
    handlers: { generate, encrypt: encryptCmd, decrypt: decryptCmd },
  });
};
