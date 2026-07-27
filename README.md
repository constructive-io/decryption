# decryption

<p align="center">
  <img src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" height="250">
  <br />
  Local-first cryptography for humans and teams
  <br />
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://github.com/constructive-io/decryption/blob/main/LICENSE">
    <img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg">
  </a>
</p>

Audited, dependency-light building blocks for mnemonics, envelope encryption, Shamir secret sharing and
team secret management — plus the `dcrypt` CLI. Everything runs locally; nothing in this repo makes a
network request.

## Packages

| Package | npm | Source | Description |
|---------|-----|--------|-------------|
| **@decryption/core** | [![npm](https://img.shields.io/npm/v/@decryption/core.svg)](https://www.npmjs.com/package/@decryption/core) | [GitHub](./packages/core) | Versioned envelope format — Argon2id + XChaCha20-Poly1305 |
| **@decryption/cosmology-compat** | [![npm](https://img.shields.io/npm/v/@decryption/cosmology-compat.svg)](https://www.npmjs.com/package/@decryption/cosmology-compat) | [GitHub](./packages/cosmology-compat) | Byte-compatible reader for the cosmology CLI encryption scheme |
| **@decryption/shamir** | [![npm](https://img.shields.io/npm/v/@decryption/shamir.svg)](https://www.npmjs.com/package/@decryption/shamir) | [GitHub](./packages/shamir) | Shamir secret sharing with authenticated, versioned shares |
| **@decryption/wallet** | [![npm](https://img.shields.io/npm/v/@decryption/wallet.svg)](https://www.npmjs.com/package/@decryption/wallet) | [GitHub](./packages/wallet) | BIP39/BIP32 wallets and offline address derivation |
| **@decryption/keys** | [![npm](https://img.shields.io/npm/v/@decryption/keys.svg)](https://www.npmjs.com/package/@decryption/keys) | [GitHub](./packages/keys) | X25519 identities, recipient strings, on-disk keyring |
| **@decryption/secrets** | [![npm](https://img.shields.io/npm/v/@decryption/secrets.svg)](https://www.npmjs.com/package/@decryption/secrets) | [GitHub](./packages/secrets) | Team secrets file format, rekeying and `.env` export |
| **@decryption/cli** | [![npm](https://img.shields.io/npm/v/@decryption/cli.svg)](https://www.npmjs.com/package/@decryption/cli) | [GitHub](./packages/cli) | The `dcrypt` command-line interface |

### Vendored primitives

Upstream `@noble/*` and `@scure/*` are ESM-only, which breaks `require()` in Jest and CJS tooling. These
forks vendor the unmodified sources and publish dual CJS+ESM builds.

| Package | Fork of | Description |
|---------|---------|-------------|
| **@decryption/hashes** | `@noble/hashes` 2.2.0 | SHA-2/3, BLAKE, HMAC, HKDF, PBKDF2, scrypt, Argon2 |
| **@decryption/ciphers** | `@noble/ciphers` 2.2.0 | AES-GCM, ChaCha20-Poly1305, XChaCha20-Poly1305 |
| **@decryption/curves** | `@noble/curves` 2.2.0 | secp256k1, ed25519, x25519 |
| **@decryption/base** | `@scure/base` 2.2.0 | bech32, base64, base58, hex |
| **@decryption/bip39** | `@scure/bip39` 2.2.0 | BIP39 mnemonics and wordlists |
| **@decryption/bip32** | `@scure/bip32` 2.2.0 | BIP32 HD derivation |

## Quick start

```bash
npm install -g @decryption/cli

dcrypt wallet create --words 24         # generate a BIP39 mnemonic
dcrypt encrypt --in secret.txt          # Argon2id + XChaCha20-Poly1305 envelope
dcrypt shamir split --shares 5 --threshold 3
dcrypt secrets init && dcrypt secrets set DATABASE_URL
dcrypt secrets run -- pnpm dev          # inject secrets without writing a .env
```

## Security model

- Argon2id for passphrase KDF, with calibrated parameters recorded in the envelope header.
- XChaCha20-Poly1305 AEAD — every ciphertext is authenticated; a wrong passphrase raises rather than
  returning an empty string.
- Team secrets use X25519 per-recipient wrapping (age/sops-shaped), so adding or removing a teammate never
  requires resharing a passphrase. Shamir is reserved for break-glass recovery.
- Nothing here opens a socket. Private keys are never written to disk unencrypted.
