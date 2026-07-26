# @decryption/core

<p align="center">
  Authenticated, self-describing envelope encryption — Argon2id + XChaCha20-Poly1305.
</p>

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

## Envelope format

```text
| magic  | ver | suite |  t   |  m   | p |  salt   |  nonce   | ciphertext || tag |
| DCRYPT |  1  |   1   | u32  | u32  | u8|  16 B   |   24 B   |    n B     ||16 B |
|<--------------------- 57-byte header, authenticated ------->|
```

- The header is passed as AEAD associated data, so Argon2id cost parameters cannot be
  downgraded by an attacker without invalidating the tag.
- Salt and nonce are drawn from the platform CSPRNG for every encryption.
- Suite and version bytes make future algorithm changes additive rather than breaking.

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
| `CorruptEnvelopeError` | Not a `dcrypt` envelope, or truncated |
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
