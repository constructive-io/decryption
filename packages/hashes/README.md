# @decryption/hashes

> **NOTE:** This is a fork of [`@noble/hashes`](https://www.npmjs.com/package/@noble/hashes) (v2.2.0).
> We dual-publish as both **CJS and ESM** because upstream is ESM-only (`"type": "module"`), which breaks
> `require()` in Jest, older bundlers and CJS-based Node.js tooling. The source is unchanged from upstream —
> only the build tooling differs, plus `@noble/*` / `@scure/*` import specifiers are rewritten to their
> `@decryption/*` forks.

Audited & minimal 0-dependency JS implementation of SHA, RIPEMD, BLAKE, HMAC, HKDF, PBKDF2, Scrypt & Argon2. Dual CJS+ESM fork of @noble/hashes.

## Installation

```bash
npm install @decryption/hashes
```

## Usage

Import submodules directly — `dist/` is the package root once published, so deep imports work in both CJS and ESM:

```typescript
import { sha256 } from '@decryption/hashes/sha2';
import { xchacha20poly1305 } from '@decryption/ciphers/chacha';
```

Refer to the [upstream documentation](https://github.com/paulmillr/hashes) for the full API.

## Syncing upstream

```bash
./scripts/vendor-fork.sh @noble/hashes <version> hashes
node scripts/fix-imports.js packages/hashes hashes
pnpm --filter @decryption/hashes build && pnpm --filter @decryption/hashes test
```

## License

MIT — Copyright (c) 2022 Paul Miller (https://paulmillr.com). See [LICENSE](./LICENSE).
