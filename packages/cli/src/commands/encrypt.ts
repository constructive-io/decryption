import {
  armor,
  armorFile,
  createFileDecryptor,
  createFileEncryptor,
  dearmorFile,
  decrypt,
  decryptFromString,
  encrypt,
  FILE_ARMOR_PREFIX,
  FILE_VERSION,
  FileEncryptor,
  FileHeader,
  generateFileKey,
  isPassphraseFile,
  KDF_PROFILES,
  KdfParams,
  KdfProfile,
  MAGIC,
  unwrapWithPassphrase,
  wrapWithPassphrase,
} from '@decryption/core';
import {
  createRecipientFileEncryptor,
  fileRecipients,
  fingerprint,
  NotRecipientError,
  recipientFromString,
  sealFileTo,
  unwrapWithIdentity,
} from '@decryption/keys';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import {
  assertNotTerminal,
  assertStdinFree,
  ByteReader,
  chainBytes,
  openInput,
  transformBytes,
  writeBytes,
  writeText,
} from '../utils/bytes';
import { takeFirst, wantsHelp } from '../utils/dispatch';
import { CliError } from '../utils/errors';
import { readFileHeader } from '../utils/header';
import { resolvePassphrase } from '../utils/passphrase';
import { collectRecipients } from '../utils/recipients';
import { loadIdentity, readStoredIdentity } from '../utils/stash';

export const encryptUsage = `
Encrypt Command:

  dcrypt encrypt [text] [OPTIONS]

  Encrypt data with a passphrase, or to one or more X25519 recipients.

  With no format options the output is a small armored envelope (Argon2id +
  XChaCha20-Poly1305), held in memory: right for short secrets you paste around.

  --binary and --recipient select the file format instead: a binary envelope
  whose payload is encrypted in 64 KiB chunks, so files of any size are
  streamed rather than loaded. With --recipient no passphrase is asked for;
  whoever holds a matching identity ("dcrypt keys generate") can decrypt.

Options:
  --in <file>             Read the plaintext from a file ("-" for stdin)
  --out <file>            Write the ciphertext to a file instead of stdout
  --binary                Write the binary file format (streamed, for large files)
  --recipient <key>       Encrypt to this dcrypt1… public key; repeat for several
  --recipients-file <p>   Encrypt to every key in a file (one per line, # comments)
  --kdf <profile>         interactive | moderate | sensitive   (default: moderate)
  --aad <string>          Bind the ciphertext to this associated data
                          (armored passphrase envelopes only)
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --help, -h              Show this help message

  --recipient without --binary writes the same file format as text
  ("dcrypt.v2.…"), buffered in memory: convenient for small values.

Examples:
  dcrypt encrypt "attack at dawn"
  dcrypt encrypt --in notes.txt --out notes.dcrypt --kdf sensitive
  cat notes.txt | dcrypt encrypt --in -
  dcrypt encrypt --binary --in backup.tar --out backup.tar.dcrypt
  dcrypt encrypt --binary --recipient dcrypt1… --recipient dcrypt1… \\
    --in backup.tar --out backup.tar.dcrypt
`;

export const decryptUsage = `
Decrypt Command:

  dcrypt decrypt [armored] [OPTIONS]

  Decrypt data produced by "dcrypt encrypt". The format is detected from the
  input. A file encrypted to recipients is opened with your stored identity,
  and the passphrase asked for is the one that protects that identity.

Options:
  --in <file>             Read the ciphertext from a file ("-" for stdin)
  --out <file>            Write the plaintext to a file instead of stdout
  --aad <string>          Associated data the ciphertext was bound to
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --help, -h              Show this help message

  With --out the plaintext is written to a temporary file and renamed into
  place only after the whole input has authenticated: a wrong passphrase, a
  truncated or modified file, or an interrupt leaves --out untouched. On stdout,
  large files are streamed, so check the exit code before trusting the output.

Exit codes:
  2  wrong passphrase or tampered ciphertext
  3  corrupt, truncated or unsupported envelope
  4  no identity on this machine
  5  your identity is not a recipient

Examples:
  dcrypt decrypt --in notes.dcrypt --out notes.txt
  dcrypt decrypt --in backup.tar.dcrypt --out backup.tar
`;

const aadOf = (argv: ParsedArgs): string | undefined =>
  typeof argv.aad === 'string' ? argv.aad : undefined;

export const encryptCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  if (wantsHelp(argv, encryptUsage)) return;
  const { first, newArgv } = takeFirst(argv);
  const recipients = collectRecipients(newArgv);
  const binary = Boolean(newArgv.binary);

  if (binary || recipients.length) {
    await encryptFileFormat(newArgv, prompter, first, recipients, binary);
    return;
  }

  // The original format: one armored envelope, unchanged.
  const input = await openInput(newArgv, first);
  let plaintext: Uint8Array;
  try {
    assertStdinFree(newArgv, input);
    plaintext = await new ByteReader(input.stream).all();
  } finally {
    input.close();
  }
  const passphrase = await resolvePassphrase(newArgv, prompter, { confirm: true });
  const envelope = encrypt(plaintext, passphrase, {
    kdf: resolveKdf(newArgv.kdf),
    aad: aadOf(newArgv),
  });
  await writeText(newArgv, armor(envelope));
};

const encryptFileFormat = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  inline: string | undefined,
  recipients: string[],
  binary: boolean
): Promise<void> => {
  if (argv.aad !== undefined) {
    throw new CliError(
      '--aad is only supported by the armored passphrase envelope; drop --aad, or drop --binary and --recipient'
    );
  }
  assertNotTerminal(argv, { binary });

  const input = await openInput(argv, inline);
  try {
    if (!binary) {
      // Text form of the same file, for small values: buffered, because base64 is not streamed.
      const plaintext = await new ByteReader(input.stream).all();
      await writeText(argv, armorFile(sealFileTo(plaintext, recipients)));
      return;
    }
    if (!recipients.length) assertStdinFree(argv, input);
    const { header, stream } = recipients.length
      ? createRecipientFileEncryptor(recipients)
      : await passphraseFileEncryptor(argv, prompter);
    try {
      await writeBytes(argv, chainBytes([header], transformBytes(input.stream, stream)), { binary });
    } finally {
      stream.destroy();
    }
  } finally {
    input.close();
  }
};

const passphraseFileEncryptor = async (
  argv: ParsedArgs,
  prompter: Inquirerer
): Promise<FileEncryptor> => {
  const kdf = resolveKdf(argv.kdf);
  const passphrase = await resolvePassphrase(argv, prompter, { confirm: true });
  const fileKey = generateFileKey();
  try {
    return createFileEncryptor(fileKey, [wrapWithPassphrase(fileKey, passphrase, kdf)]);
  } finally {
    fileKey.fill(0);
  }
};

const startsWithMagic = (bytes: Uint8Array): boolean =>
  bytes.length > MAGIC.length && MAGIC.every((byte, index) => bytes[index] === byte);

export const decryptCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  if (wantsHelp(argv, decryptUsage)) return;
  const { first, newArgv } = takeFirst(argv);
  const input = await openInput(newArgv, first);
  try {
    assertStdinFree(newArgv, input);
    const reader = new ByteReader(input.stream);
    const head = await reader.fill(MAGIC.length + 1);

    if (startsWithMagic(head)) {
      if (head[MAGIC.length] === FILE_VERSION) {
        await decryptFileFormat(newArgv, prompter, reader);
        return;
      }
      // A version 1 envelope that was never armored. Small by construction: read it whole.
      const envelope = await reader.all();
      const passphrase = await resolvePassphrase(newArgv, prompter);
      await writeBytes(newArgv, [decrypt(envelope, passphrase, { aad: aadOf(newArgv) })]);
      return;
    }

    const text = (await reader.all()).toString('utf8').trim();
    if (text.startsWith(FILE_ARMOR_PREFIX)) {
      await decryptFileFormat(newArgv, prompter, new ByteReader([dearmorFile(text)]));
      return;
    }
    const passphrase = await resolvePassphrase(newArgv, prompter);
    await writeText(newArgv, decryptFromString(text, passphrase, { aad: aadOf(newArgv) }));
  } finally {
    input.close();
  }
};

/**
 * Recovers the file key. Nothing has been written anywhere yet when this runs, so a wrong
 * passphrase or a missing recipient fails before any output exists.
 */
const unlockFileKey = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  header: FileHeader
): Promise<Uint8Array> => {
  if (isPassphraseFile(header)) {
    return unwrapWithPassphrase(header, await resolvePassphrase(argv, prompter));
  }

  // The stored recipient is public, so "not for you" needs no passphrase to find out.
  const mine = fingerprint(recipientFromString(readStoredIdentity().recipient));
  const recipients = fileRecipients(header);
  if (!recipients.includes(mine)) {
    throw new NotRecipientError(
      `this identity (${mine}) is not a recipient; recipients are ${recipients.join(', ') || 'none'}`
    );
  }
  const identity = loadIdentity(
    await resolvePassphrase(argv, prompter, { message: 'Identity passphrase' })
  );
  try {
    return unwrapWithIdentity(header, identity);
  } finally {
    identity.privateKey.fill(0);
  }
};

const decryptFileFormat = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  reader: ByteReader
): Promise<void> => {
  if (argv.aad !== undefined) {
    throw new CliError('--aad does not apply here: this file format carries no associated data');
  }
  const header = await readFileHeader(reader);
  const fileKey = await unlockFileKey(argv, prompter, header);
  let decryptor;
  try {
    // Checks the header MAC: a header that was edited is rejected before any payload is read.
    decryptor = createFileDecryptor(header, fileKey);
  } finally {
    fileKey.fill(0);
  }
  try {
    await writeBytes(argv, transformBytes(reader.rest(), decryptor));
  } finally {
    decryptor.destroy();
  }
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
