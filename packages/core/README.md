# @decryption/core

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
  <a href="https://www.npmjs.com/package/@decryption/core"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fcore%2Fpackage.json"/></a>
</p>


<p align="center">
  Authenticated, self-describing envelope encryption — Argon2id + XChaCha20-Poly1305, with a
  chunked file format for payloads of any size.
</p>

Two formats share the `DCRYPT` magic and a version byte:

| Version | For | Shape |
|---------|-----|-------|
| 1 | short secrets: a value, a mnemonic, a key | one AEAD over the whole payload, held in memory |
| 2 | files of any size, one or many ways to unlock | header + 64 KiB authenticated chunks, streamable |

Runs anywhere `Uint8Array` does: this package has no Node.js dependency.

## Installation

```bash
npm install @decryption/core
```

## Usage

```typescript
import { encryptToString, decryptFromString } from '@decryption/core';

const armored = encryptToString('hunter2 is not a good password', passphrase);
// => "dcrypt.v1.RENSWVBUAQEAAAAD..."

const plaintext = decryptFromString(armored, passphrase);
```

Binary form, and a cheaper KDF profile for interactive unlocks:

```typescript
import { encrypt, decrypt } from '@decryption/core';

const envelope = encrypt(fileBytes, passphrase, { kdf: 'interactive' });
const bytes = decrypt(envelope, passphrase);
```

Bind a ciphertext to its context so values cannot be swapped between fields:

```typescript
const value = encrypt(secret, passphrase, { aad: 'DATABASE_URL' });
decrypt(value, passphrase, { aad: 'DATABASE_URL' }); // ok
decrypt(value, passphrase, { aad: 'STRIPE_KEY' });   // throws WrongPassphraseError
```

## Files of any size

```typescript
import { encryptFile, decryptFile } from '@decryption/core';

const file = encryptFile(bytes, passphrase);   // Uint8Array, version 2
const back = decryptFile(file, passphrase);
```

When the payload does not fit in memory, drive the cipher yourself. It is a plain
`update()` / `finish()` object, so it fits any stream API:

```typescript
import {
  createFileEncryptor,
  createFileDecryptor,
  generateFileKey,
  tryParseFileHeader,
  unwrapWithPassphrase,
  wrapWithPassphrase,
} from '@decryption/core';

const fileKey = generateFileKey();
const { header, stream } = createFileEncryptor(fileKey, [wrapWithPassphrase(fileKey, passphrase)]);

write(header);
for await (const piece of source) write(stream.update(piece));
write(stream.finish());

// reading: the header first (undefined until enough bytes have arrived), then the chunks
const parsed = tryParseFileHeader(prefix);
const decryptor = createFileDecryptor(parsed, unwrapWithPassphrase(parsed, passphrase));
emit(decryptor.update(prefix.subarray(parsed.length)));
for await (const piece of rest) emit(decryptor.update(piece));
emit(decryptor.finish()); // throws if the file was truncated
```

Plaintext returned by `update()` is authenticated chunk by chunk, but the file is only known to be
complete once `finish()` returns. Treat streamed output as provisional until then — write it to a
temporary file and rename it afterwards, as the `dcrypt` CLI does.

For recipients instead of a passphrase, see [`@decryption/keys`](../keys).

## Envelope format (version 1)

```text
| magic  | ver | suite |  t   |  m   | p |  salt   |  nonce   | ciphertext || tag |
| DCRYPT |  1  |   1   | u32  | u32  | u8|  16 B   |   24 B   |    n B     ||16 B |
|<--------------------- 57-byte header, authenticated ------->|
```

- The header is passed as AEAD associated data, so Argon2id cost parameters cannot be
  downgraded by an attacker without invalidating the tag.
- Salt and nonce are drawn from the platform CSPRNG for every encryption.
- Suite and version bytes make future algorithm changes additive rather than breaking.

## File format (version 2)

```text
| magic  | ver | suite | count | stanza … stanza | header MAC | nonce | chunk … chunk |
| DCRYPT |  2  |   2   | u16   |                 |    32 B    | 16 B  |               |
|<------------- authenticated by the MAC ------->|

stanza: | type u8 | length u16 | body |
chunk:  ChaCha20-Poly1305( ≤ 64 KiB of plaintext ) — ciphertext || 16-byte tag
```

The design is the [age file format](https://age-encryption.org/v1) with binary fields in place of
text lines. It is deliberately not a new construction:

- A random 32-byte **file key** encrypts the payload. Each **stanza** holds one wrapped copy of it:
  type `1` under a passphrase (Argon2id parameters, salt, then the key sealed with
  XChaCha20-Poly1305), type `2` for an X25519 recipient ([`@decryption/keys`](../keys)). A
  passphrase stanza must be the only stanza, as with age's scrypt recipient.
- The **header MAC** is `HMAC-SHA256` under `HKDF-SHA256(file key, info = "header")`. It is checked
  before any payload is decrypted, so stanzas and KDF costs cannot be edited or downgraded.
- The **payload** is age's STREAM: the key is
  `HKDF-SHA256(file key, salt = nonce, info = "payload")`; each chunk's 12-byte nonce is an 11-byte
  big-endian counter followed by a flag byte, `0x01` on the last chunk and `0x00` otherwise. The last
  chunk may be short, and may be empty only if the whole payload is.

Because the counter and the last-chunk flag are part of every nonce, a chunk that is reordered,
duplicated, dropped or cut off fails authentication. The decryptor here is stricter than a minimal
reader: it never releases a chunk as non-final unless more ciphertext follows it. The test suite
decrypts age's own STREAM vectors ([C2SP/CCTV](https://github.com/C2SP/CCTV/tree/main/age)) with this
code.

Unlocking a file a new way means adding a stanza type; the payload never changes. Readers keep
stanzas they do not recognise, and bound what they will buffer (1024 stanzas of at most 1024 bytes).

`armorFile` / `dearmorFile` give the text form, `dcrypt.v2.<base64>`, for small files that have to
live in text. Version 2 has no associated-data option.

### What is audited

The primitives underneath — ChaCha20-Poly1305, XChaCha20-Poly1305, HKDF, HMAC, SHA-256 — come from
`@noble`, which has been audited upstream. Argon2id is outside that audit's scope, and neither
envelope format, nor this STREAM implementation, has been audited by a third party. The exact
boundary is in the [repository README](../../README.md#audit-status).

## KDF profiles

| Profile | Memory | Passes | Use for |
|---------|--------|--------|---------|
| `interactive` | 64 MiB | 2 | CLI prompts and UI unlock |
| `moderate` (default) | 256 MiB | 3 | files at rest |
| `sensitive` | 1 GiB | 4 | long-lived recovery material |

Parameters are recorded in the envelope, so raising the defaults never breaks old ciphertexts.

## Errors

Every failure mode has a distinct type — decryption never silently returns an empty string:

| Error | Meaning |
|-------|---------|
| `WrongPassphraseError` | Passphrase is wrong or the ciphertext was tampered with |
| `CorruptEnvelopeError` | Not a `dcrypt` envelope, truncated, or a file chunk failed authentication |
| `UnsupportedEnvelopeError` | Newer format version or unknown algorithm suite |
| `InvalidParametersError` | Caller passed arguments that cannot be secure |

## Raw-key API

For callers that already hold a 32-byte key (e.g. per-recipient wrapping in
[`@decryption/secrets`](../secrets)):

```typescript
import { sealWithKey, openWithKey } from '@decryption/core';

const sealed = sealWithKey(key, plaintext, 'context');
const opened = openWithKey(key, sealed, 'context');
```
