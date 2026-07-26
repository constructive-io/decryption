import { bytesToHex, utf8ToBytes } from '@decryption/hashes/utils';

import {
  ARMOR_PREFIX,
  armor,
  CorruptEnvelopeError,
  dearmor,
  decrypt,
  decryptFromString,
  deriveKey,
  encrypt,
  encryptToString,
  HEADER_LENGTH,
  InvalidParametersError,
  KDF_PROFILES,
  openWithKey,
  parseHeader,
  sealWithKey,
  Suite,
  UnsupportedEnvelopeError,
  VERSION,
  WrongPassphraseError,
} from '../src';

const PASSPHRASE = 'correct horse battery staple';
// Argon2id is deliberately expensive and jest's sandbox runs it ~20x slower than bare node,
// so the suite pins the minimum accepted cost instead of a real profile.
const FAST = { kdf: { t: 1, m: 8192, p: 1 } } as const;

describe('envelope', () => {
  it('round-trips text', () => {
    const envelope = encrypt('attack at dawn', PASSPHRASE, FAST);
    expect(new TextDecoder().decode(decrypt(envelope, PASSPHRASE))).toBe('attack at dawn');
  });

  it('produces a different ciphertext every time (random salt + nonce)', () => {
    const a = encrypt('same', PASSPHRASE, FAST);
    const b = encrypt('same', PASSPHRASE, FAST);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('throws WrongPassphraseError instead of returning empty output', () => {
    const envelope = encrypt('secret', PASSPHRASE, FAST);
    expect(() => decrypt(envelope, 'wrong passphrase')).toThrow(WrongPassphraseError);
  });

  it('records the kdf parameters in a parseable header', () => {
    const envelope = encrypt('x', PASSPHRASE, FAST);
    const header = parseHeader(envelope);
    expect(header).toMatchObject({
      version: VERSION,
      suite: Suite.Argon2idXChaCha20Poly1305,
      kdf: FAST.kdf,
    });
    expect(header.salt).toHaveLength(16);
    expect(header.nonce).toHaveLength(24);
  });

  it('detects tampering in the authenticated header', () => {
    const envelope = encrypt('secret', PASSPHRASE, FAST);
    envelope[20] ^= 0x01; // inside the salt
    expect(() => decrypt(envelope, PASSPHRASE)).toThrow(WrongPassphraseError);
  });

  it('rejects non-envelopes and unsupported versions distinctly', () => {
    expect(() => parseHeader(new Uint8Array(100))).toThrow(CorruptEnvelopeError);
    expect(() => parseHeader(utf8ToBytes('short'))).toThrow(CorruptEnvelopeError);
    const future = encrypt('x', PASSPHRASE, FAST);
    future[6] = 99;
    expect(() => parseHeader(future)).toThrow(UnsupportedEnvelopeError);
    future[6] = VERSION;
    future[7] = 42;
    expect(() => parseHeader(future)).toThrow(UnsupportedEnvelopeError);
  });

  it('binds ciphertext to its associated data', () => {
    const envelope = encrypt('pg://...', PASSPHRASE, { ...FAST, aad: 'DATABASE_URL' });
    expect(new TextDecoder().decode(decrypt(envelope, PASSPHRASE, { aad: 'DATABASE_URL' }))).toBe(
      'pg://...'
    );
    expect(() => decrypt(envelope, PASSPHRASE, { aad: 'STRIPE_KEY' })).toThrow(WrongPassphraseError);
  });
});

describe('kdf', () => {
  it('ships profiles that only ever get more expensive', () => {
    expect(KDF_PROFILES.interactive.m).toBeLessThan(KDF_PROFILES.moderate.m);
    expect(KDF_PROFILES.moderate.m).toBeLessThan(KDF_PROFILES.sensitive.m);
  });

  it('is deterministic for a given passphrase, salt and cost', () => {
    const salt = new Uint8Array(16).fill(1);
    expect(bytesToHex(deriveKey('pw', salt, FAST.kdf))).toBe(
      bytesToHex(deriveKey('pw', salt, FAST.kdf))
    );
    expect(bytesToHex(deriveKey('pw', salt, FAST.kdf))).not.toBe(
      bytesToHex(deriveKey('pw2', salt, FAST.kdf))
    );
  });

  it('rejects empty passphrases, short salts and downgraded cost', () => {
    expect(() => encrypt('x', '', FAST)).toThrow(InvalidParametersError);
    expect(() => deriveKey('pw', new Uint8Array(8), FAST.kdf)).toThrow(InvalidParametersError);
    expect(() => encrypt('x', PASSPHRASE, { kdf: { t: 1, m: 1, p: 1 } })).toThrow(
      InvalidParametersError
    );
  });
});

describe('armor', () => {
  it('round-trips through the text form', () => {
    const armored = encryptToString('hello', PASSPHRASE, FAST);
    expect(armored.startsWith(ARMOR_PREFIX)).toBe(true);
    expect(decryptFromString(armored, PASSPHRASE)).toBe('hello');
  });

  it('tolerates surrounding whitespace and rejects foreign text', () => {
    const armored = armor(encrypt('hi', PASSPHRASE, FAST));
    expect(dearmor(`\n  ${armored}\n`)).toHaveLength(dearmor(armored).length);
    expect(() => dearmor('not-an-envelope')).toThrow(CorruptEnvelopeError);
    expect(() => dearmor(`${ARMOR_PREFIX}!!!!`)).toThrow(CorruptEnvelopeError);
  });
});

describe('raw key api', () => {
  const key = new Uint8Array(32).fill(42);

  it('round-trips payloads of every size, including empty', () => {
    for (const size of [0, 1, 15, 16, 17, 1024]) {
      const payload = new Uint8Array(size).map((_, i) => i % 251);
      expect(bytesToHex(openWithKey(key, sealWithKey(key, payload)))).toBe(bytesToHex(payload));
    }
  });

  it('rejects a wrong key, mismatched aad and tampered bytes', () => {
    const sealed = sealWithKey(key, 'value', 'KEY_NAME');
    expect(new TextDecoder().decode(openWithKey(key, sealed, 'KEY_NAME'))).toBe('value');
    expect(() => openWithKey(key, sealed, 'OTHER')).toThrow(WrongPassphraseError);
    expect(() => openWithKey(new Uint8Array(32).fill(7), sealed, 'KEY_NAME')).toThrow(
      WrongPassphraseError
    );
    sealed[sealed.length - 1] ^= 0x01;
    expect(() => openWithKey(key, sealed, 'KEY_NAME')).toThrow(WrongPassphraseError);
  });

  it('validates key length and payload length', () => {
    expect(() => sealWithKey(new Uint8Array(16), 'x')).toThrow(InvalidParametersError);
    expect(() => openWithKey(key, new Uint8Array(4))).toThrow(CorruptEnvelopeError);
  });
});
