# dcrypt-vault

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
   <a href="https://www.npmjs.com/package/dcrypt-vault"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fdcrypt-vault%2Fpackage.json"/></a>
</p>

## Developing

This module was generated with `pgpm init` in a **PGlite** workspace. Its tests run against in-process [PGlite](https://pglite.dev) (WASM Postgres) via [`pglite-test`](https://www.npmjs.com/package/pglite-test) — no Postgres server, no Docker.

```sh
# Install dependencies
pnpm install

# Run tests (in-process PGlite — nothing else to start)
pnpm test

# Run tests in watch mode
pnpm test:watch
```

The same `deploy/` / `verify/` / `revert/` scripts also run unchanged on a real Postgres server via `pgsql-test`.

### PGlite notes

- **Roles.** `getConnections()` seeds the standard app roles (`anonymous`/`authenticated`/`administrator`), so `db.setContext({ role })` works out of the box. Opt out with `pglite: { roles: false }` to manage your own (see the [`pglite-test`](https://www.npmjs.com/package/pglite-test) docs).
- **Extensions.** WASM extensions (e.g. pgvector via `@electric-sql/pglite-pgvector`) are registered at construction with `pglite.extensions` and installed with `CREATE EXTENSION` in `extensionSql` — pgpm's `cleanSql` strips `CREATE EXTENSION` from migrations, so they're provisioned out-of-band.
- **In-memory by default.** Persist with `getConnections({ pglite: { dataDir: './.pglite' } })`.

## Credits

**🛠 Built by the [Constructive](https://constructive.io) team — creators of modular Postgres tooling for secure, composable backends. If you like our work, contribute on [GitHub](https://github.com/constructive-io).**

## Disclaimer

AS DESCRIBED IN THE LICENSES, THE SOFTWARE IS PROVIDED "AS IS", AT YOUR OWN RISK, AND WITHOUT WARRANTIES OF ANY KIND.

No developer or entity involved in creating this software will be liable for any claims or damages whatsoever associated with your use, inability to use, or your interaction with other users of the code, including any direct, indirect, incidental, special, exemplary, punitive or consequential damages, or loss of profits, cryptocurrencies, tokens, or anything else of value.
