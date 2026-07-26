/**
 * Audited & minimal JS implementation of elliptic curve cryptography.
 * @module
 * @example
```js
import { secp256k1, schnorr } from './secp256k1';
import { ed25519, ed25519ph, ed25519ctx, x25519, ristretto255 } from './ed25519';
import { ed448, ed448ph, x448, decaf448 } from './ed448';
import { p256, p384, p521 } from './nist';
import { bls12_381 } from './bls12-381';
import { bn254 } from './bn254';
import {
  jubjub,
  babyjubjub,
  brainpoolP256r1,
  brainpoolP384r1,
  brainpoolP512r1,
} from './misc';
import * as webcrypto from './webcrypto';

// hash-to-curve
import { secp256k1_hasher } from './secp256k1';
import { p256_hasher, p384_hasher, p521_hasher } from './nist';
import { ristretto255_hasher } from './ed25519';
import { decaf448_hasher } from './ed448';

// OPRFs
import { p256_oprf, p384_oprf, p521_oprf } from './nist';
import { ristretto255_oprf } from './ed25519';
import { decaf448_oprf } from './ed448';

// utils
import { bytesToHex, hexToBytes, concatBytes } from './abstract/utils';
import { Field } from './abstract/modular';
```
 */
throw new Error('root module cannot be imported: import submodules instead. Check out README');
