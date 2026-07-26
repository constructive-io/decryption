# @decryption/keys

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

Removing a recipient means dropping their stanza and re-sealing under a fresh file key — see
[`@decryption/secrets`](../secrets), which does the rekeying for you.
