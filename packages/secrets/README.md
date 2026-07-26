# @decryption/secrets

Team secrets in a file you can commit. Every value is encrypted individually, so a pull request
shows *which* secret changed without revealing any of them, and membership is managed by adding or
removing recipients rather than by resharing a passphrase.

## Installation

```bash
npm install @decryption/secrets
```

## Usage

```typescript
import {
  createVault,
  setValues,
  getValue,
  addRecipient,
  exportValues,
  serializeVault,
  parseVault,
} from '@decryption/secrets';

let vault = createVault({
  name: 'production',
  recipients: [{ label: 'dan', recipient: 'dcrypt1…' }],
});

vault = setValues(vault, me, {
  DATABASE_URL: 'postgres://…',
  STRIPE_KEY: 'sk_live_…',
});

writeFileSync('secrets/production.json', serializeVault(vault));
```

Reading, on another machine:

```typescript
const vault = parseVault(readFileSync('secrets/production.json', 'utf8'));
getValue(vault, me, 'DATABASE_URL');
writeFileSync('.env', exportValues(vault, me, 'dotenv'));
```

Formats: `dotenv`, `shell` (`export FOO='…'`), `yaml`, `json`.

## Membership

```typescript
vault = addRecipient(vault, me, { label: 'ada', recipient: 'dcrypt1…' });
vault = removeRecipient(vault, me, 'ada');
```

Both **rekey the vault**: a fresh file key is generated and every value re-encrypted, so a new
recipient cannot read older copies of the file, and a removed one cannot read newer ones. Rotate
the underlying credentials too — anything a departing teammate already read is already read.

## File format

```json
{
  "dcrypt": 1,
  "name": "production",
  "recipients": [{ "label": "dan", "recipient": "dcrypt1…" }],
  "keys": [{ "recipient": "9f2c…", "ephemeral": "…", "wrapped": "…" }],
  "values": {
    "DATABASE_URL": "…base64…",
    "STRIPE_KEY": "…base64…"
  }
}
```

- One **file key** encrypts all values; `keys` holds one X25519 stanza per recipient
  ([`@decryption/keys`](../keys)).
- Each value is XChaCha20-Poly1305 with the secret's own name as associated data, so a ciphertext
  copied to a different key fails to decrypt instead of silently succeeding.
- Recipients, stanzas and secret names are sorted, and the file ends with a newline — serializing
  the same logical vault twice gives identical bytes, which keeps diffs minimal.
- Secret **names are not encrypted**. That is deliberate: it is what makes reviews useful. Do not
  put sensitive information in a key name.

## Break-glass recovery

```typescript
import { splitRecoveryIdentity, recoverIdentity } from '@decryption/secrets';

const shares = splitRecoveryIdentity(breakGlass, { shares: 5, threshold: 3 });
const restored = recoverIdentity([shares[0], shares[3], shares[4]]);
```

Add `breakGlass` to the vault as an ordinary recipient and give one share to each custodian.
Shamir is for this case only — see [`@decryption/shamir`](../shamir).
