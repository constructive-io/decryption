# @decryption/ciphers

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/ciphers"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fciphers%2Fpackage.json"/></a>
</p>


> **NOTE:** This is a fork of [`@noble/ciphers`](https://www.npmjs.com/package/@noble/ciphers) (v2.2.0).
> We dual-publish as both **CJS and ESM** because upstream is ESM-only (`"type": "module"`), which breaks
> `require()` in Jest, older bundlers and CJS-based Node.js tooling. The source is unchanged from upstream —
> only the build tooling differs, plus `@noble/*` / `@scure/*` import specifiers are rewritten to their
> `@decryption/*` forks.

Audited & minimal 0-dependency JS implementation of AES, ChaCha20-Poly1305 and XChaCha20-Poly1305. Dual CJS+ESM fork of @noble/ciphers.

## Installation

```bash
npm install @decryption/ciphers
```

## Usage

Import submodules directly — `dist/` is the package root once published, so deep imports work in both CJS and ESM:

```typescript
import { sha256 } from '@decryption/hashes/sha2';
import { xchacha20poly1305 } from '@decryption/ciphers/chacha';
```

Refer to the [upstream documentation](https://github.com/paulmillr/ciphers) for the full API.

## Syncing upstream

```bash
./scripts/vendor-fork.sh @noble/ciphers <version> ciphers
node scripts/fix-imports.js packages/ciphers ciphers
pnpm --filter @decryption/ciphers build && pnpm --filter @decryption/ciphers test
```

## License

MIT — Copyright (c) 2022 Paul Miller (https://paulmillr.com). See [LICENSE](./LICENSE).
