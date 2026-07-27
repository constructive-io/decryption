# @decryption/shamir

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/decryption/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/decryption/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="https://www.npmjs.com/package/@decryption/shamir"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/decryption?filename=packages%2Fshamir%2Fpackage.json"/></a>
</p>


Split a secret into `n` shares, any `t` of which reconstruct it. Fewer than `t` shares reveal
nothing but the secret's length.

## Installation

```bash
npm install @decryption/shamir
```

## Usage

```typescript
import { splitToStrings, combineToString } from '@decryption/shamir';

const shares = splitToStrings(mnemonic, { shares: 5, threshold: 3 });
// [ "dcrypt-share.v1.RFNIUgEDAQ...", ... ]

const recovered = combineToString([shares[4], shares[0], shares[2]]); // any 3
```

Binary API, for splitting arbitrary bytes:

```typescript
import { split, combine, parseShare, verify } from '@decryption/shamir';

const shares = split(keyBytes, { shares: 3, threshold: 2 });
parseShare(shares[0]); // { version, threshold, index, group }
verify([shares[0], shares[1]]); // true
```

## Share format

```text
| magic | ver | threshold | index | group id |  digest  | body   |
| DSHR  |  1  |    u8     |  u8   |   8 B    |   8 B    |  n B   |
```

- **group id** — random per split. Combining shares from two different splits fails instead of
  silently producing garbage.
- **digest** — truncated `SHA-256(group ‖ secret)`. The reconstructed secret is checked against it,
  so a corrupted or forged share raises `ReconstructionError`. Because the group id is random and
  independent of the secret, the digest tells an attacker holding fewer than `threshold` shares
  nothing.
- **threshold** is recorded in the share, so `combine` can refuse to run with too few inputs
  rather than returning plausible-looking nonsense.

## Errors

| Error | Meaning |
|-------|---------|
| `InvalidShareError` | Malformed share, mixed groups, duplicate index, or too few shares |
| `ReconstructionError` | Enough shares, but the result failed its integrity check |
| `ShamirError` | Base class; invalid split parameters |

## When to use it

Shamir is for **recovery**, not day-to-day sharing: use it to escrow a break-glass key across
several people or locations. For sharing team secrets that change membership, use
[`@decryption/secrets`](../secrets), which encrypts to each teammate's public key so recipients can
be added or removed without a new ceremony.

## Note on timing

GF(256) multiplication uses log/exp tables, which are not constant time. Splitting and combining
run locally on data the caller already holds, never as a remote oracle, so this is not a
practical exposure.
