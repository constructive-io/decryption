import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';

import { estimateEntropyBits, generatePassword } from '../src/shared/password';

const random = (n: number): Uint8Array => new Uint8Array(randomBytes(n));

describe('generatePassword', () => {
  it('generates the requested length', () => {
    for (const length of [8, 16, 24, 64]) {
      expect(generatePassword({ length }, random)).toHaveLength(length);
    }
  });

  it('includes a character from every enabled class', () => {
    for (let i = 0; i < 20; i++) {
      const value = generatePassword({ length: 8 }, random);
      expect(value).toMatch(/[a-z]/);
      expect(value).toMatch(/[A-Z]/);
      expect(value).toMatch(/[0-9]/);
      expect(value).toMatch(/[!@#$%^&*()\-_=+[\]{};:,.<>?]/);
    }
  });

  it('respects disabled classes', () => {
    const value = generatePassword({ length: 32, symbols: false, digits: false }, random);
    expect(value).toMatch(/^[a-zA-Z]+$/);
  });

  it('rejects invalid configurations', () => {
    expect(() => generatePassword({ length: 2 }, random)).toThrow(/length/);
    expect(() =>
      generatePassword({ length: 16, lower: false, upper: false, digits: false, symbols: false }, random)
    ).toThrow(/character class/);
  });

  it('produces unique passwords', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(generatePassword({ length: 24 }, random));
    }
    expect(seen.size).toBe(100);
  });
});

describe('estimateEntropyBits', () => {
  it('grows with the alphabet', () => {
    const all = estimateEntropyBits({ length: 24 });
    const lettersOnly = estimateEntropyBits({ length: 24, digits: false, symbols: false });
    expect(all).toBeGreaterThan(lettersOnly);
    expect(lettersOnly).toBeGreaterThan(0);
  });
});
