/**
 * Audited & minimal JS implementation of Salsa20, ChaCha and AES. Check out individual modules.
 * @example
```js
import { gcm, aessiv } from './aes';
import { xsalsa20poly1305 } from './salsa';
import { secretbox } from './salsa'; // == xsalsa20poly1305
import { chacha20poly1305, xchacha20poly1305 } from './chacha';

// Unauthenticated encryption: make sure to use HMAC or similar
import { ctr, cfb, cbc, ecb } from './aes';
import { salsa20, xsalsa20 } from './salsa';
import { chacha20, xchacha20, chacha8, chacha12 } from './chacha';

// KW
import { aeskw, aeskwp } from './aes';

// Utilities
import { managedNonce, randomBytes, bytesToHex, hexToBytes } from './utils';
import { poly1305 } from './_poly1305';
import { ghash, polyval } from './_polyval';
```
 * @module
 */
throw new Error('root module cannot be imported: import submodules instead. Check out README');
