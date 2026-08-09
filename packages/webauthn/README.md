# @decryption/webauthn

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/webauthn"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fwebauthn%2Fpackage.json"/></a>
</p>

A software WebAuthn authenticator. A passkey is not a stored password — it is a P-256 keypair whose
private half never leaves the machine, and whose signature covers the site that asked for it. This
package makes those keys, signs the challenges a relying party issues, and keeps the private half in
the encrypted [dcrypt vault](https://www.npmjs.com/package/@decryption/vault).

## Installation

```bash
npm install @decryption/webauthn
```

## Usage

```typescript
import { PasskeyStore } from '@decryption/webauthn';
import { Vault, defaultModulePath } from '@decryption/vault';

const vault = await Vault.open({ file, passphrase, modulePath: defaultModulePath() });
const passkeys = new PasskeyStore(vault);

// registration: the challenge comes from the relying party
const { record, response } = await passkeys.register({
  rpId: 'auth.example.com',
  origin: 'https://auth.example.com',
  challenge, // base64url, from webauthn_begin_registration
  userName: 'dev@example.com',
});

// sign-in: sign the challenge the site issued, and nothing else
const assertion = await passkeys.assert(record.itemId, { origin, challenge });
```

`response` and `assertion` are shaped exactly as `navigator.credentials.create()` and `.get()`
resolve, so a relying party — `@simplewebauthn/server`, or Constructive's `auth:passkey`
procedures behind one — verifies them without knowing dcrypt exists.

Without a vault, `createPasskey` and `assertPasskey` do the same work in memory and hand back the
key for the caller to store.

## What is stored

A passkey is a `passkey` vault item. Only the private key is concealed: a site name and a sign count
are not secrets, and leaving them readable is what lets a list render without decrypting anything.

| Field           | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `rp_id`         | The site the key signs for, and no other                       |
| `credential_id` | What the site calls this key                                   |
| `user_handle`   | Opaque user id, so a site can sign you in without a username   |
| `user_name`     | The account it belongs to                                      |
| `sign_count`    | Advanced and persisted on every assertion                      |
| `private_key`\* | The 32-byte P-256 scalar                                       |

\* concealed. Because it is a vault item, a passkey is covered by the master passphrase, by lock and
by backup and restore — so unlike a hardware key it survives a lost laptop.

## What it does not claim

Attestation is `none` with an all-zero AAGUID: this is software, and it says so. A relying party that
requires hardware attestation should reject it, which is the correct outcome.

## License

MIT
