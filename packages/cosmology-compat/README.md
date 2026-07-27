# @decryption/cosmology-compat

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/cosmology-compat"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fcosmology-compat%2Fpackage.json"/></a>
</p>


> **Deprecated by design.** This package exists so data written by the cosmology CLI
> stays readable. Do not use it to encrypt anything new — use
> [`@decryption/core`](../core) instead.

## Why it is weak

The old scheme was `CryptoJS.AES.encrypt(text, SHA256(salt).toString())`, which means:

- keys derived with OpenSSL `EVP_BytesToKey` — **MD5, a single iteration**, no work factor;
- AES-256-CBC with **no authentication tag**, so tampering is undetectable;
- a wrong passphrase yields an empty string in CryptoJS rather than an error.

This package reimplements the format byte-for-byte on top of `@decryption/ciphers` (no `crypto-js`
dependency), and turns the silent-failure case into a thrown `WrongPassphraseError`.

## Usage

```typescript
import { decrypt, decryptWithEncryptedSalt, upgradeEnvelopeToString } from '@decryption/cosmology-compat';

// Single-layer blobs
const plaintext = decrypt(salt, oldCiphertext);

// The demo's two-layer scheme (encrypted salt wrapping the real salt)
const mnemonic = decryptWithEncryptedSalt(salt, encryptedSalt, encryptedWallet);

// One-way door onto the modern format
const modern = upgradeEnvelopeToString(oldCiphertext, salt, newPassphrase);
```

Raw CryptoJS compatibility, if you have blobs that never went through `@cosmology/core`:

```typescript
import { cryptoJsEncrypt, cryptoJsDecrypt } from '@decryption/cosmology-compat';

cryptoJsDecrypt(base64Ciphertext, passphrase); // throws instead of returning ''
```

## Verified compatibility

The test suite encrypts with the real `crypto-js` package and decrypts with this one (and vice
versa), so the byte compatibility claim is checked on every run rather than assumed.
