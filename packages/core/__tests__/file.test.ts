import { bytesToHex, concatBytes, utf8ToBytes } from '@decryption/hashes/utils';

import {
  armorFile,
  CorruptEnvelopeError,
  createFileDecryptor,
  createFileEncryptor,
  dearmorFile,
  decrypt,
  decryptFile,
  encodeFileHeader,
  encrypt,
  encryptFile,
  FILE_ARMOR_PREFIX,
  FILE_VERSION,
  FileStanza,
  generateFileKey,
  InvalidParametersError,
  isFileEnvelope,
  isPassphraseFile,
  MAGIC,
  MAX_STANZA_BODY_LENGTH,
  openFile,
  parseFileHeader,
  sealFile,
  StanzaType,
  STREAM_CHUNK_SIZE,
  Suite,
  tryParseFileHeader,
  UnsupportedEnvelopeError,
  unwrapWithPassphrase,
  verifyFileHeader,
  wrapWithPassphrase,
  WrongPassphraseError,
} from '../src';

const PASSPHRASE = 'correct horse battery staple';
// Argon2id is deliberately expensive; the suite pins the minimum accepted cost.
const FAST = { kdf: { t: 1, m: 8192, p: 1 } } as const;

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** A stanza of a type this build does not know, standing in for a future unlock method. */
const opaqueStanza = (fill: number): FileStanza => ({ type: 200, body: new Uint8Array(40).fill(fill) });

describe('passphrase files', () => {
  it('round-trips text and bytes', () => {
    expect(text(decryptFile(encryptFile('the quick brown fox', PASSPHRASE, FAST), PASSPHRASE))).toBe(
      'the quick brown fox'
    );
    const bytes = new Uint8Array(3 * STREAM_CHUNK_SIZE + 7).map((_, i) => i % 251);
    const opened = decryptFile(encryptFile(bytes, PASSPHRASE, FAST), PASSPHRASE);
    expect(Buffer.from(opened).equals(Buffer.from(bytes))).toBe(true);
  });

  it('round-trips an empty payload', () => {
    expect(decryptFile(encryptFile('', PASSPHRASE, FAST), PASSPHRASE)).toHaveLength(0);
  });

  it('starts with the magic, version 2 and the stream suite', () => {
    const file = encryptFile('x', PASSPHRASE, FAST);
    expect(text(file.subarray(0, MAGIC.length))).toBe('DCRYPT');
    expect(file[6]).toBe(FILE_VERSION);
    expect(file[7]).toBe(Suite.HkdfSha256ChaCha20Poly1305Stream);
    expect(isFileEnvelope(file)).toBe(true);
    expect(isFileEnvelope(encrypt('x', PASSPHRASE, FAST))).toBe(false);
  });

  it('is different every time', () => {
    const a = encryptFile('same', PASSPHRASE, FAST);
    const b = encryptFile('same', PASSPHRASE, FAST);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('rejects a wrong passphrase with WrongPassphraseError', () => {
    const file = encryptFile('secret', PASSPHRASE, FAST);
    expect(() => decryptFile(file, 'not the passphrase')).toThrow(WrongPassphraseError);
  });

  it('records the kdf parameters and rejects a downgrade', () => {
    const file = encryptFile('secret', PASSPHRASE, { kdf: { t: 2, m: 8192, p: 1 } });
    const header = parseFileHeader(file);
    expect(isPassphraseFile(header)).toBe(true);
    // stanza body: t u32 | m u32 | p u8 | salt | wrapped key
    const view = new DataView(header.stanzas[0].body.buffer);
    expect(view.getUint32(0)).toBe(2);
    expect(view.getUint32(4)).toBe(8192);

    // Lower the time cost in place. The derived key changes, so the file key no longer unwraps.
    const tampered = Uint8Array.from(file);
    const stanzaBody = MAGIC.length + 2 + 2 + 3;
    new DataView(tampered.buffer).setUint32(stanzaBody, 1);
    expect(() => decryptFile(tampered, PASSPHRASE)).toThrow(WrongPassphraseError);

    // Below the accepted minimum the parameters are refused before any key is derived.
    new DataView(tampered.buffer).setUint32(stanzaBody + 4, 8);
    expect(() => decryptFile(tampered, PASSPHRASE)).toThrow(CorruptEnvelopeError);
  });

  it('does not open a version 1 envelope, and version 1 does not open a file', () => {
    expect(() => decryptFile(encrypt('x', PASSPHRASE, FAST), PASSPHRASE)).toThrow(UnsupportedEnvelopeError);
    expect(() => decrypt(encryptFile('x', PASSPHRASE, FAST), PASSPHRASE)).toThrow(UnsupportedEnvelopeError);
  });
});

describe('file header', () => {
  const fileKey = generateFileKey();

  it('round-trips stanzas, including types this build does not know', () => {
    const stanzas = [opaqueStanza(1), opaqueStanza(2)];
    const header = parseFileHeader(encodeFileHeader(fileKey, stanzas));
    expect(header.stanzas.map((stanza) => stanza.type)).toEqual([200, 200]);
    expect(bytesToHex(header.stanzas[1].body)).toBe(bytesToHex(stanzas[1].body));
    expect(header.nonce).toHaveLength(16);
    expect(() => verifyFileHeader(header, fileKey)).not.toThrow();
  });

  it('asks for more bytes instead of failing on a partial header', () => {
    const encoded = encodeFileHeader(fileKey, [opaqueStanza(1)]);
    for (let length = 0; length < encoded.length; length++) {
      expect(tryParseFileHeader(encoded.subarray(0, length))).toBeUndefined();
    }
    expect(tryParseFileHeader(encoded)?.length).toBe(encoded.length);
    expect(() => parseFileHeader(encoded.subarray(0, encoded.length - 1))).toThrow(CorruptEnvelopeError);
  });

  it('rejects input that is not a dcrypt file as soon as the magic differs', () => {
    expect(() => tryParseFileHeader(utf8ToBytes('DCX'))).toThrow(CorruptEnvelopeError);
    expect(() => parseFileHeader(utf8ToBytes('plain text, not an envelope'))).toThrow(CorruptEnvelopeError);
  });

  it('rejects an unknown version or suite', () => {
    const encoded = encodeFileHeader(fileKey, [opaqueStanza(1)]);
    const version = Uint8Array.from(encoded);
    version[6] = 3;
    expect(() => parseFileHeader(version)).toThrow(UnsupportedEnvelopeError);
    const suite = Uint8Array.from(encoded);
    suite[7] = 9;
    expect(() => parseFileHeader(suite)).toThrow(UnsupportedEnvelopeError);
  });

  it('authenticates the header: a changed, added or removed stanza is detected', () => {
    const header = parseFileHeader(encodeFileHeader(fileKey, [opaqueStanza(1), opaqueStanza(2)]));

    const changed = Uint8Array.from(encodeFileHeader(fileKey, [opaqueStanza(1), opaqueStanza(2)]));
    changed[MAGIC.length + 4 + 3] ^= 0x01;
    expect(() => verifyFileHeader(parseFileHeader(changed), fileKey)).toThrow(CorruptEnvelopeError);

    // Splice a different stanza list in front of the original MAC and nonce.
    const other = encodeFileHeader(fileKey, [opaqueStanza(1)]);
    const spliced = concatBytes(
      other.subarray(0, other.length - 48),
      header.mac,
      header.nonce
    );
    expect(() => verifyFileHeader(parseFileHeader(spliced), fileKey)).toThrow(CorruptEnvelopeError);

    expect(() => verifyFileHeader(header, generateFileKey())).toThrow(CorruptEnvelopeError);
  });

  it('refuses a passphrase stanza next to other stanzas', () => {
    const passphrase = wrapWithPassphrase(fileKey, PASSPHRASE, FAST.kdf);
    expect(() => encodeFileHeader(fileKey, [passphrase, opaqueStanza(1)])).toThrow(InvalidParametersError);
  });

  it('refuses empty, oversized and malformed stanza lists', () => {
    expect(() => encodeFileHeader(fileKey, [])).toThrow(InvalidParametersError);
    expect(() =>
      encodeFileHeader(fileKey, [{ type: 200, body: new Uint8Array(MAX_STANZA_BODY_LENGTH + 1) }])
    ).toThrow(InvalidParametersError);
    expect(() => encodeFileHeader(fileKey, [{ type: 0, body: new Uint8Array(1) }])).toThrow(
      InvalidParametersError
    );
    expect(() => encodeFileHeader(new Uint8Array(16), [opaqueStanza(1)])).toThrow(InvalidParametersError);

    const zeroCount = Uint8Array.from(encodeFileHeader(fileKey, [opaqueStanza(1)]));
    zeroCount[9] = 0;
    expect(() => parseFileHeader(zeroCount)).toThrow(CorruptEnvelopeError);
  });

  it('says so when a recipient file is opened with a passphrase', () => {
    const header = parseFileHeader(encodeFileHeader(fileKey, [opaqueStanza(1)]));
    expect(isPassphraseFile(header)).toBe(false);
    expect(() => unwrapWithPassphrase(header, PASSPHRASE)).toThrow(InvalidParametersError);
  });
});

describe('file payload', () => {
  const fileKey = generateFileKey();
  const stanzas = [opaqueStanza(1)];
  const unwrap = () => Uint8Array.from(fileKey);

  it('streams: header first, then chunks, then the final chunk', () => {
    const { header, stream } = createFileEncryptor(fileKey, stanzas);
    const plaintext = new Uint8Array(2 * STREAM_CHUNK_SIZE + 99).fill(0x61);
    const parts = [header];
    for (let offset = 0; offset < plaintext.length; offset += 30_000) {
      parts.push(stream.update(plaintext.subarray(offset, offset + 30_000)));
    }
    parts.push(stream.finish());
    const file = concatBytes(...parts);

    const parsed = parseFileHeader(file);
    const decryptor = createFileDecryptor(parsed, fileKey);
    const opened = concatBytes(decryptor.update(file.subarray(parsed.length)), decryptor.finish());
    expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('never returns part of a truncated or modified file', () => {
    const file = sealFile(new Uint8Array(STREAM_CHUNK_SIZE + 500).fill(1), fileKey, stanzas);
    expect(() => openFile(file.subarray(0, file.length - 1), unwrap)).toThrow(CorruptEnvelopeError);
    expect(() => openFile(file.subarray(0, file.length - 517), unwrap)).toThrow(CorruptEnvelopeError);
    const flipped = Uint8Array.from(file);
    flipped[file.length - 20] ^= 0x80;
    expect(() => openFile(flipped, unwrap)).toThrow(CorruptEnvelopeError);
  });

  it('binds the payload to the nonce in the header', () => {
    const file = sealFile('payload', fileKey, stanzas);
    const header = parseFileHeader(file);
    const tampered = Uint8Array.from(file);
    tampered[header.length - 1] ^= 0x01;
    expect(() => openFile(tampered, unwrap)).toThrow(CorruptEnvelopeError);
  });

  it('refuses to start decrypting when the header does not authenticate', () => {
    const header = parseFileHeader(sealFile('payload', fileKey, stanzas));
    expect(() => createFileDecryptor(header, generateFileKey())).toThrow(CorruptEnvelopeError);
  });
});

describe('node Buffers', () => {
  // Buffer.prototype.slice returns a view, and small Buffers share one pooled ArrayBuffer, so a
  // parser that trusts `.slice()` to copy or `.buffer` to start at zero reads the wrong bytes.
  const offsetBuffer = (bytes: Uint8Array): Buffer =>
    Buffer.concat([Buffer.alloc(13, 0xee), Buffer.from(bytes)]).subarray(13);

  it('opens a file held in a Buffer that does not start at offset zero', () => {
    const file = offsetBuffer(encryptFile('held in a buffer', PASSPHRASE, FAST));
    expect(file.byteOffset).not.toBe(0);
    expect(text(decryptFile(file, PASSPHRASE))).toBe('held in a buffer');
    expect(text(decryptFile(Buffer.from(file), PASSPHRASE))).toBe('held in a buffer');
  });

  it('keeps its own copy of a header parsed from a Buffer the caller then reuses', () => {
    const fileKey = generateFileKey();
    const encoded = offsetBuffer(encodeFileHeader(fileKey, [opaqueStanza(7)]));
    const header = parseFileHeader(encoded);
    encoded.fill(0);
    expect(header.stanzas[0].body.every((byte) => byte === 7)).toBe(true);
    expect(() => verifyFileHeader(header, fileKey)).not.toThrow();
  });
});

describe('armored files', () => {
  it('round-trips through the text form', () => {
    const armored = armorFile(encryptFile('paste me anywhere', PASSPHRASE, FAST));
    expect(armored.startsWith(FILE_ARMOR_PREFIX)).toBe(true);
    expect(armored).not.toMatch(/\s/);
    expect(text(decryptFile(dearmorFile(`  ${armored}\n`), PASSPHRASE))).toBe('paste me anywhere');
  });

  it('rejects other prefixes and bad base64', () => {
    expect(() => dearmorFile('dcrypt.v1.AAAA')).toThrow(CorruptEnvelopeError);
    expect(() => dearmorFile(`${FILE_ARMOR_PREFIX}***`)).toThrow(CorruptEnvelopeError);
  });

  it('uses the stanza type numbers the format documents', () => {
    expect(StanzaType.Passphrase).toBe(1);
    expect(StanzaType.X25519).toBe(2);
  });
});
