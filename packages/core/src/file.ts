import { base64 } from '@decryption/base';
import { equalBytes } from '@decryption/ciphers/utils';
import { hkdf } from '@decryption/hashes/hkdf';
import { hmac } from '@decryption/hashes/hmac';
import { sha256 } from '@decryption/hashes/sha2';
import { concatBytes, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import { copyBytes } from './bytes';
import { MAGIC, NONCE_LENGTH, openWithKey, sealWithKey, Suite, TAG_LENGTH } from './envelope';
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
  resolveKdfParams,
  SALT_LENGTH,
} from './kdf';
import {
  deriveStreamKey,
  generateStreamNonce,
  STREAM_NONCE_LENGTH,
  StreamDecryptor,
  StreamEncryptor,
} from './stream';

/**
 * Version 2 of the dcrypt format: a binary, streamable file envelope.
 *
 * ```text
 * | magic  | ver | suite | count | stanza … stanza | header MAC | nonce | STREAM chunks … |
 * | DCRYPT |  2  |   2   |  u16  |                 |    32 B    | 16 B  |                 |
 * |<------------- authenticated by the MAC ------->|
 *
 * stanza: | type u8 | length u16 | body |
 * ```
 *
 * The layout follows the age file format: a random file key encrypts the payload, and each
 * stanza holds one wrapped copy of that key (for a passphrase, or for an X25519 recipient). The
 * header is authenticated with `HMAC-SHA256` under `HKDF-SHA256(file key, info = "header")`, and
 * the payload is the STREAM construction in `stream.ts`. Only the encoding differs from age
 * (binary fields instead of text lines), plus the key wrapping, which reuses this package's
 * Argon2id + XChaCha20-Poly1305 and `@decryption/keys`' X25519 stanzas.
 *
 * Adding a way to unlock a file means adding a stanza type; the payload never changes.
 */

/** Format version written in the seventh byte. Version 1 is the single-shot envelope. */
export const FILE_VERSION = 2;

/** Length of the random file key. */
export const FILE_KEY_LENGTH = 32;

/** Length of the header MAC. */
export const FILE_MAC_LENGTH = 32;

/** Prefix of the text (armored) form of a version 2 file, e.g. `dcrypt.v2.<base64>`. */
export const FILE_ARMOR_PREFIX = 'dcrypt.v2.';

/** Upper bounds accepted when reading, so a hostile header cannot make a reader buffer forever. */
export const MAX_STANZAS = 1024;
export const MAX_STANZA_BODY_LENGTH = 1024;

/** Known stanza types. Readers keep stanzas of unknown type so newer writers stay readable. */
export enum StanzaType {
  /** Argon2id-derived key wraps the file key. Must be the only stanza, as with age's scrypt. */
  Passphrase = 1,
  /** X25519 recipient, produced by `@decryption/keys`. */
  X25519 = 2,
}

/** One wrapped copy of the file key. */
export interface FileStanza {
  type: number;
  body: Uint8Array;
}

/** Parsed, non-secret header of a version 2 file. */
export interface FileHeader {
  version: number;
  suite: number;
  stanzas: FileStanza[];
  /** HMAC over {@link FileHeader.authenticated}; check it with {@link verifyFileHeader}. */
  mac: Uint8Array;
  /** Per-file nonce the payload key is derived with. */
  nonce: Uint8Array;
  /** The header bytes covered by the MAC. */
  authenticated: Uint8Array;
  /** Offset of the first payload byte. */
  length: number;
}

const FIXED_LENGTH = MAGIC.length + 1 + 1 + 2;
const TRAILER_LENGTH = FILE_MAC_LENGTH + STREAM_NONCE_LENGTH;
const HEADER_INFO = utf8ToBytes('header');
const PASSPHRASE_PARAMS_LENGTH = 4 + 4 + 1 + SALT_LENGTH;
const WRAPPED_KEY_LENGTH = NONCE_LENGTH + FILE_KEY_LENGTH + TAG_LENGTH;
const PASSPHRASE_CONTEXT = utf8ToBytes('dcrypt-file-passphrase-v2');

const assertFileKey = (fileKey: Uint8Array): void => {
  if (fileKey.length !== FILE_KEY_LENGTH) {
    throw new InvalidParametersError(`file key must be ${FILE_KEY_LENGTH} bytes, got ${fileKey.length}`);
  }
};

const assertStanzas = (stanzas: FileStanza[], Failure: new (message: string) => Error): void => {
  if (stanzas.length === 0) throw new Failure('a file needs at least one stanza');
  if (stanzas.length > MAX_STANZAS) throw new Failure(`a file can hold at most ${MAX_STANZAS} stanzas`);
  for (const stanza of stanzas) {
    if (!Number.isInteger(stanza.type) || stanza.type < 1 || stanza.type > 255) {
      throw new Failure(`invalid stanza type ${stanza.type}`);
    }
    if (stanza.body.length > MAX_STANZA_BODY_LENGTH) {
      throw new Failure(`stanza body is longer than ${MAX_STANZA_BODY_LENGTH} bytes`);
    }
  }
  if (stanzas.length > 1 && stanzas.some((stanza) => stanza.type === StanzaType.Passphrase)) {
    throw new Failure('a passphrase stanza must be the only stanza in a file');
  }
};

const headerMac = (fileKey: Uint8Array, authenticated: Uint8Array): Uint8Array => {
  const macKey = hkdf(sha256, fileKey, undefined, HEADER_INFO, 32);
  try {
    return hmac(sha256, macKey, authenticated);
  } finally {
    macKey.fill(0);
  }
};

/** Draws a fresh random file key. Never reuse one: it is the root of a single file's keys. */
export const generateFileKey = (): Uint8Array => randomBytes(FILE_KEY_LENGTH);

/** True when `bytes` begin like a version 2 file. Eight bytes are enough to tell. */
export const isFileEnvelope = (bytes: Uint8Array): boolean => {
  if (bytes.length < MAGIC.length + 1) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) return false;
  }
  return bytes[MAGIC.length] === FILE_VERSION;
};

/** Encodes the complete header: stanzas, their MAC, and the payload nonce. */
export const encodeFileHeader = (
  fileKey: Uint8Array,
  stanzas: FileStanza[],
  nonce: Uint8Array = generateStreamNonce()
): Uint8Array => {
  assertFileKey(fileKey);
  assertStanzas(stanzas, InvalidParametersError);
  if (nonce.length !== STREAM_NONCE_LENGTH) {
    throw new InvalidParametersError(`stream nonce must be ${STREAM_NONCE_LENGTH} bytes`);
  }
  const fixed = new Uint8Array(FIXED_LENGTH);
  fixed.set(MAGIC, 0);
  fixed[MAGIC.length] = FILE_VERSION;
  fixed[MAGIC.length + 1] = Suite.HkdfSha256ChaCha20Poly1305Stream;
  new DataView(fixed.buffer).setUint16(MAGIC.length + 2, stanzas.length, false);
  const encoded = stanzas.map((stanza) => {
    const bytes = new Uint8Array(3 + stanza.body.length);
    bytes[0] = stanza.type;
    new DataView(bytes.buffer).setUint16(1, stanza.body.length, false);
    bytes.set(stanza.body, 3);
    return bytes;
  });
  const authenticated = concatBytes(fixed, ...encoded);
  return concatBytes(authenticated, headerMac(fileKey, authenticated), nonce);
};

/**
 * Parses a header from the start of `bytes`. Returns `undefined` when more bytes are needed, so
 * a streaming reader can call it again with a longer prefix. Throws {@link CorruptEnvelopeError}
 * for anything that is not a dcrypt file and {@link UnsupportedEnvelopeError} for versions or
 * suites this build cannot open.
 */
export const tryParseFileHeader = (bytes: Uint8Array): FileHeader | undefined => {
  for (let i = 0; i < Math.min(bytes.length, MAGIC.length); i++) {
    if (bytes[i] !== MAGIC[i]) throw new CorruptEnvelopeError('not a dcrypt envelope');
  }
  if (bytes.length < FIXED_LENGTH) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[MAGIC.length];
  const suite = bytes[MAGIC.length + 1];
  if (version !== FILE_VERSION) {
    throw new UnsupportedEnvelopeError(
      version === 1
        ? 'this is a version 1 envelope; open it with decrypt()'
        : `unsupported envelope version ${version}; this build understands versions 1 and ${FILE_VERSION}`
    );
  }
  if (suite !== Suite.HkdfSha256ChaCha20Poly1305Stream) {
    throw new UnsupportedEnvelopeError(`unsupported algorithm suite ${suite}`);
  }
  const count = view.getUint16(MAGIC.length + 2, false);
  if (count === 0 || count > MAX_STANZAS) {
    throw new CorruptEnvelopeError(`invalid stanza count ${count}`);
  }
  const stanzas: FileStanza[] = [];
  let offset = FIXED_LENGTH;
  for (let i = 0; i < count; i++) {
    if (bytes.length < offset + 3) return undefined;
    const type = bytes[offset];
    const length = view.getUint16(offset + 1, false);
    if (type === 0) throw new CorruptEnvelopeError('invalid stanza type 0');
    if (length > MAX_STANZA_BODY_LENGTH) {
      throw new CorruptEnvelopeError(`stanza body is longer than ${MAX_STANZA_BODY_LENGTH} bytes`);
    }
    if (bytes.length < offset + 3 + length) return undefined;
    stanzas.push({ type, body: copyBytes(bytes, offset + 3, offset + 3 + length) });
    offset += 3 + length;
  }
  if (bytes.length < offset + TRAILER_LENGTH) return undefined;
  assertStanzas(stanzas, CorruptEnvelopeError);
  return {
    version,
    suite,
    stanzas,
    mac: copyBytes(bytes, offset, offset + FILE_MAC_LENGTH),
    nonce: copyBytes(bytes, offset + FILE_MAC_LENGTH, offset + TRAILER_LENGTH),
    authenticated: copyBytes(bytes, 0, offset),
    length: offset + TRAILER_LENGTH,
  };
};

/** {@link tryParseFileHeader} for callers that hold the whole file: a short header is corrupt. */
export const parseFileHeader = (bytes: Uint8Array): FileHeader => {
  const header = tryParseFileHeader(bytes);
  if (!header) throw new CorruptEnvelopeError('envelope header is truncated');
  return header;
};

/**
 * Checks the header MAC with the unwrapped file key. This is what stops an attacker from adding,
 * removing or editing stanzas (for example to lower Argon2id cost parameters) on a file they
 * cannot decrypt. Anyone who can unwrap the file key can also rewrite the header; that is
 * inherent in the design and the same as in age.
 */
export const verifyFileHeader = (header: FileHeader, fileKey: Uint8Array): void => {
  assertFileKey(fileKey);
  if (!equalBytes(headerMac(fileKey, header.authenticated), header.mac)) {
    throw new CorruptEnvelopeError('envelope header failed authentication: it was modified');
  }
};

/** True when the file is unlocked with a passphrase rather than by recipients. */
export const isPassphraseFile = (header: FileHeader): boolean =>
  header.stanzas.some((stanza) => stanza.type === StanzaType.Passphrase);

/** Wraps the file key under an Argon2id-derived key. The cost parameters travel in the stanza. */
export const wrapWithPassphrase = (
  fileKey: Uint8Array,
  passphrase: string | Uint8Array,
  kdf: KdfProfile | KdfParams = DEFAULT_KDF_PROFILE
): FileStanza => {
  assertFileKey(fileKey);
  const params = resolveKdfParams(kdf);
  if (params.t > 0xffffffff || params.m > 0xffffffff || params.p > 0xff) {
    throw new InvalidParametersError('kdf parameters do not fit the envelope header');
  }
  const salt = generateSalt();
  const prefix = new Uint8Array(PASSPHRASE_PARAMS_LENGTH);
  const view = new DataView(prefix.buffer);
  view.setUint32(0, params.t, false);
  view.setUint32(4, params.m, false);
  prefix[8] = params.p;
  prefix.set(salt, 9);
  const key = deriveKey(passphrase, salt, params);
  try {
    // The parameters are bound as associated data: lowering them changes the derived key anyway,
    // and this keeps a wrapped key from being lifted into a stanza that claims other parameters.
    const wrapped = sealWithKey(key, fileKey, concatBytes(PASSPHRASE_CONTEXT, prefix));
    return { type: StanzaType.Passphrase, body: concatBytes(prefix, wrapped) };
  } finally {
    key.fill(0);
  }
};

/** Recovers the file key from a passphrase file. A wrong passphrase raises {@link WrongPassphraseError}. */
export const unwrapWithPassphrase = (
  header: FileHeader,
  passphrase: string | Uint8Array
): Uint8Array => {
  const stanza = header.stanzas.find((candidate) => candidate.type === StanzaType.Passphrase);
  if (!stanza) {
    throw new InvalidParametersError('this file is encrypted to recipients, not with a passphrase');
  }
  if (stanza.body.length !== PASSPHRASE_PARAMS_LENGTH + WRAPPED_KEY_LENGTH) {
    throw new CorruptEnvelopeError('passphrase stanza has the wrong length');
  }
  const prefix = copyBytes(stanza.body, 0, PASSPHRASE_PARAMS_LENGTH);
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  let params: KdfParams;
  try {
    params = resolveKdfParams({ t: view.getUint32(0, false), m: view.getUint32(4, false), p: prefix[8] });
  } catch (error) {
    throw new CorruptEnvelopeError(
      `passphrase stanza carries unacceptable kdf parameters: ${(error as Error).message}`
    );
  }
  const key = deriveKey(passphrase, copyBytes(prefix, 9), params);
  try {
    return openWithKey(
      key,
      copyBytes(stanza.body, PASSPHRASE_PARAMS_LENGTH),
      concatBytes(PASSPHRASE_CONTEXT, prefix)
    );
  } catch {
    throw new WrongPassphraseError();
  } finally {
    key.fill(0);
  }
};

/** The header to write first, and the encryptor for everything after it. */
export interface FileEncryptor {
  header: Uint8Array;
  stream: StreamEncryptor;
}

/** Starts a file: encodes its header and returns a streaming encryptor for the payload. */
export const createFileEncryptor = (fileKey: Uint8Array, stanzas: FileStanza[]): FileEncryptor => {
  const nonce = generateStreamNonce();
  const header = encodeFileHeader(fileKey, stanzas, nonce);
  const key = deriveStreamKey(fileKey, nonce);
  try {
    return { header, stream: new StreamEncryptor(key) };
  } finally {
    key.fill(0);
  }
};

/** Verifies the header with `fileKey` and returns a streaming decryptor for the payload. */
export const createFileDecryptor = (header: FileHeader, fileKey: Uint8Array): StreamDecryptor => {
  verifyFileHeader(header, fileKey);
  const key = deriveStreamKey(fileKey, header.nonce);
  try {
    return new StreamDecryptor(key);
  } finally {
    key.fill(0);
  }
};

/** Encrypts bytes already in memory under `fileKey`, with the given stanzas in the header. */
export const sealFile = (
  plaintext: Uint8Array | string,
  fileKey: Uint8Array,
  stanzas: FileStanza[]
): Uint8Array => {
  const { header, stream } = createFileEncryptor(fileKey, stanzas);
  const bytes = typeof plaintext === 'string' ? utf8ToBytes(plaintext) : plaintext;
  const head = stream.update(bytes);
  return concatBytes(header, head, stream.finish());
};

/**
 * Decrypts a whole file held in memory. `unwrap` turns the parsed header into the file key (with
 * a passphrase, an identity, or anything else). Nothing is returned unless the entire payload
 * authenticates.
 */
export const openFile = (
  bytes: Uint8Array,
  unwrap: (header: FileHeader) => Uint8Array
): Uint8Array => {
  const header = parseFileHeader(bytes);
  const fileKey = unwrap(header);
  try {
    const stream = createFileDecryptor(header, fileKey);
    const head = stream.update(bytes.subarray(header.length));
    return concatBytes(head, stream.finish());
  } finally {
    fileKey.fill(0);
  }
};

/** Passphrase-encrypts bytes into a version 2 file. */
export const encryptFile = (
  plaintext: Uint8Array | string,
  passphrase: string | Uint8Array,
  options: { kdf?: KdfProfile | KdfParams } = {}
): Uint8Array => {
  const fileKey = generateFileKey();
  try {
    return sealFile(plaintext, fileKey, [wrapWithPassphrase(fileKey, passphrase, options.kdf)]);
  } finally {
    fileKey.fill(0);
  }
};

/** Inverse of {@link encryptFile}. */
export const decryptFile = (bytes: Uint8Array, passphrase: string | Uint8Array): Uint8Array =>
  openFile(bytes, (header) => unwrapWithPassphrase(header, passphrase));

/** Text form of a version 2 file, for small payloads that have to live in text. */
export const armorFile = (file: Uint8Array): string => FILE_ARMOR_PREFIX + base64.encode(file);

/** Inverse of {@link armorFile}. */
export const dearmorFile = (text: string): Uint8Array => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(FILE_ARMOR_PREFIX)) {
    throw new CorruptEnvelopeError(`armored file must start with "${FILE_ARMOR_PREFIX}"`);
  }
  try {
    return base64.decode(trimmed.slice(FILE_ARMOR_PREFIX.length));
  } catch {
    throw new CorruptEnvelopeError('armored file is not valid base64');
  }
};
