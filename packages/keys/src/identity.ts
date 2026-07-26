import { bech32 } from '@decryption/base';
import { x25519 } from '@decryption/curves/ed25519';
import { hkdf } from '@decryption/hashes/hkdf';
import { sha256 } from '@decryption/hashes/sha2';
import { bytesToHex, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

/** Bech32 prefix of a public recipient string: `dcrypt1…`. */
export const RECIPIENT_PREFIX = 'dcrypt';

/** Bech32 prefix of a private identity string: `dcryptsec1…`. */
export const IDENTITY_PREFIX = 'dcryptsec';

const KEY_LENGTH = 32;

export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** An X25519 key pair. The private key is only ever held in memory. */
export interface Identity {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/** Generates a new X25519 identity from the platform CSPRNG. */
export const generateIdentity = (): Identity => identityFromPrivateKey(randomBytes(KEY_LENGTH));

/** Wraps raw private key bytes as an {@link Identity}. */
export const identityFromPrivateKey = (privateKey: Uint8Array): Identity => {
  if (privateKey.length !== KEY_LENGTH) {
    throw new KeyError(`private key must be ${KEY_LENGTH} bytes, got ${privateKey.length}`);
  }
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
};

/**
 * Derives an identity deterministically from a BIP39 seed, so a user who keeps their mnemonic can
 * recover their encryption identity without a separate backup. `index` allows several identities
 * (work laptop, CI, break-glass) from one seed.
 */
export const identityFromSeed = (seed: Uint8Array, index = 0): Identity =>
  identityFromPrivateKey(
    hkdf(sha256, seed, utf8ToBytes('dcrypt-identity-v1'), utf8ToBytes(`identity/${index}`), KEY_LENGTH)
  );

/** Encodes the public half as a shareable `dcrypt1…` recipient string. */
export const recipientToString = (publicKey: Uint8Array): string =>
  bech32.encode(RECIPIENT_PREFIX, bech32.toWords(publicKey));

/** Decodes a `dcrypt1…` recipient string. */
export const recipientFromString = (recipient: string): Uint8Array => {
  const decoded = decodeBech32(recipient.trim(), RECIPIENT_PREFIX, 'recipient');
  if (decoded.length !== KEY_LENGTH) throw new KeyError('recipient key has the wrong length');
  return decoded;
};

/** Encodes the private half as a `dcryptsec1…` string. Treat it like a password. */
export const identityToString = (identity: Identity): string =>
  bech32.encode(IDENTITY_PREFIX, bech32.toWords(identity.privateKey)).toUpperCase();

/** Decodes a `dcryptsec1…` string back into an {@link Identity}. */
export const identityFromString = (encoded: string): Identity =>
  identityFromPrivateKey(decodeBech32(encoded.trim().toLowerCase(), IDENTITY_PREFIX, 'identity'));

/** Short, human-comparable fingerprint of a recipient — the first 8 bytes of its SHA-256. */
export const fingerprint = (publicKey: Uint8Array): string =>
  bytesToHex(sha256(publicKey)).slice(0, 16);

const decodeBech32 = (value: string, prefix: string, kind: string): Uint8Array => {
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(value as `${string}1${string}`, 256);
  } catch {
    throw new KeyError(`${kind} string is not valid bech32`);
  }
  if (decoded.prefix !== prefix) {
    throw new KeyError(`expected a "${prefix}1…" ${kind} string, got "${decoded.prefix}1…"`);
  }
  return Uint8Array.from(bech32.fromWords(decoded.words));
};
