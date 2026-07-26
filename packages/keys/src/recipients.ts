import { openWithKey, sealWithKey, WrongPassphraseError } from '@decryption/core';
import { x25519 } from '@decryption/curves/ed25519';
import { hkdf } from '@decryption/hashes/hkdf';
import { sha256 } from '@decryption/hashes/sha2';
import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import { fingerprint, Identity, KeyError, recipientFromString, recipientToString } from './identity';

const FILE_KEY_LENGTH = 32;

/** One recipient's copy of the file key — the age-style "stanza". */
export interface Stanza {
  /** Fingerprint of the recipient this stanza is for, so unwrapping does not have to guess. */
  recipient: string;
  /** Ephemeral X25519 public key, hex-encoded. */
  ephemeral: string;
  /** File key sealed to the recipient, hex-encoded. */
  wrapped: string;
}

/** A payload sealed once and readable by every listed recipient. */
export interface SealedPayload {
  stanzas: Stanza[];
  /** Ciphertext under the file key, hex-encoded. */
  ciphertext: string;
}

/** Generates a random file key — the symmetric key a payload is actually encrypted under. */
export const generateFileKey = (): Uint8Array => randomBytes(FILE_KEY_LENGTH);

/**
 * Wraps `fileKey` for one recipient using an ephemeral X25519 exchange, exactly the shape age
 * uses: the wrapping key is `HKDF-SHA256(shared secret, salt = ephemeral ‖ recipient)`.
 */
export const wrapFileKey = (fileKey: Uint8Array, recipient: Uint8Array | string): Stanza => {
  const recipientKey = typeof recipient === 'string' ? recipientFromString(recipient) : recipient;
  const ephemeralPrivate = randomBytes(32);
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const wrappingKey = deriveWrappingKey(
    x25519.getSharedSecret(ephemeralPrivate, recipientKey),
    ephemeralPublic,
    recipientKey
  );
  try {
    return {
      recipient: fingerprint(recipientKey),
      ephemeral: bytesToHex(ephemeralPublic),
      wrapped: bytesToHex(sealWithKey(wrappingKey, fileKey)),
    };
  } finally {
    ephemeralPrivate.fill(0);
    wrappingKey.fill(0);
  }
};

/** Recovers the file key from the stanza addressed to `identity`. */
export const unwrapFileKey = (stanzas: Stanza[], identity: Identity): Uint8Array => {
  const mine = fingerprint(identity.publicKey);
  const candidates = stanzas.filter((stanza) => stanza.recipient === mine);
  if (candidates.length === 0) {
    throw new KeyError(
      `this identity (${mine}) is not a recipient; recipients are ${stanzas.map((s) => s.recipient).join(', ') || 'none'}`
    );
  }
  for (const stanza of candidates) {
    const ephemeralPublic = hexToBytes(stanza.ephemeral);
    const wrappingKey = deriveWrappingKey(
      x25519.getSharedSecret(identity.privateKey, ephemeralPublic),
      ephemeralPublic,
      identity.publicKey
    );
    try {
      return openWithKey(wrappingKey, hexToBytes(stanza.wrapped));
    } catch {
      continue;
    } finally {
      wrappingKey.fill(0);
    }
  }
  throw new WrongPassphraseError('stanza did not unwrap: the file may have been tampered with');
};

/** Encrypts `plaintext` once, readable by every recipient. */
export const sealTo = (
  plaintext: Uint8Array | string,
  recipients: (Uint8Array | string)[],
  aad?: string
): SealedPayload => {
  if (recipients.length === 0) throw new KeyError('at least one recipient is required');
  const fileKey = generateFileKey();
  try {
    return {
      stanzas: recipients.map((recipient) => wrapFileKey(fileKey, recipient)),
      ciphertext: bytesToHex(sealWithKey(fileKey, plaintext, aad)),
    };
  } finally {
    fileKey.fill(0);
  }
};

/** Inverse of {@link sealTo}. */
export const openAs = (payload: SealedPayload, identity: Identity, aad?: string): Uint8Array => {
  const fileKey = unwrapFileKey(payload.stanzas, identity);
  try {
    return openWithKey(fileKey, hexToBytes(payload.ciphertext), aad);
  } finally {
    fileKey.fill(0);
  }
};

/** Recipient strings a payload can be opened by, in stanza order (fingerprints only). */
export const payloadRecipients = (payload: SealedPayload): string[] =>
  payload.stanzas.map((stanza) => stanza.recipient);

/** Normalizes a mixed list of recipient strings/keys into canonical `dcrypt1…` strings. */
export const normalizeRecipients = (recipients: (Uint8Array | string)[]): string[] => [
  ...new Set(
    recipients.map((recipient) =>
      typeof recipient === 'string'
        ? recipientToString(recipientFromString(recipient))
        : recipientToString(recipient)
    )
  ),
];

const deriveWrappingKey = (
  sharedSecret: Uint8Array,
  ephemeralPublic: Uint8Array,
  recipientPublic: Uint8Array
): Uint8Array =>
  hkdf(
    sha256,
    sharedSecret,
    concatBytes(ephemeralPublic, recipientPublic),
    utf8ToBytes('dcrypt-recipient-v1'),
    FILE_KEY_LENGTH
  );
