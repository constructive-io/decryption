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

Dependency-light building blocks for mnemonics, envelope encryption, Shamir secret sharing and team
secret management — plus the `dcrypt` CLI — built on vendored `@noble` and `@scure` primitives.
Everything runs locally; the only code here that opens a socket is `dcrypt account`, which talks to the
Constructive endpoint you name.

The primitives have been audited upstream; the formats and tools built on them here have not. See
[Audit status](#audit-status) for exactly where that line is.

## Packages

| Package | npm | Source | Description |
|---------|-----|--------|-------------|
| **@decryption/core** | [![npm](https://img.shields.io/npm/v/@decryption/core.svg)](https://www.npmjs.com/package/@decryption/core) | [GitHub](./packages/core) | Versioned envelopes — Argon2id + XChaCha20-Poly1305, and a chunked file format for large files |
| **@decryption/cosmology-compat** | [![npm](https://img.shields.io/npm/v/@decryption/cosmology-compat.svg)](https://www.npmjs.com/package/@decryption/cosmology-compat) | [GitHub](./packages/cosmology-compat) | Byte-compatible reader for the cosmology CLI encryption scheme |
| **@decryption/shamir** | [![npm](https://img.shields.io/npm/v/@decryption/shamir.svg)](https://www.npmjs.com/package/@decryption/shamir) | [GitHub](./packages/shamir) | Shamir secret sharing with authenticated, versioned shares |
| **@decryption/wallet** | [![npm](https://img.shields.io/npm/v/@decryption/wallet.svg)](https://www.npmjs.com/package/@decryption/wallet) | [GitHub](./packages/wallet) | BIP39/BIP32 wallets and offline address derivation |
| **@decryption/keys** | [![npm](https://img.shields.io/npm/v/@decryption/keys.svg)](https://www.npmjs.com/package/@decryption/keys) | [GitHub](./packages/keys) | X25519 identities, recipient strings, files encrypted to recipients |
| **@decryption/secrets** | [![npm](https://img.shields.io/npm/v/@decryption/secrets.svg)](https://www.npmjs.com/package/@decryption/secrets) | [GitHub](./packages/secrets) | Team secrets file format, rekeying and `.env` export |
| **@decryption/accounts** | [![npm](https://img.shields.io/npm/v/@decryption/accounts.svg)](https://www.npmjs.com/package/@decryption/accounts) | [GitHub](./packages/accounts) | Constructive accounts and API keys, held in the local vault |
| **@decryption/webauthn** | [![npm](https://img.shields.io/npm/v/@decryption/webauthn.svg)](https://www.npmjs.com/package/@decryption/webauthn) | [GitHub](./packages/webauthn) | A software WebAuthn authenticator: passkeys kept in the vault |
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
dcrypt encrypt --binary --recipient dcrypt1… --in backup.tar --out backup.tar.dcrypt
                                        # any size, streamed, to X25519 recipients
dcrypt encrypt-section finance          # a folder of a git repository → finance.tar.dcrypt
dcrypt decrypt-workspace                # every bundle → its folder, one passphrase prompt
dcrypt doctor                           # is this machine and workspace set up safely?
dcrypt shamir split --shares 5 --threshold 3
dcrypt secrets init && dcrypt secrets set DATABASE_URL
dcrypt secrets run -- pnpm dev          # inject secrets without writing a .env

dcrypt account signin me@example.com --endpoint https://auth.example.com/graphql
dcrypt account key create ci --expires-days 30   # secret lands in the vault, not a .env
```

## Security model

- Argon2id for passphrase KDF, with calibrated parameters recorded in the envelope header.
- XChaCha20-Poly1305 AEAD — every ciphertext is authenticated; a wrong passphrase raises rather than
  returning an empty string.
- Large files use the payload layer of the [age](https://age-encryption.org/v1) format (STREAM):
  64 KiB ChaCha20-Poly1305 chunks whose nonce carries a counter and a last-chunk flag, so reordered,
  dropped or truncated chunks fail authentication. It is implemented as specified and checked against
  age's own test vectors — not a new construction.
- Encrypted workspaces ([how](./packages/cli#encrypted-workspaces)) keep a folder in git as one bundle
  in that file format: a deterministic tar whose first entry is a SHA-256 manifest, so file names are
  hidden and an unchanged folder is never re-encrypted. A bundle is decrypted beside the plaintext
  and verified against its manifest before it replaces anything, so a wrong passphrase or a damaged
  bundle changes nothing. A bundle does not authenticate its author; that is git's job.
- Team secrets use X25519 per-recipient wrapping (age/sops-shaped), so adding or removing a teammate never
  requires resharing a passphrase. Shamir is reserved for break-glass recovery.
- Private keys are never written to disk unencrypted. `dcrypt account` is the one command that uses the
  network: session tokens and API-key secrets it receives go straight into the encrypted vault.

## Audit status

"Audited" in this repository means the upstream cryptographic primitives, and only those. Stated
precisely:

**Audited upstream, by third parties.** The algorithms `dcrypt` relies on come from
[`@noble`](https://paulmillr.com/noble/) and [`@scure`](https://github.com/paulmillr/scure-base), whose
maintainers publish these audits:

| Upstream | Used here for | Third-party audit | Vendored |
|----------|---------------|-------------------|----------|
| `@noble/ciphers` | ChaCha20-Poly1305, XChaCha20-Poly1305 | Cure53, Sep 2024, at v1.0.0 — scope: everything | 2.2.0 |
| `@noble/hashes` | SHA-256, HMAC, HKDF, **Argon2id** | Cure53, Jan 2022, at v1.0.0 — scope: everything **except** `argon2`, `blake3`, `sha3-addons` and `sha1` | 2.2.0 |
| `@noble/curves` | X25519, secp256k1 | Trail of Bits, Feb 2023, at v0.7.3 — abstract modules and `secp256k1`; Kudelski, Sep 2023, at v1.2.0 — abstract modules; Cure53, Sep 2024, at v1.6.0 — ed25519 and montgomery (X25519) among others; Trail of Bits, Aug 2026, at v2.3.0 — everything | 2.2.0 |
| `@scure/base` | base64, bech32 | Cure53, Jan 2022, at v1.0.0 | 2.2.0 |
| `@scure/bip39` | mnemonics | Cure53, Jan 2022, at v1.0.0 | 2.2.0 |
| `@scure/bip32` | HD derivation | Cure53, Jan 2022, at v1.0.1 | 2.2.0 |

Three things follow from that table:

- **Argon2id, the passphrase KDF, is outside the audit scope.** Upstream says so explicitly. This
  repository checks it against the RFC 9106 test vector, but no auditor has reviewed that code.
- **No audit was performed at the vendored version.** Every third-party audit above is of an earlier
  release, apart from the 2026 `@noble/curves` audit, which is of a later one. Upstream additionally
  reports self-audits of the `@scure` packages at 2.2.0; those are not independent.
- **The forks are rebuilt, not re-audited.** The `@decryption/*` forks vendor the upstream sources
  unchanged, rewrite `@noble/*` / `@scure/*` import specifiers to the forks, and compile dual CJS+ESM
  builds. Nobody has audited that build output.

**Not audited by anyone outside this project.** Everything written here on top of those primitives:

- the `dcrypt` envelope formats — version 1 (`@decryption/core`) and the version 2 file format, including
  its header, header MAC and stanza encoding;
- this implementation of the STREAM chunked payload. The construction is age's and it decrypts age's
  test vectors, but the code is ours;
- X25519 recipient wrapping, identities and the keyring (`@decryption/keys`), team secrets files
  (`@decryption/secrets`), Shamir sharing, the vault, accounts and the WebAuthn authenticator;
- encrypted workspaces: the tar writer and reader, the hash manifest, the extraction checks and the
  pre-commit guard;
- the `dcrypt` CLI and the desktop app.

These are covered by this repository's tests and by review, which is not the same thing as an audit. If
your threat model needs an audited file-encryption tool end to end, use [age](https://age-encryption.org)
itself.
