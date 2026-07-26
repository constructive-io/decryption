import { base58check, base64, bech32, hex } from '../src';
import { sha256 } from '@decryption/hashes/sha2';

describe('@decryption/base', () => {
  it('encodes bech32 (the format used for cosmos-family and recipient strings)', () => {
    // BIP173 P2WPKH: witness version 0 followed by the 20-byte program
    const words = [0, ...bech32.toWords(hex.decode('751e76e8199196d454941c45d1b3a323f1433bd6'))];
    expect(bech32.encode('bc', words)).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    const decoded = bech32.decode('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(decoded.prefix).toBe('bc');
    expect(hex.encode(bech32.fromWords(decoded.words.slice(1)))).toBe(
      '751e76e8199196d454941c45d1b3a323f1433bd6'
    );
  });

  it('round-trips base64 and base58check', () => {
    expect(base64.encode(new Uint8Array([1, 2, 3]))).toBe('AQID');
    const b58c = base58check(sha256);
    expect(b58c.decode(b58c.encode(new Uint8Array([9, 9, 9])))).toEqual(new Uint8Array([9, 9, 9]));
  });
});
