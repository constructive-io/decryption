import { base64 } from '@decryption/base';
import { cbc } from '@decryption/ciphers/aes';
import { WrongPassphraseError } from '@decryption/core';
import { md5 } from '@decryption/hashes/legacy';
import { concatBytes, utf8ToBytes } from '@decryption/hashes/utils';

/**
 * Byte-compatible reimplementation of `CryptoJS.AES.encrypt(message, passphraseString)`.
 *
 * **Deprecated by design.** This scheme is only here so data written by the old encryption demo
 * and `@cosmology/core` stays readable. It is weak: the key is derived with OpenSSL's
 * `EVP_BytesToKey` (MD5, a single iteration) and AES-CBC provides no authentication, so a wrong
 * passphrase is only detectable by heuristics. Re-encrypt anything you open with
 * `@decryption/core` — see {@link upgradeEnvelope}.
 */

/** OpenSSL's `Salted__` magic prefix, emitted by CryptoJS for passphrase-based encryption. */
export const OPENSSL_MAGIC = utf8ToBytes('Salted__');

const SALT_LENGTH = 8;
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

/**
 * OpenSSL `EVP_BytesToKey` with MD5 and one iteration — what CryptoJS uses to turn a passphrase
 * string into an AES-256 key and IV.
 */
export const evpBytesToKey = (
  passphrase: Uint8Array,
  salt: Uint8Array
): { key: Uint8Array; iv: Uint8Array } => {
  const target = KEY_LENGTH + IV_LENGTH;
  let derived = new Uint8Array(0);
  let block = new Uint8Array(0);
  while (derived.length < target) {
    block = md5(concatBytes(block, passphrase, salt));
    derived = concatBytes(derived, block);
  }
  return { key: derived.slice(0, KEY_LENGTH), iv: derived.slice(KEY_LENGTH, target) };
};

/** Encrypts exactly like `CryptoJS.AES.encrypt(...).toString()` — base64 of `Salted__|salt|ct`. */
export const cryptoJsEncrypt = (
  message: string,
  passphrase: string,
  salt: Uint8Array = randomSalt()
): string => {
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`openssl salt must be ${SALT_LENGTH} bytes, got ${salt.length}`);
  }
  const { key, iv } = evpBytesToKey(utf8ToBytes(passphrase), salt);
  const ciphertext = cbc(key, iv).encrypt(utf8ToBytes(message));
  return base64.encode(concatBytes(OPENSSL_MAGIC, salt, ciphertext));
};

/**
 * Decrypts a `CryptoJS.AES` passphrase ciphertext. Unlike CryptoJS — which returns an empty
 * string when the passphrase is wrong — this throws {@link WrongPassphraseError}.
 */
export const cryptoJsDecrypt = (ciphertext: string, passphrase: string): string => {
  let payload: Uint8Array;
  try {
    payload = base64.decode(ciphertext.trim());
  } catch {
    throw new WrongPassphraseError('legacy ciphertext is not valid base64');
  }
  if (payload.length <= OPENSSL_MAGIC.length + SALT_LENGTH) {
    throw new WrongPassphraseError('legacy ciphertext is truncated');
  }
  for (let i = 0; i < OPENSSL_MAGIC.length; i++) {
    if (payload[i] !== OPENSSL_MAGIC[i]) {
      throw new WrongPassphraseError('legacy ciphertext is missing the OpenSSL "Salted__" prefix');
    }
  }
  const salt = payload.slice(OPENSSL_MAGIC.length, OPENSSL_MAGIC.length + SALT_LENGTH);
  const body = payload.slice(OPENSSL_MAGIC.length + SALT_LENGTH);
  const { key, iv } = evpBytesToKey(utf8ToBytes(passphrase), salt);

  let plaintext: Uint8Array;
  try {
    plaintext = cbc(key, iv).decrypt(body);
  } catch {
    // A bad passphrase usually produces invalid PKCS#7 padding.
    throw new WrongPassphraseError('you probably have the wrong salt or passphrase');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    throw new WrongPassphraseError('decrypted bytes are not valid UTF-8; wrong passphrase');
  }
};

const randomSalt = (): Uint8Array => {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
};
