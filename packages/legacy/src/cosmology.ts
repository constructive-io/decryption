import { sha256 } from '@decryption/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@decryption/hashes/utils';

import { cryptoJsDecrypt, cryptoJsEncrypt } from './cryptojs';

/**
 * The `@cosmology/core` crypt/decrypt pair, reimplemented byte-for-byte.
 *
 * The original hashed the caller's salt with SHA-256 and used the *hex string* of that digest as
 * the CryptoJS passphrase. Reproduced exactly so old blobs remain readable.
 *
 * @deprecated Use `@decryption/core` for anything new.
 */

/** SHA-256 of the salt, hex-encoded — the passphrase actually handed to CryptoJS. */
export const legacyPassphrase = (salt: string): string => bytesToHex(sha256(utf8ToBytes(salt)));

/** Legacy `crypt(salt, text)` from `@cosmology/core`. */
export const crypt = (salt: string, text: string): string =>
  cryptoJsEncrypt(text, legacyPassphrase(salt));

/** Legacy `decrypt(salt, encoded)` from `@cosmology/core`. */
export const decrypt = (salt: string, encoded: string): string =>
  cryptoJsDecrypt(encoded, legacyPassphrase(salt));

/**
 * Two-layer scheme used by the old encryption demo and CLI: a random "real" salt is encrypted
 * under the user's salt, and the secret is encrypted under the real salt. Decrypting therefore
 * requires unwrapping twice.
 */
export const decryptWithEncryptedSalt = (
  salt: string,
  encryptedSalt: string,
  encoded: string
): string => decrypt(decrypt(salt, encryptedSalt), encoded);

/** Encrypting counterpart of {@link decryptWithEncryptedSalt}. */
export const encryptWithEncryptedSalt = (
  salt: string,
  encryptedSalt: string,
  text: string
): string => crypt(decrypt(salt, encryptedSalt), text);

/* eslint-disable no-restricted-syntax */

/** Legacy `utf8ToHex` helper, preserved for byte-compatibility with old Shamir shares. */
export const utf8ToHex = (str: string): string =>
  Array.from(str)
    .map((c) =>
      c.charCodeAt(0) < 128
        ? c.charCodeAt(0).toString(16)
        : encodeURIComponent(c).replace(/%/g, '').toLowerCase()
    )
    .join('');

/** Legacy `hexToUtf8` helper. */
export const hexToUtf8 = (hex: string): string => {
  const pairs = hex.match(/.{1,2}/g);
  if (!pairs) return '';
  return decodeURIComponent('%' + pairs.join('%'));
};

/** Legacy `utf8ArrayToString` helper — despite the name, it base64-encodes bytes. */
export const utf8ArrayToString = (arr: Uint8Array | number[]): string =>
  Buffer.from(arr as Uint8Array).toString('base64');

/** Legacy `stringToUtf8Array` helper — decodes base64 back into bytes. */
export const stringToUtf8Array = (str: string): Uint8Array =>
  new Uint8Array(Buffer.from(str, 'base64'));
