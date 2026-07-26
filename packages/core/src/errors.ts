/** Base class for every error thrown by `@decryption/core`. */
export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The envelope is well-formed but the key or passphrase is wrong (or the ciphertext
 * was tampered with). AEAD cannot distinguish the two cases.
 */
export class WrongPassphraseError extends DecryptionError {
  constructor(message = 'wrong passphrase, or the ciphertext has been tampered with') {
    super(message);
  }
}

/** The bytes are not a `dcrypt` envelope, or the header is truncated/inconsistent. */
export class CorruptEnvelopeError extends DecryptionError {}

/** The envelope was produced by a newer format version or an algorithm we do not implement. */
export class UnsupportedEnvelopeError extends DecryptionError {}

/** Caller passed arguments that cannot produce a secure result. */
export class InvalidParametersError extends DecryptionError {}
