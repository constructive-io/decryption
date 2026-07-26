# @decryption/base

> **NOTE:** This is a fork of [`@scure/base`](https://www.npmjs.com/package/@scure/base) (v2.2.0).
> We dual-publish as both **CJS and ESM** because upstream is ESM-only (`"type": "module"`), which breaks
> `require()` in Jest, older bundlers and CJS-based Node.js tooling. The source is unchanged from upstream —
> only the build tooling differs, plus `@noble/*` / `@scure/*` import specifiers are rewritten to their
> `@decryption/*` forks.

Audited & minimal 0-dependency implementation of bech32, base64, base58, base32 & base16. Dual CJS+ESM fork of @scure/base.

## Installation

```bash
npm install @decryption/base
```

## Usage

Import submodules directly — `dist/` is the package root once published, so deep imports work in both CJS and ESM:

```typescript
import { sha256 } from '@decryption/hashes/sha2';
import { xchacha20poly1305 } from '@decryption/ciphers/chacha';
```

Refer to the [upstream documentation](https://github.com/paulmillr/base) for the full API.

## Syncing upstream

```bash
./scripts/vendor-fork.sh @scure/base <version> base
node scripts/fix-imports.js packages/base base
pnpm --filter @decryption/base build && pnpm --filter @decryption/base test
```

## License

MIT — Copyright (c) 2022 Paul Miller (https://paulmillr.com). See [LICENSE](./LICENSE).
