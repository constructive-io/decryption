# @decryption/keys

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://github.com/constructive-io/decryption/blob/main/LICENSE">
    <img height="20" alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/keys"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fkeys%2Fpackage.json"/></a>
</p>


X25519 identities and recipient-based encryption: encrypt once, let several people decrypt, add or
remove them without a new passphrase ceremony. The construction follows
[age](https://age-encryption.org): a random file key encrypts the payload, and one *stanza* per
recipient wraps that file key under an ephemeral X25519 exchange.

## Installation

```bash
npm install @decryption/keys
```

## Usage

```typescript
import {
  generateIdentity,
  identityToString,
  recipientToString,
  sealTo,
  openAs,
} from '@decryption/keys';

const alice = generateIdentity();
recipientToString(alice.publicKey); // dcrypt1…  — share this
identityToString(alice);            // DCRYPTSEC1… — keep this secret

const sealed = sealTo('super secret', [recipientToString(alice.publicKey), bobRecipient]);
new TextDecoder().decode(openAs(sealed, alice)); // 'super secret'
```

### Recovering an identity from a mnemonic

```typescript
import { identityFromSeed } from '@decryption/keys';
import { mnemonicToSeed } from '@decryption/wallet';

const identity = identityFromSeed(mnemonicToSeed(mnemonic), 0);
```

Deterministic, so the same BIP39 words always give the same identity — no separate key backup.
Use `index` for distinct identities (laptop, CI, break-glass) from one seed.

### Files, of any size

`sealTo` produces JSON for small values. For files, the same recipient wrapping goes into the binary,
chunked [version 2 format](../core#file-format-version-2):

```typescript
import { sealFileTo, openFileAs, createRecipientFileEncryptor } from '@decryption/keys';

const file = sealFileTo(bytes, [aliceRecipient, bobRecipient]); // Uint8Array
openFileAs(file, alice);

// streamed: write the header, then the stream's output
const { header, stream } = createRecipientFileEncryptor([aliceRecipient, bobRecipient]);
```

`fileRecipients(header)` lists the fingerprints a file is encrypted to without any key, and
`unwrapWithIdentity` throws `NotRecipientError` when yours is not among them.

## Format

```typescript
interface SealedPayload {
  stanzas: { recipient: string; ephemeral: string; wrapped: string }[];
  ciphertext: string;
}
```

- `recipient` is a fingerprint (truncated SHA-256 of the public key), not the key itself, so a
  sealed file does not publish the full recipient list.
- `wrapped` is the file key sealed under
  `HKDF-SHA256(X25519(ephemeral, recipient), salt = ephemeral ‖ recipient, info = "dcrypt-recipient-v1")`.
- `ciphertext` is XChaCha20-Poly1305 via [`@decryption/core`](../core), optionally bound to
  associated data.

In a version 2 file each recipient is one 112-byte stanza carrying the same three fields in binary:

```text
| fingerprint 8 B | ephemeral public key 32 B | wrapped file key 72 B |
```

None of this — the wrapping, the identity encoding or the keyring — has been audited by a third
party; only the underlying `@noble` primitives have. See
[Audit status](../../README.md#audit-status).

Removing a recipient means dropping their stanza and re-sealing under a fresh file key — see
[`@decryption/secrets`](../secrets), which does the rekeying for you.
