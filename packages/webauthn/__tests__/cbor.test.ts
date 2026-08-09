import { decode, encode } from '../src/cbor';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('cbor', () => {
  it('encodes the RFC 8949 examples', () => {
    expect(hex(encode(0))).toBe('00');
    expect(hex(encode(23))).toBe('17');
    expect(hex(encode(24))).toBe('1818');
    expect(hex(encode(1000))).toBe('1903e8');
    expect(hex(encode(1000000))).toBe('1a000f4240');
    expect(hex(encode(-1))).toBe('20');
    expect(hex(encode(-500))).toBe('3901f3');
    expect(hex(encode('a'))).toBe('6161');
    expect(hex(encode(Uint8Array.from([1, 2, 3, 4])))).toBe('4401020304');
    expect(hex(encode([1, 2, 3]))).toBe('83010203');
  });

  it('orders map keys canonically, as CTAP2 requires', () => {
    const out = encode(
      new Map<number, number>([
        [-3, 3],
        [1, 1],
        [-1, 1],
        [3, -7],
      ])
    );
    // 01, 03, 20 (-1), 22 (-3): shorter first, then bytewise
    expect(hex(out)).toBe('a40101' + '0326' + '2001' + '2203');
  });

  it('round-trips what an authenticator emits', () => {
    const value = new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', Uint8Array.from({ length: 300 }, (_, i) => i % 256)],
    ]);
    expect(decode(encode(value as never))).toEqual(value);
  });

  it('refuses what WebAuthn never contains rather than guessing', () => {
    expect(() => encode(1.5)).toThrow(/integers/);
  });
});
