import {
  CorruptEnvelopeError,
  createFileDecryptor,
  createFileEncryptor,
  FileEncryptor,
  FileHeader,
  FileStanza,
  generateFileKey,
  openFile,
  sealFile,
  StanzaType,
  StreamDecryptor,
} from '@decryption/core';
import { bytesToHex, concatBytes, hexToBytes } from '@decryption/hashes/utils';

import { Identity, KeyError, NotRecipientError } from './identity';
import { normalizeRecipients, Stanza, unwrapFileKey, wrapFileKey } from './recipients';

/**
 * X25519 recipients for the version 2 file format of `@decryption/core`.
 *
 * A recipient stanza is the binary form of {@link Stanza}, produced by the same
 * {@link wrapFileKey} that `sealTo` uses:
 *
 * ```text
 * | fingerprint 8 B | ephemeral public key 32 B | wrapped file key 72 B |
 * ```
 */

const FINGERPRINT_LENGTH = 8;
const EPHEMERAL_LENGTH = 32;
const WRAPPED_LENGTH = 24 + 32 + 16;
const BODY_LENGTH = FINGERPRINT_LENGTH + EPHEMERAL_LENGTH + WRAPPED_LENGTH;

/** Wraps `fileKey` for one recipient as a file stanza. */
export const recipientStanza = (fileKey: Uint8Array, recipient: Uint8Array | string): FileStanza => {
  const stanza = wrapFileKey(fileKey, recipient);
  return {
    type: StanzaType.X25519,
    body: concatBytes(
      hexToBytes(stanza.recipient),
      hexToBytes(stanza.ephemeral),
      hexToBytes(stanza.wrapped)
    ),
  };
};

const decodeStanza = (stanza: FileStanza): Stanza => {
  if (stanza.body.length !== BODY_LENGTH) {
    throw new CorruptEnvelopeError('recipient stanza has the wrong length');
  }
  return {
    recipient: bytesToHex(stanza.body.subarray(0, FINGERPRINT_LENGTH)),
    ephemeral: bytesToHex(
      stanza.body.subarray(FINGERPRINT_LENGTH, FINGERPRINT_LENGTH + EPHEMERAL_LENGTH)
    ),
    wrapped: bytesToHex(stanza.body.subarray(FINGERPRINT_LENGTH + EPHEMERAL_LENGTH)),
  };
};

const recipientStanzas = (header: FileHeader): Stanza[] =>
  header.stanzas.filter((stanza) => stanza.type === StanzaType.X25519).map(decodeStanza);

/**
 * Fingerprints of the recipients a file is encrypted to, in stanza order. The header is not
 * secret, so this needs no key: it is how tooling reports who can open a file.
 */
export const fileRecipients = (header: FileHeader): string[] =>
  recipientStanzas(header).map((stanza) => stanza.recipient);

/**
 * Recovers the file key with `identity`. Throws {@link NotRecipientError} when the identity is
 * not a recipient, including when the file is passphrase-encrypted.
 */
export const unwrapWithIdentity = (header: FileHeader, identity: Identity): Uint8Array => {
  const stanzas = recipientStanzas(header);
  if (stanzas.length === 0) {
    throw new NotRecipientError(
      'this file is not encrypted to any X25519 recipient; it is opened with a passphrase'
    );
  }
  return unwrapFileKey(stanzas, identity);
};

/** One stanza per distinct recipient. A file nobody can open is refused. */
const stanzasFor = (fileKey: Uint8Array, recipients: (Uint8Array | string)[]): FileStanza[] => {
  const unique = normalizeRecipients(recipients);
  if (unique.length === 0) throw new KeyError('at least one recipient is required');
  return unique.map((recipient) => recipientStanza(fileKey, recipient));
};

/** Starts a streamed file readable by every recipient. Write `header`, then the stream output. */
export const createRecipientFileEncryptor = (recipients: (Uint8Array | string)[]): FileEncryptor => {
  const fileKey = generateFileKey();
  try {
    return createFileEncryptor(fileKey, stanzasFor(fileKey, recipients));
  } finally {
    fileKey.fill(0);
  }
};

/** Verifies the header and returns a streaming decryptor for a file `identity` can open. */
export const createIdentityFileDecryptor = (header: FileHeader, identity: Identity): StreamDecryptor => {
  const fileKey = unwrapWithIdentity(header, identity);
  try {
    return createFileDecryptor(header, fileKey);
  } finally {
    fileKey.fill(0);
  }
};

/** Encrypts bytes already in memory into a version 2 file readable by every recipient. */
export const sealFileTo = (
  plaintext: Uint8Array | string,
  recipients: (Uint8Array | string)[]
): Uint8Array => {
  const fileKey = generateFileKey();
  try {
    return sealFile(plaintext, fileKey, stanzasFor(fileKey, recipients));
  } finally {
    fileKey.fill(0);
  }
};

/** Inverse of {@link sealFileTo}. */
export const openFileAs = (file: Uint8Array, identity: Identity): Uint8Array =>
  openFile(file, (header) => unwrapWithIdentity(header, identity));
