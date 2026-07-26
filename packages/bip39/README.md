# @decryption/bip39

> **NOTE:** This is a fork of [`@scure/bip39`](https://www.npmjs.com/package/@scure/bip39) (v2.2.0).
> We dual-publish as both **CJS and ESM** because upstream is ESM-only (`"type": "module"`), which breaks
> `require()` in Jest, older bundlers and CJS-based Node.js tooling. The source is unchanged from upstream —
> only the build tooling differs, plus `@noble/*` / `@scure/*` import specifiers are rewritten to their
> `@decryption/*` forks.

Audited & minimal implementation of BIP39 mnemonic phrases. Dual CJS+ESM fork of @scure/bip39.

## Installation

```bash
npm install @decryption/bip39
```

## Usage

Import submodules directly — `dist/` is the package root once published, so deep imports work in both CJS and ESM:

```typescript
import { sha256 } from '@decryption/hashes/sha2';
import { xchacha20poly1305 } from '@decryption/ciphers/chacha';
```

Refer to the [upstream documentation](https://github.com/paulmillr/bip39) for the full API.

## Syncing upstream

```bash
./scripts/vendor-fork.sh @scure/bip39 <version> bip39
node scripts/fix-imports.js packages/bip39 bip39
pnpm --filter @decryption/bip39 build && pnpm --filter @decryption/bip39 test
```

## License

MIT — Copyright (c) 2022 Paul Miller (https://paulmillr.com). See [LICENSE](./LICENSE).
