# @decryption/curves

> **NOTE:** This is a fork of [`@noble/curves`](https://www.npmjs.com/package/@noble/curves) (v2.2.0).
> We dual-publish as both **CJS and ESM** because upstream is ESM-only (`"type": "module"`), which breaks
> `require()` in Jest, older bundlers and CJS-based Node.js tooling. The source is unchanged from upstream —
> only the build tooling differs, plus `@noble/*` / `@scure/*` import specifiers are rewritten to their
> `@decryption/*` forks.

Audited & minimal 0-dependency JS implementation of elliptic curves: secp256k1, ed25519, x25519. Dual CJS+ESM fork of @noble/curves.

## Installation

```bash
npm install @decryption/curves
```

## Usage

Import submodules directly — `dist/` is the package root once published, so deep imports work in both CJS and ESM:

```typescript
import { sha256 } from '@decryption/hashes/sha2';
import { xchacha20poly1305 } from '@decryption/ciphers/chacha';
```

Refer to the [upstream documentation](https://github.com/paulmillr/curves) for the full API.

## Syncing upstream

```bash
./scripts/vendor-fork.sh @noble/curves <version> curves
node scripts/fix-imports.js packages/curves curves
pnpm --filter @decryption/curves build && pnpm --filter @decryption/curves test
```

## License

MIT — Copyright (c) 2022 Paul Miller (https://paulmillr.com). See [LICENSE](./LICENSE).
