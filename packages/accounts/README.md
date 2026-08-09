# @decryption/accounts

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/accounts"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Faccounts%2Fpackage.json"/></a>
</p>

Constructive accounts and API keys, held in the local dcrypt vault. Sign in against an auth
endpoint with [`@constructive-io/sdk`](https://www.npmjs.com/package/@constructive-io/sdk), mint and
revoke API keys, and keep every token and key secret inside the same encrypted file as the rest of
the vault — covered by the master passphrase, by lock, and by backup and restore.

## Installation

```bash
npm install @decryption/accounts
```

## Usage

```typescript
import { AccountManager } from '@decryption/accounts';
import { Vault, defaultModulePath } from '@decryption/vault';

const vault = await Vault.open({
  file: '~/.dcrypt/data/db/vault.dcrypt',
  passphrase,
  modulePath: defaultModulePath(),
});

const accounts = new AccountManager(vault);

const account = await accounts.signIn({
  endpoint: 'http://auth.localhost:3000/graphql',
  email: 'dev@example.com',
  password,
});

const key = await accounts.createApiKey(account.itemId, {
  name: 'ci',
  expiresIn: { days: 30 },
});

// the secret is only ever read back out of the vault
const secret = await accounts.revealApiKey(key.itemId);

await accounts.revokeApiKey(key.itemId);
```

## What is stored

Each account is an `account` item and each key an `api_key` item, so both are searchable, taggable
and audited like every other vault entry.

| Item      | Fields                                                             |
| --------- | ------------------------------------------------------------------ |
| `account` | `endpoint`, `email`, `user_id`, `access_token`\*, `access_token_expires_at` |
| `api_key` | `endpoint`, `account_id`, `key_id`, `api_key`\*, `expires_at`       |

\* concealed. `accessToken()` returns `null` rather than an expired token, so a caller cannot
present a dead credential by accident.

## Testing without a server

`AccountManager` takes an `AuthClientFactory`, so the whole vault side runs against a fake:

```typescript
const accounts = new AccountManager(vault, {
  createClient: () => myFakeAuthClient,
});
```

## License

MIT
