import { bytesToHex, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import {
  armorShare,
  combine,
  combineToString,
  dearmorShare,
  div,
  evaluate,
  interpolateAtZero,
  InvalidShareError,
  mul,
  parseShare,
  ReconstructionError,
  ShamirError,
  split,
  splitToStrings,
  verify,
} from '../src';

const SECRET = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('gf256', () => {
  it('is a field: multiplication is associative, commutative and invertible', () => {
    for (let i = 0; i < 64; i++) {
      const [a, b, c] = randomBytes(3);
      expect(mul(a, b)).toBe(mul(b, a));
      expect(mul(mul(a, b), c)).toBe(mul(a, mul(b, c)));
      if (b !== 0) expect(div(mul(a, b), b)).toBe(a);
    }
  });

  it('interpolates the constant term of a polynomial', () => {
    const coefficients = Uint8Array.from([42, 7, 99]);
    const xs = Uint8Array.from([1, 2, 3]);
    const ys = Uint8Array.from([...xs].map((x) => evaluate(coefficients, x)));
    expect(interpolateAtZero(xs, ys)).toBe(42);
  });
});

describe('split/combine', () => {
  it('reconstructs from any threshold-sized subset', () => {
    const shares = split(SECRET, { shares: 5, threshold: 3 });
    const subsets = [
      [0, 1, 2],
      [0, 2, 4],
      [2, 3, 4],
      [1, 3, 4],
    ];
    for (const subset of subsets) {
      expect(combineToString(subset.map((i) => shares[i]))).toBe(SECRET);
    }
  });

  it('reconstructs from more shares than the threshold', () => {
    const shares = split(SECRET, { shares: 4, threshold: 2 });
    expect(combineToString(shares)).toBe(SECRET);
  });

  it('round-trips binary secrets of assorted sizes', () => {
    for (const size of [1, 16, 32, 1024]) {
      const secret = randomBytes(size);
      const shares = split(secret, { shares: 3, threshold: 2 });
      expect(bytesToHex(combine([shares[2], shares[0]]))).toBe(bytesToHex(secret));
    }
  });

  it('refuses to combine fewer shares than the threshold', () => {
    const shares = split(SECRET, { shares: 5, threshold: 3 });
    expect(() => combine(shares.slice(0, 2))).toThrow(InvalidShareError);
  });

  it('rejects duplicate shares', () => {
    const shares = split(SECRET, { shares: 3, threshold: 2 });
    expect(() => combine([shares[0], shares[0]])).toThrow(InvalidShareError);
  });

  it('rejects shares from a different split', () => {
    const a = split(SECRET, { shares: 3, threshold: 2 });
    const b = split(SECRET, { shares: 3, threshold: 2 });
    expect(() => combine([a[0], b[1]])).toThrow(InvalidShareError);
  });

  it('detects a corrupted share instead of returning garbage', () => {
    const shares = split(SECRET, { shares: 3, threshold: 2 });
    shares[1][30] ^= 0x01;
    expect(() => combine([shares[0], shares[1]])).toThrow(ReconstructionError);
    expect(verify([shares[0], shares[1]])).toBe(false);
  });

  it('exposes threshold and index without revealing the secret', () => {
    const shares = split(SECRET, { shares: 4, threshold: 3 });
    expect(parseShare(shares[2])).toMatchObject({ threshold: 3, index: 3, version: 1 });
    for (const share of shares) {
      expect(bytesToHex(share)).not.toContain(bytesToHex(utf8ToBytes(SECRET)));
    }
  });

  it('validates split parameters', () => {
    expect(() => split(SECRET, { shares: 1, threshold: 1 })).toThrow(ShamirError);
    expect(() => split(SECRET, { shares: 3, threshold: 4 })).toThrow(ShamirError);
    expect(() => split(SECRET, { shares: 300, threshold: 2 })).toThrow(ShamirError);
    expect(() => split('', { shares: 3, threshold: 2 })).toThrow(ShamirError);
  });
});

describe('armor', () => {
  it('round-trips shares through their text form', () => {
    const shares = splitToStrings(SECRET, { shares: 3, threshold: 2 });
    expect(shares[0].startsWith('dcrypt-share.v1.')).toBe(true);
    expect(combineToString([shares[1], shares[2]])).toBe(SECRET);
  });

  it('rejects foreign text', () => {
    expect(() => dearmorShare('hello')).toThrow(InvalidShareError);
    expect(() => dearmorShare('dcrypt-share.v1.!!!')).toThrow(InvalidShareError);
    expect(() => parseShare(armorShare as never as Uint8Array)).toThrow();
  });
});
