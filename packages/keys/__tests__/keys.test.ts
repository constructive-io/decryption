import { WrongPassphraseError } from '@decryption/core';
import { bytesToHex, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import {
  fingerprint,
  generateFileKey,
  generateIdentity,
  identityFromSeed,
  identityFromString,
  identityToString,
  KeyError,
  normalizeRecipients,
  openAs,
  payloadRecipients,
  recipientFromString,
  recipientToString,
  sealTo,
  unwrapFileKey,
  wrapFileKey,
} from '../src';

const alice = generateIdentity();
const bob = generateIdentity();
const mallory = generateIdentity();

describe('identities', () => {
  it('round-trips through their string forms', () => {
    expect(recipientToString(alice.publicKey).startsWith('dcrypt1')).toBe(true);
    expect(identityToString(alice).startsWith('DCRYPTSEC1')).toBe(true);
    expect(bytesToHex(recipientFromString(recipientToString(alice.publicKey)))).toBe(
      bytesToHex(alice.publicKey)
    );
    expect(bytesToHex(identityFromString(identityToString(alice)).privateKey)).toBe(
      bytesToHex(alice.privateKey)
    );
  });

  it('refuses to read a recipient string as an identity, and vice versa', () => {
    expect(() => identityFromString(recipientToString(alice.publicKey))).toThrow(KeyError);
    expect(() => recipientFromString(identityToString(alice))).toThrow(KeyError);
    expect(() => recipientFromString('dcrypt1nonsense')).toThrow(KeyError);
  });

  it('derives deterministically from a seed', () => {
    const seed = randomBytes(64);
    expect(bytesToHex(identityFromSeed(seed).privateKey)).toBe(
      bytesToHex(identityFromSeed(seed).privateKey)
    );
    expect(bytesToHex(identityFromSeed(seed, 0).privateKey)).not.toBe(
      bytesToHex(identityFromSeed(seed, 1).privateKey)
    );
  });

  it('fingerprints are stable and distinct', () => {
    expect(fingerprint(alice.publicKey)).toBe(fingerprint(alice.publicKey));
    expect(fingerprint(alice.publicKey)).not.toBe(fingerprint(bob.publicKey));
    expect(fingerprint(alice.publicKey)).toHaveLength(16);
  });
});

describe('file key wrapping', () => {
  it('round-trips a file key for its recipient only', () => {
    const fileKey = generateFileKey();
    const stanza = wrapFileKey(fileKey, recipientToString(alice.publicKey));
    expect(bytesToHex(unwrapFileKey([stanza], alice))).toBe(bytesToHex(fileKey));
    expect(() => unwrapFileKey([stanza], bob)).toThrow(KeyError);
  });

  it('produces a fresh ephemeral key every time', () => {
    const fileKey = generateFileKey();
    const a = wrapFileKey(fileKey, alice.publicKey);
    const b = wrapFileKey(fileKey, alice.publicKey);
    expect(a.ephemeral).not.toBe(b.ephemeral);
    expect(a.wrapped).not.toBe(b.wrapped);
  });

  it('rejects a tampered stanza', () => {
    const stanza = wrapFileKey(generateFileKey(), alice.publicKey);
    const flipped = stanza.wrapped.slice(0, -1) + (stanza.wrapped.endsWith('0') ? '1' : '0');
    expect(() => unwrapFileKey([{ ...stanza, wrapped: flipped }], alice)).toThrow(
      WrongPassphraseError
    );
  });
});

describe('sealTo/openAs', () => {
  const recipients = [alice, bob].map((identity) => recipientToString(identity.publicKey));

  it('lets every recipient read the payload', () => {
    const sealed = sealTo('shared secret', recipients);
    for (const identity of [alice, bob]) {
      expect(new TextDecoder().decode(openAs(sealed, identity))).toBe('shared secret');
    }
  });

  it('keeps non-recipients out', () => {
    const sealed = sealTo('shared secret', recipients);
    expect(() => openAs(sealed, mallory)).toThrow(KeyError);
  });

  it('binds the ciphertext to its associated data', () => {
    const sealed = sealTo('pg://…', recipients, 'DATABASE_URL');
    expect(new TextDecoder().decode(openAs(sealed, alice, 'DATABASE_URL'))).toBe('pg://…');
    expect(() => openAs(sealed, alice, 'STRIPE_KEY')).toThrow(WrongPassphraseError);
  });

  it('round-trips binary payloads', () => {
    const payload = randomBytes(512);
    expect(bytesToHex(openAs(sealTo(payload, recipients), bob))).toBe(bytesToHex(payload));
  });

  it('publishes fingerprints rather than public keys', () => {
    const sealed = sealTo('x', recipients);
    expect(payloadRecipients(sealed)).toEqual([alice, bob].map((i) => fingerprint(i.publicKey)));
    expect(JSON.stringify(sealed)).not.toContain(bytesToHex(alice.publicKey));
  });

  it('requires at least one recipient', () => {
    expect(() => sealTo('x', [])).toThrow(KeyError);
  });

  it('normalizes and de-duplicates recipient lists', () => {
    expect(
      normalizeRecipients([alice.publicKey, recipientToString(alice.publicKey), bob.publicKey])
    ).toEqual([recipientToString(alice.publicKey), recipientToString(bob.publicKey)]);
  });

  it('never stores the plaintext', () => {
    const sealed = sealTo(utf8ToBytes('the launch codes'), recipients);
    expect(JSON.stringify(sealed)).not.toContain(bytesToHex(utf8ToBytes('the launch codes')));
  });
});
