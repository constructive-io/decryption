import { xchacha20poly1305 } from '@decryption/ciphers/chacha';
import { concatBytes, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import {
  CorruptEnvelopeError,
  InvalidParametersError,
  UnsupportedEnvelopeError,
  WrongPassphraseError,
} from './errors';
import {
  DEFAULT_KDF_PROFILE,
  deriveKey,
  generateSalt,
  KdfParams,
  KdfProfile,
  KEY_LENGTH,
  resolveKdfParams,
  SALT_LENGTH,
} from './kdf';

/** ASCII `DCRYPT`, the first six bytes of every envelope. */
export const MAGIC = utf8ToBytes('DCRYPT');

/** Envelope format version implemented by this package. */
export const VERSION = 1;

/**
 * Algorithm suite identifier. Only one suite exists today; the byte is present so that a future
 * suite (say, AES-256-GCM for FIPS environments) can be added without a format break.
 */
export enum Suite {
  Argon2idXChaCha20Poly1305 = 1,
}

export const NONCE_LENGTH = 24;
export const TAG_LENGTH = 16;
export const HEADER_LENGTH = MAGIC.length + 1 + 1 + 4 + 4 + 1 + SALT_LENGTH + NONCE_LENGTH;

export interface EncryptOptions {
  /** Argon2id cost profile name, or explicit parameters. Defaults to `moderate`. */
  kdf?: KdfProfile | KdfParams;
  /**
   * Extra authenticated data bound to the ciphertext but *not* stored in the envelope.
   * The same value must be supplied to {@link decrypt}. Used to bind a ciphertext to its
   * context — e.g. the key name in a secrets file — so values cannot be swapped between fields.
   */
  aad?: Uint8Array | string;
}

export interface DecryptOptions {
  aad?: Uint8Array | string;
}

/** Parsed, non-secret metadata of an envelope. */
export interface EnvelopeHeader {
  version: number;
  suite: Suite;
  kdf: KdfParams;
  salt: Uint8Array;
  nonce: Uint8Array;
}

const toBytes = (value: Uint8Array | string | undefined): Uint8Array =>
  value === undefined ? new Uint8Array(0) : typeof value === 'string' ? utf8ToBytes(value) : value;

const writeUint32BE = (view: DataView, offset: number, value: number) =>
  view.setUint32(offset, value, false);

const encodeHeader = (header: EnvelopeHeader): Uint8Array => {
  const bytes = new Uint8Array(HEADER_LENGTH);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  bytes.set(MAGIC, offset);
  offset += MAGIC.length;
  bytes[offset++] = header.version;
  bytes[offset++] = header.suite;
  writeUint32BE(view, offset, header.kdf.t);
  offset += 4;
  writeUint32BE(view, offset, header.kdf.m);
  offset += 4;
  bytes[offset++] = header.kdf.p;
  bytes.set(header.salt, offset);
  offset += SALT_LENGTH;
  bytes.set(header.nonce, offset);
  return bytes;
};

/**
 * Parses (and validates) the envelope header. Throws {@link CorruptEnvelopeError} for anything
 * that is not a `dcrypt` envelope and {@link UnsupportedEnvelopeError} for versions/suites this
 * build cannot open — never a generic error, so callers can give users an accurate message.
 */
export const parseHeader = (envelope: Uint8Array): EnvelopeHeader => {
  if (envelope.length < HEADER_LENGTH + TAG_LENGTH) {
    throw new CorruptEnvelopeError('envelope is shorter than the minimum header + tag length');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (envelope[i] !== MAGIC[i]) throw new CorruptEnvelopeError('not a dcrypt envelope');
  }
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const version = envelope[6];
  const suite = envelope[7];
  if (version !== VERSION) {
    throw new UnsupportedEnvelopeError(
      `unsupported envelope version ${version}; this build understands version ${VERSION}`
    );
  }
  if (suite !== Suite.Argon2idXChaCha20Poly1305) {
    throw new UnsupportedEnvelopeError(`unsupported algorithm suite ${suite}`);
  }
  const kdf: KdfParams = {
    t: view.getUint32(8, false),
    m: view.getUint32(12, false),
    p: envelope[16],
  };
  return {
    version,
    suite,
    kdf: resolveKdfParams(kdf),
    salt: envelope.slice(17, 17 + SALT_LENGTH),
    nonce: envelope.slice(17 + SALT_LENGTH, HEADER_LENGTH),
  };
};

/**
 * Encrypts `plaintext` under `passphrase`, returning a self-describing envelope:
 * `magic || version || suite || argon2id params || salt || nonce || ciphertext || tag`.
 * The header is authenticated, so cost parameters cannot be downgraded by an attacker.
 */
export const encrypt = (
  plaintext: Uint8Array | string,
  passphrase: string | Uint8Array,
  options: EncryptOptions = {}
): Uint8Array => {
  const kdf = resolveKdfParams(options.kdf ?? DEFAULT_KDF_PROFILE);
  const salt = generateSalt();
  const nonce = randomBytes(NONCE_LENGTH);
  const header = encodeHeader({ version: VERSION, suite: Suite.Argon2idXChaCha20Poly1305, kdf, salt, nonce });
  const key = deriveKey(passphrase, salt, kdf);
  try {
    const aad = concatBytes(header, toBytes(options.aad));
    const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(toBytes(plaintext));
    return concatBytes(header, ciphertext);
  } finally {
    key.fill(0);
  }
};

/**
 * A passphrase key derivation kept for reuse. Argon2id is deliberately expensive, so a caller
 * that re-encrypts the same data repeatedly (a vault flushing its snapshot) can derive once and
 * pay only the AEAD cost per write. The salt is part of the derivation and is reused with it;
 * confidentiality still rests on the fresh random nonce chosen for every envelope.
 */
export interface DerivedEnvelopeKey {
  key: Uint8Array;
  salt: Uint8Array;
  kdf: KdfParams;
}

/** Runs the KDF once, yielding a handle usable with {@link encryptWithDerivedKey}. */
export const deriveEnvelopeKey = (
  passphrase: string | Uint8Array,
  kdf: KdfProfile | KdfParams = DEFAULT_KDF_PROFILE
): DerivedEnvelopeKey => {
  const params = resolveKdfParams(kdf);
  const salt = generateSalt();
  return { key: deriveKey(passphrase, salt, params), salt, kdf: params };
};

/**
 * {@link encrypt} with the KDF already done. Produces an identical envelope — the header still
 * records the salt and cost parameters, so {@link decrypt} opens it with the passphrase alone.
 */
export const encryptWithDerivedKey = (
  plaintext: Uint8Array | string,
  derived: DerivedEnvelopeKey,
  options: Pick<EncryptOptions, 'aad'> = {}
): Uint8Array => {
  assertKey(derived.key);
  const nonce = randomBytes(NONCE_LENGTH);
  const header = encodeHeader({
    version: VERSION,
    suite: Suite.Argon2idXChaCha20Poly1305,
    kdf: derived.kdf,
    salt: derived.salt,
    nonce,
  });
  const aad = concatBytes(header, toBytes(options.aad));
  return concatBytes(header, xchacha20poly1305(derived.key, nonce, aad).encrypt(toBytes(plaintext)));
};

/**
 * Decrypts an envelope produced by {@link encrypt}. A wrong passphrase raises
 * {@link WrongPassphraseError} — this format never returns an empty string on failure.
 */
export const decrypt = (
  envelope: Uint8Array,
  passphrase: string | Uint8Array,
  options: DecryptOptions = {}
): Uint8Array => {
  const header = parseHeader(envelope);
  const key = deriveKey(passphrase, header.salt, header.kdf);
  try {
    const aad = concatBytes(envelope.slice(0, HEADER_LENGTH), toBytes(options.aad));
    return xchacha20poly1305(key, header.nonce, aad).decrypt(envelope.slice(HEADER_LENGTH));
  } catch {
    throw new WrongPassphraseError();
  } finally {
    key.fill(0);
  }
};

/** Encrypts with an already-derived 32-byte key: `nonce || ciphertext || tag`, no KDF header. */
export const sealWithKey = (
  key: Uint8Array,
  plaintext: Uint8Array | string,
  aad?: Uint8Array | string
): Uint8Array => {
  assertKey(key);
  const nonce = randomBytes(NONCE_LENGTH);
  return concatBytes(nonce, xchacha20poly1305(key, nonce, toBytes(aad)).encrypt(toBytes(plaintext)));
};

/** Inverse of {@link sealWithKey}. */
export const openWithKey = (
  key: Uint8Array,
  sealed: Uint8Array,
  aad?: Uint8Array | string
): Uint8Array => {
  assertKey(key);
  if (sealed.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new CorruptEnvelopeError('sealed payload is too short');
  }
  const nonce = sealed.slice(0, NONCE_LENGTH);
  try {
    return xchacha20poly1305(key, nonce, toBytes(aad)).decrypt(sealed.slice(NONCE_LENGTH));
  } catch {
    throw new WrongPassphraseError('wrong key, or the sealed payload has been tampered with');
  }
};

const assertKey = (key: Uint8Array): void => {
  if (key.length !== KEY_LENGTH) {
    throw new InvalidParametersError(`key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
};
