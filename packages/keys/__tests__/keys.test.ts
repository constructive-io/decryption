import {
  CorruptEnvelopeError,
  encodeFileHeader,
  encryptFile,
  isPassphraseFile,
  parseFileHeader,
  StanzaType,
  STREAM_CHUNK_SIZE,
  WrongPassphraseError,
} from '@decryption/core';
import { bytesToHex, concatBytes, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import {
  createIdentityFileDecryptor,
  createRecipientFileEncryptor,
  fileRecipients,
  fingerprint,
  generateFileKey,
  generateIdentity,
  identityFromSeed,
  identityFromString,
  identityToString,
  KeyError,
  normalizeRecipients,
  openAs,
  openFileAs,
  payloadRecipients,
  recipientFromString,
  recipientStanza,
  recipientToString,
  sealFileTo,
  sealTo,
  unwrapFileKey,
  unwrapWithIdentity,
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

describe('recipient files', () => {
  const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

  it('is readable by every recipient and nobody else', () => {
    const file = sealFileTo('minutes of the tuesday meeting', [alice.publicKey, recipientToString(bob.publicKey)]);
    expect(text(openFileAs(file, alice))).toBe('minutes of the tuesday meeting');
    expect(text(openFileAs(file, bob))).toBe('minutes of the tuesday meeting');
    expect(() => openFileAs(file, mallory)).toThrow(KeyError);
  });

  it('lists recipient fingerprints from the header without any key', () => {
    const header = parseFileHeader(sealFileTo('x', [alice.publicKey, bob.publicKey]));
    expect(isPassphraseFile(header)).toBe(false);
    expect(header.stanzas.every((stanza) => stanza.type === StanzaType.X25519)).toBe(true);
    expect(fileRecipients(header)).toEqual([fingerprint(alice.publicKey), fingerprint(bob.publicKey)]);
  });

  it('writes one stanza per distinct recipient', () => {
    const header = parseFileHeader(
      sealFileTo('x', [alice.publicKey, recipientToString(alice.publicKey), bob.publicKey])
    );
    expect(header.stanzas).toHaveLength(2);
  });

  it('requires at least one recipient', () => {
    expect(() => sealFileTo('x', [])).toThrow(KeyError);
    expect(() => createRecipientFileEncryptor([])).toThrow(KeyError);
  });

  it('streams a payload larger than one chunk', () => {
    const plaintext = new Uint8Array(3 * STREAM_CHUNK_SIZE + 11).map((_, i) => (i * 7) % 256);
    const { header, stream } = createRecipientFileEncryptor([alice.publicKey]);
    const parts = [header];
    for (let offset = 0; offset < plaintext.length; offset += 100_000) {
      parts.push(stream.update(plaintext.subarray(offset, offset + 100_000)));
    }
    parts.push(stream.finish());
    const file = concatBytes(...parts);

    const parsed = parseFileHeader(file);
    const decryptor = createIdentityFileDecryptor(parsed, alice);
    const opened = concatBytes(decryptor.update(file.subarray(parsed.length)), decryptor.finish());
    expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('detects a stanza swapped in from another file', () => {
    // Bob is a recipient of `theirs` only. Moving his stanza into `ours` must not let him in:
    // it wraps a different file key, so the header MAC of `ours` no longer verifies.
    const ours = sealFileTo('ours', [alice.publicKey]);
    const theirs = sealFileTo('theirs', [bob.publicKey]);
    const stanzaStart = 10;
    const stanzaLength = 3 + 112;
    const forged = Uint8Array.from(ours);
    forged.set(theirs.subarray(stanzaStart, stanzaStart + stanzaLength), stanzaStart);
    expect(() => openFileAs(forged, bob)).toThrow(CorruptEnvelopeError);
    expect(() => openFileAs(forged, alice)).toThrow(KeyError);
  });

  it('refuses a passphrase file', () => {
    const file = encryptFile('x', 'correct horse battery staple', { kdf: { t: 1, m: 8192, p: 1 } });
    expect(() => unwrapWithIdentity(parseFileHeader(file), alice)).toThrow(KeyError);
  });

  it('rejects a recipient stanza of the wrong length', () => {
    const fileKey = generateFileKey();
    const stanza = recipientStanza(fileKey, alice.publicKey);
    const header = parseFileHeader(
      encodeFileHeader(fileKey, [{ type: stanza.type, body: stanza.body.subarray(0, 100) }])
    );
    expect(() => unwrapWithIdentity(header, alice)).toThrow(CorruptEnvelopeError);
  });
});
