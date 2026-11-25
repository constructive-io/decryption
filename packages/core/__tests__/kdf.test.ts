import { argon2id } from '@decryption/hashes/argon2';
import { bytesToHex } from '@decryption/hashes/utils';

const filled = (length: number, byte: number): Uint8Array => new Uint8Array(length).fill(byte);

describe('Argon2id', () => {
  // Upstream's third-party audit of @noble/hashes excludes argon2, so the one check this
  // repository can make itself is made here: the vendored code reproduces the RFC's own vector.
  it('reproduces the RFC 9106 test vector (section 5.3)', () => {
    const tag = argon2id(filled(32, 0x01), filled(16, 0x02), {
      t: 3,
      m: 32,
      p: 4,
      dkLen: 32,
      key: filled(8, 0x03),
      personalization: filled(12, 0x04),
    });

    expect(bytesToHex(tag)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });
});
