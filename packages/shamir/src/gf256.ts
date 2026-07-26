/**
 * Arithmetic in GF(2^8) with the AES reduction polynomial 0x11b, used for Shamir secret sharing.
 *
 * Multiplication goes through log/exp tables. Table lookups are not constant time; this is
 * acceptable here because splitting and combining happen locally on data the caller already
 * holds, never as a network-visible oracle.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

export const add = (a: number, b: number): number => a ^ b;

export const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

export const div = (a: number, b: number): number => {
  if (b === 0) throw new Error('division by zero in GF(256)');
  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
};

/** Evaluates a polynomial (coefficients low-order first) at `x`, using Horner's method. */
export const evaluate = (coefficients: Uint8Array, x: number): number => {
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) result = add(mul(result, x), coefficients[i]);
  return result;
};

/**
 * Lagrange interpolation at x = 0 — recovers the constant term (the secret byte) from
 * `(x, y)` pairs.
 */
export const interpolateAtZero = (xs: Uint8Array, ys: Uint8Array): number => {
  let secret = 0;
  for (let i = 0; i < xs.length; i++) {
    let basis = 1;
    for (let j = 0; j < xs.length; j++) {
      if (i === j) continue;
      basis = mul(basis, div(xs[j], add(xs[i], xs[j])));
    }
    secret = add(secret, mul(ys[i], basis));
  }
  return secret;
};
