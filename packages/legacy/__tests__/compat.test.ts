import { decrypt as modernDecrypt, WrongPassphraseError } from '@decryption/core';
import { hexToBytes } from '@decryption/hashes/utils';
import CryptoJS from 'crypto-js';

import {
  crypt,
  cryptoJsDecrypt,
  cryptoJsEncrypt,
  decrypt,
  decryptWithEncryptedSalt,
  encryptWithEncryptedSalt,
  evpBytesToKey,
  hexToUtf8,
  legacyPassphrase,
  upgradeEnvelope,
  utf8ToHex,
} from '../src';

const SALT = 'super secret salt';
const MESSAGE = 'zebra ordinary museum lecture crouch dial pupil ability march';

describe('crypto-js compatibility', () => {
  it('derives the same key material as OpenSSL EVP_BytesToKey', () => {
    // openssl enc -aes-256-cbc -pass pass:password -S 0102030405060708 -P -md md5
    const { key, iv } = evpBytesToKey(
      new TextEncoder().encode('password'),
      hexToBytes('0102030405060708')
    );
    expect(key).toHaveLength(32);
    expect(iv).toHaveLength(16);
    const cryptoJsDerived = CryptoJS.enc.Hex.stringify(
      CryptoJS.EvpKDF('password', CryptoJS.enc.Hex.parse('0102030405060708'), {
        keySize: 12,
        iterations: 1,
        hasher: CryptoJS.algo.MD5,
      })
    );
    expect(cryptoJsDerived).toBe(
      Buffer.from(key).toString('hex') + Buffer.from(iv).toString('hex')
    );
  });

  it('decrypts ciphertext produced by the real crypto-js', () => {
    const ciphertext = CryptoJS.AES.encrypt(MESSAGE, legacyPassphrase(SALT)).toString();
    expect(decrypt(SALT, ciphertext)).toBe(MESSAGE);
  });

  it('produces ciphertext the real crypto-js can decrypt', () => {
    const ciphertext = crypt(SALT, MESSAGE);
    const roundTripped = CryptoJS.AES.decrypt(ciphertext, legacyPassphrase(SALT)).toString(
      CryptoJS.enc.Utf8
    );
    expect(roundTripped).toBe(MESSAGE);
  });

  it('handles unicode and empty payloads', () => {
    for (const message of ['', 'héllo wörld 🔐', 'a'.repeat(1000)]) {
      const ciphertext = CryptoJS.AES.encrypt(message, 'pw').toString();
      expect(cryptoJsDecrypt(ciphertext, 'pw')).toBe(message);
      expect(
        CryptoJS.AES.decrypt(cryptoJsEncrypt(message, 'pw'), 'pw').toString(CryptoJS.enc.Utf8)
      ).toBe(message);
    }
  });

  it('reports a wrong passphrase as a typed error', () => {
    const ciphertext = CryptoJS.AES.encrypt(MESSAGE, 'right').toString();
    // crypto-js either returns '' or throws an opaque "Malformed UTF-8 data"
    let cryptoJsResult: string | Error;
    try {
      cryptoJsResult = CryptoJS.AES.decrypt(ciphertext, 'wrong').toString(CryptoJS.enc.Utf8);
    } catch (error) {
      cryptoJsResult = error as Error;
    }
    expect(cryptoJsResult).not.toBe(MESSAGE);
    expect(() => cryptoJsDecrypt(ciphertext, 'wrong')).toThrow(WrongPassphraseError);
  });

  it('rejects payloads that are not CryptoJS passphrase ciphertexts', () => {
    expect(() => cryptoJsDecrypt('not base64 !!!', 'pw')).toThrow(WrongPassphraseError);
    expect(() => cryptoJsDecrypt(Buffer.from('short').toString('base64'), 'pw')).toThrow(
      WrongPassphraseError
    );
  });
});

describe('two-layer cosmology scheme', () => {
  const encryptedSalt = crypt(SALT, 'the real salt');

  it('round-trips through both layers', () => {
    const ciphertext = encryptWithEncryptedSalt(SALT, encryptedSalt, MESSAGE);
    expect(decryptWithEncryptedSalt(SALT, encryptedSalt, ciphertext)).toBe(MESSAGE);
    // matches what the old demo did by hand
    expect(decrypt('the real salt', ciphertext)).toBe(MESSAGE);
  });
});

describe('legacy hex helpers', () => {
  it('round-trips ascii and unicode', () => {
    for (const value of ['hello', 'héllo 🔐']) {
      expect(hexToUtf8(utf8ToHex(value))).toBe(value);
    }
  });
});

describe('upgrade path', () => {
  it('re-encrypts a legacy blob as a modern authenticated envelope', () => {
    const legacy = crypt(SALT, MESSAGE);
    const envelope = upgradeEnvelope(legacy, SALT, 'new strong passphrase', {
      kdf: { t: 1, m: 8192, p: 1 },
    });
    expect(new TextDecoder().decode(modernDecrypt(envelope, 'new strong passphrase'))).toBe(
      MESSAGE
    );
  });
});
