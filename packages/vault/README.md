# @decryption/vault

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
