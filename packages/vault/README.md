# @decryption/vault

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/vault"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fvault%2Fpackage.json"/></a>
</p>


Passphrase-locked local vault runtime. Runs PostgreSQL in-process (PGlite),
deploys the `dcrypt-vault` pgpm module through `@pgpmjs/pglite-adapter`, and
persists the entire database as a single `@decryption/core` envelope around a
gzipped pgdata tarball — the file on disk leaks nothing, not even item titles.

```ts
import { Vault } from '@decryption/vault';

const vault = await Vault.open({
  file: '~/.dcrypt/data/db/vault.dcrypt',
  passphrase: 'master password',
  modulePath: '/path/to/pgpm-modules/dcrypt-vault',
});

const item = await vault.createItem('login', 'GitHub');
await vault.setField(item.id, 'password', 'password', 's3cret');
await vault.lock(); // saves, closes, zeroes key material
```
