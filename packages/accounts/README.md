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
| `api_key` | `endpoint`, `account_id`, `key_id`, `api_key`\*, `expires_at`, `database_id`, `principal_id`, `org_id` |

\* concealed. `accessToken()` returns `null` rather than an expired token, so a caller cannot
present a dead credential by accident.

## Principals

A principal is a scoped sub-identity — what an API key or an agent actually acts as. It is owned by
a human account and can only ever *narrow* that human: read-only, restricted per scope by a
permission mask, and optionally allowed to skip MFA step-up so CI is not blocked on a phone.

```typescript
const principalId = await accounts.createPrincipal(account.itemId, {
  name: 'ci-deploy',
  orgId,
  isReadOnly: true,
  bypassStepUp: true,
});

// mint the key *as* the principal, so it carries the principal's scope
await accounts.createApiKey(account.itemId, { name: 'ci', principalId, orgId });

for (const principal of await accounts.listPrincipals(account.itemId)) {
  principal.entityIds; // what it reaches
  principal.scopes; // per-scope overrides: allowedMask, isActive, isReadOnly
}
```

A scope with no override row means the principal inherits its owner there; `allowedMask` is
AND-ed with the owner's permissions during the SPRT cascade, so an override can only take access
away. Principals are read from the server on demand rather than cached, because a stale local copy
of someone's permissions is worse than none.

## Serving a harness

`VaultCredentials` is a credential provider shaped like the harness contract, reading from the
unlocked vault instead of a plaintext `account.json`:

```typescript
const credentials = new VaultCredentials(accounts);

await credentials.accountBearer(); // the signed-in account's token, or null
await credentials.dataToken(databaseId); // { token, origin: 'vault' }
```

It refuses rather than guesses: `null` when no account is signed in, when several are and none was
named, when the token has expired, and when no key — or more than one — is tagged for that
database. Tag one with `accounts.assignKeyToDatabase(keyItemId, databaseId)` or
`createApiKey({ databaseId })`. Nothing is cached; every call re-reads the vault, so locking the
vault cuts every consumer off at once.

## Testing without a server

`AccountManager` takes an `AuthClientFactory`, so the whole vault side runs against a fake:

```typescript
const accounts = new AccountManager(vault, {
  createClient: () => myFakeAuthClient,
});
```

## License

MIT
