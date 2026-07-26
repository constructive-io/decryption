import { argon2id } from '../src/argon2';
import { pbkdf2 } from '../src/pbkdf2';
import { scrypt } from '../src/scrypt';
import { sha256, sha512 } from '../src/sha2';
import { bytesToHex, utf8ToBytes } from '../src/utils';

describe('@decryption/hashes', () => {
  it('sha256 matches the NIST vector', () => {
    expect(bytesToHex(sha256(utf8ToBytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('sha512 matches the NIST vector', () => {
    expect(bytesToHex(sha512(utf8ToBytes('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
    );
  });

  it('pbkdf2 matches RFC 6070', () => {
    const out = pbkdf2(sha256, utf8ToBytes('password'), utf8ToBytes('salt'), { c: 1, dkLen: 32 });
    expect(bytesToHex(out)).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  });

  it('scrypt matches RFC 7914', () => {
    const out = scrypt(utf8ToBytes(''), utf8ToBytes(''), { N: 16, r: 1, p: 1, dkLen: 64 });
    expect(bytesToHex(out).slice(0, 32)).toBe('77d6576238657b203b19ca42c18a0497');
  });

  it('exposes argon2id (the KDF the envelope format relies on)', () => {
    const out = argon2id(utf8ToBytes('password'), utf8ToBytes('somesalt1234'), {
      t: 2,
      m: 256,
      p: 1,
      dkLen: 32,
    });
    expect(out).toHaveLength(32);
    const again = argon2id(utf8ToBytes('password'), utf8ToBytes('somesalt1234'), {
      t: 2,
      m: 256,
      p: 1,
      dkLen: 32,
    });
    expect(bytesToHex(again)).toBe(bytesToHex(out));
  });
});
