import {
  armor,
  decryptFromString,
  encrypt,
  KDF_PROFILES,
  KdfParams,
  KdfProfile,
} from '@decryption/core';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { takeFirst } from '../utils/dispatch';
import { CliError } from '../utils/errors';
import { readInput, writeOutput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';

export const encryptUsage = `
Encrypt Command:

  dcrypt encrypt [text] [OPTIONS]

  Encrypt data with a passphrase (Argon2id + XChaCha20-Poly1305).

Options:
  --in <file>             Read the plaintext from a file ("-" for stdin)
  --out <file>            Write the ciphertext to a file instead of stdout
  --kdf <profile>         interactive | moderate | sensitive   (default: moderate)
  --aad <string>          Bind the ciphertext to this associated data
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --help, -h              Show this help message

Examples:
  dcrypt encrypt "attack at dawn"
  dcrypt encrypt --in notes.txt --out notes.dcrypt --kdf sensitive
  cat notes.txt | dcrypt encrypt --in -
`;

export const decryptUsage = `
Decrypt Command:

  dcrypt decrypt [armored] [OPTIONS]

  Decrypt data produced by "dcrypt encrypt".

Options:
  --in <file>             Read the ciphertext from a file ("-" for stdin)
  --out <file>            Write the plaintext to a file instead of stdout
  --aad <string>          Associated data the ciphertext was bound to
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --help, -h              Show this help message

Exit codes:
  2  wrong passphrase or tampered ciphertext
  3  corrupt or unsupported envelope

Examples:
  dcrypt decrypt --in notes.dcrypt --out notes.txt
`;

export const encryptCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const plaintext = readInput(newArgv, first);
  const passphrase = await resolvePassphrase(newArgv, prompter, { confirm: true });
  writeOutput(newArgv, armor(encrypt(plaintext, passphrase, {
    kdf: resolveKdf(newArgv.kdf),
    aad: typeof newArgv.aad === 'string' ? newArgv.aad : undefined,
  })));
};

export const decryptCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const armored = readInput(newArgv, first).trim();
  const passphrase = await resolvePassphrase(newArgv, prompter);
  writeOutput(
    newArgv,
    decryptFromString(armored, passphrase, {
      aad: typeof newArgv.aad === 'string' ? newArgv.aad : undefined,
    })
  );
};

/**
 * Accepts a profile name, or explicit costs as `t=3,m=262144,p=1` for constrained hardware.
 * Envelopes carry their own parameters, so decryption never needs this flag.
 */
export const resolveKdf = (value: unknown): KdfProfile | KdfParams => {
  if (value === undefined) return 'moderate';
  if (typeof value !== 'string') throw unknownKdf(value);
  if (value in KDF_PROFILES) return value as KdfProfile;
  if (!/^[tmp]=\d+(,[tmp]=\d+)*$/.test(value)) throw unknownKdf(value);

  const params = { ...KDF_PROFILES.moderate } as KdfParams;
  for (const pair of value.split(',')) {
    const [name, count] = pair.split('=');
    params[name as keyof KdfParams] = Number(count);
  }
  return params;
};

const unknownKdf = (value: unknown): CliError =>
  new CliError(
    `unknown --kdf value "${String(value)}"; expected ${Object.keys(KDF_PROFILES).join(', ')}, or explicit costs like t=3,m=262144,p=1`
  );
