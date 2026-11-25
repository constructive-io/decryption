import { chacha20poly1305 } from '@decryption/ciphers/chacha';
import { sha256 } from '@decryption/hashes/sha2';
import { bytesToHex, concatBytes, hexToBytes } from '@decryption/hashes/utils';
import { inflateSync } from 'zlib';

import {
  CorruptEnvelopeError,
  deriveStreamKey,
  InvalidParametersError,
  STREAM_CHUNK_SIZE,
  STREAM_NONCE_LENGTH,
  STREAM_TAG_LENGTH,
  streamDecrypt,
  StreamDecryptor,
  streamEncrypt,
  StreamEncryptor,
} from '../src';
import fixture from './fixtures/age-stream.json';

const ENCRYPTED_CHUNK = STREAM_CHUNK_SIZE + STREAM_TAG_LENGTH;
const KEY = new Uint8Array(32).fill(7);

/** Deterministic filler, so failures are reproducible and no real data is involved. */
const pattern = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + (i >>> 8)) & 0xff;
  return bytes;
};

/** Feeds `data` through `step` in pieces of `size` bytes, collecting everything it returns. */
const inPieces = (
  data: Uint8Array,
  size: number,
  step: (piece: Uint8Array) => Uint8Array,
  collected: Uint8Array[] = []
): Uint8Array[] => {
  for (let offset = 0; offset < data.length; offset += size) {
    collected.push(step(data.subarray(offset, offset + size)));
  }
  return collected;
};

/**
 * What age's reference reader releases before it stops. It opens chunks one at a time and, when
 * a full-size chunk fails, retries it with the final flag before looking for trailing data, so
 * it hands out a final-flagged chunk even when more bytes follow. The vectors' payload hashes
 * describe exactly that behaviour, which makes this the way to check each vector byte for byte.
 */
const referenceRelease = (key: Uint8Array, ciphertext: Uint8Array): Uint8Array => {
  const released: Uint8Array[] = [];
  const open = (chunk: Uint8Array, index: number, last: boolean): Uint8Array | undefined => {
    const nonce = new Uint8Array(12);
    nonce[9] = index >>> 8;
    nonce[10] = index & 0xff;
    nonce[11] = last ? 1 : 0;
    try {
      return chacha20poly1305(key, nonce).decrypt(chunk);
    } catch {
      return undefined;
    }
  };
  for (let offset = 0, index = 0; offset < ciphertext.length; index++) {
    const chunk = ciphertext.subarray(offset, offset + ENCRYPTED_CHUNK);
    offset += chunk.length;
    const short = chunk.length < ENCRYPTED_CHUNK;
    if (short && index > 0 && chunk.length === STREAM_TAG_LENGTH) break;
    const inner = short ? undefined : open(chunk, index, false);
    const plain = inner ?? open(chunk, index, true);
    if (!plain) break;
    released.push(plain);
    // A chunk that opened with the final flag ends the payload, whatever follows it.
    if (!inner) break;
  }
  return concatBytes(...released);
};

describe('age STREAM test vectors', () => {
  // The payload layer is the part of the format shared with age, so age's own vectors apply to
  // it unchanged: same key derivation, same chunking, same nonces, same failure rules.
  it('covers every stream vector in the fixture', () => {
    expect(fixture.vectors).toHaveLength(28);
  });

  for (const vector of fixture.vectors) {
    it(`${vector.name}: ${vector.expect}`, () => {
      const body = Uint8Array.from(inflateSync(Buffer.from(vector.body, 'base64')));
      const fileKey = hexToBytes(vector.fileKey);

      if (vector.expect === 'header failure') {
        // The payload nonce is missing or short, so there is no key to derive.
        expect(body.length).toBeLessThan(STREAM_NONCE_LENGTH);
        expect(() => deriveStreamKey(fileKey, body)).toThrow(InvalidParametersError);
        return;
      }

      const key = deriveStreamKey(fileKey, body.subarray(0, STREAM_NONCE_LENGTH));
      const ciphertext = body.subarray(STREAM_NONCE_LENGTH);
      // "All the plaintext that would have been released … must match this hash, even if the
      // decryption eventually fails."
      const reference = referenceRelease(key, ciphertext);
      expect(bytesToHex(sha256(reference))).toBe(vector.payloadSha256);

      const decryptor = new StreamDecryptor(key);
      const pieces: Uint8Array[] = [];
      const run = () => {
        // An awkward piece size, so chunk boundaries never line up with the input.
        inPieces(ciphertext, 50_000, (piece) => decryptor.update(piece), pieces);
        pieces.push(decryptor.finish());
      };

      if (vector.expect === 'success') {
        run();
        expect(Buffer.from(concatBytes(...pieces)).equals(Buffer.from(reference))).toBe(true);
        return;
      }
      expect(vector.expect).toBe('payload failure');
      expect(run).toThrow(CorruptEnvelopeError);
      // This reader looks one chunk ahead instead of retrying, so it never hands out a chunk
      // before it knows whether that chunk is the last. On a malformed payload it therefore
      // releases a prefix of what the reference reader would, never anything else.
      const released = concatBytes(...pieces);
      expect(released.length).toBeLessThanOrEqual(reference.length);
      expect(Buffer.from(released).equals(Buffer.from(reference.subarray(0, released.length)))).toBe(true);
    });
  }
});

describe('stream', () => {
  const sizes = [
    0,
    1,
    STREAM_CHUNK_SIZE - 1,
    STREAM_CHUNK_SIZE,
    STREAM_CHUNK_SIZE + 1,
    2 * STREAM_CHUNK_SIZE,
    3 * STREAM_CHUNK_SIZE + 123,
  ];

  it.each(sizes)('round-trips %i bytes', (size) => {
    const plaintext = pattern(size);
    const ciphertext = streamEncrypt(KEY, plaintext);
    const chunks = Math.max(1, Math.ceil(size / STREAM_CHUNK_SIZE));
    expect(ciphertext).toHaveLength(size + chunks * STREAM_TAG_LENGTH);
    expect(bytesToHex(streamDecrypt(KEY, ciphertext))).toBe(bytesToHex(plaintext));
  });

  it('gives the same ciphertext however the plaintext is split', () => {
    const plaintext = pattern(2 * STREAM_CHUNK_SIZE + 4321);
    const whole = streamEncrypt(KEY, plaintext);
    for (const size of [1000, STREAM_CHUNK_SIZE, STREAM_CHUNK_SIZE + 1, 150_000]) {
      const encryptor = new StreamEncryptor(KEY);
      const pieces = inPieces(plaintext, size, (piece) => encryptor.update(piece));
      pieces.push(encryptor.finish());
      expect(bytesToHex(concatBytes(...pieces))).toBe(bytesToHex(whole));
    }
  });

  it('holds only one chunk back while streaming', () => {
    const encryptor = new StreamEncryptor(KEY);
    // Exactly one chunk: nothing can be written yet, it may still turn out to be the last.
    expect(encryptor.update(pattern(STREAM_CHUNK_SIZE))).toHaveLength(0);
    expect(encryptor.update(pattern(1))).toHaveLength(ENCRYPTED_CHUNK);
    expect(encryptor.finish()).toHaveLength(1 + STREAM_TAG_LENGTH);
  });

  it('detects truncation at a chunk boundary', () => {
    const ciphertext = streamEncrypt(KEY, pattern(2 * STREAM_CHUNK_SIZE + 10));
    // Dropping the final chunk leaves two well-formed chunks, neither flagged as last.
    expect(() => streamDecrypt(KEY, ciphertext.subarray(0, 2 * ENCRYPTED_CHUNK))).toThrow(
      CorruptEnvelopeError
    );
    expect(() => streamDecrypt(KEY, ciphertext.subarray(0, ENCRYPTED_CHUNK))).toThrow(CorruptEnvelopeError);
    expect(() => streamDecrypt(KEY, new Uint8Array(0))).toThrow(CorruptEnvelopeError);
  });

  it('detects appended data', () => {
    const ciphertext = streamEncrypt(KEY, pattern(100));
    expect(() => streamDecrypt(KEY, concatBytes(ciphertext, new Uint8Array(1)))).toThrow(CorruptEnvelopeError);
    expect(() => streamDecrypt(KEY, concatBytes(ciphertext, ciphertext))).toThrow(CorruptEnvelopeError);
  });

  it('detects reordered and duplicated chunks', () => {
    const ciphertext = streamEncrypt(KEY, pattern(3 * STREAM_CHUNK_SIZE));
    const first = ciphertext.subarray(0, ENCRYPTED_CHUNK);
    const second = ciphertext.subarray(ENCRYPTED_CHUNK, 2 * ENCRYPTED_CHUNK);
    const third = ciphertext.subarray(2 * ENCRYPTED_CHUNK);
    expect(() => streamDecrypt(KEY, concatBytes(second, first, third))).toThrow(CorruptEnvelopeError);
    expect(() => streamDecrypt(KEY, concatBytes(first, first, third))).toThrow(CorruptEnvelopeError);
  });

  it('detects a flipped bit anywhere', () => {
    const ciphertext = streamEncrypt(KEY, pattern(STREAM_CHUNK_SIZE + 50));
    for (const index of [0, STREAM_CHUNK_SIZE, ENCRYPTED_CHUNK - 1, ENCRYPTED_CHUNK, ciphertext.length - 1]) {
      const tampered = Uint8Array.from(ciphertext);
      tampered[index] ^= 0x01;
      expect(() => streamDecrypt(KEY, tampered)).toThrow(CorruptEnvelopeError);
    }
  });

  it('rejects the wrong key', () => {
    const ciphertext = streamEncrypt(KEY, pattern(10));
    expect(() => streamDecrypt(new Uint8Array(32).fill(8), ciphertext)).toThrow(CorruptEnvelopeError);
  });

  it('survives a caller that reuses one read buffer, and never writes to it', () => {
    // How a file is actually read: the same Buffer is refilled for every piece.
    const plaintext = pattern(3 * STREAM_CHUNK_SIZE + 500);
    const scratch = Buffer.alloc(50_000);
    const encryptor = new StreamEncryptor(KEY);
    const sealed: Uint8Array[] = [];
    for (let offset = 0; offset < plaintext.length; offset += scratch.length) {
      const length = Math.min(scratch.length, plaintext.length - offset);
      scratch.set(plaintext.subarray(offset, offset + length));
      sealed.push(encryptor.update(scratch.subarray(0, length)));
      scratch.fill(0xaa);
    }
    sealed.push(encryptor.finish());
    const ciphertext = concatBytes(...sealed);
    expect(bytesToHex(ciphertext)).toBe(bytesToHex(streamEncrypt(KEY, plaintext)));

    const decryptor = new StreamDecryptor(KEY);
    const opened: Uint8Array[] = [];
    for (let offset = 0; offset < ciphertext.length; offset += scratch.length) {
      const length = Math.min(scratch.length, ciphertext.length - offset);
      scratch.set(ciphertext.subarray(offset, offset + length));
      opened.push(decryptor.update(scratch.subarray(0, length)));
      scratch.fill(0xaa);
    }
    opened.push(decryptor.finish());
    expect(bytesToHex(concatBytes(...opened))).toBe(bytesToHex(plaintext));

    // destroy() wipes the encryptor's own copy of buffered plaintext, not the caller's memory.
    const mine = Buffer.from('still here after destroy');
    const abandoned = new StreamEncryptor(KEY);
    abandoned.update(mine);
    abandoned.destroy();
    expect(mine.toString()).toBe('still here after destroy');
  });

  it('cannot be used after it is finished', () => {
    const encryptor = new StreamEncryptor(KEY);
    encryptor.finish();
    expect(() => encryptor.update(pattern(1))).toThrow(InvalidParametersError);
    expect(() => encryptor.finish()).toThrow(InvalidParametersError);

    const decryptor = new StreamDecryptor(KEY);
    expect(() => decryptor.finish()).toThrow(CorruptEnvelopeError);
    expect(() => decryptor.update(pattern(1))).toThrow(InvalidParametersError);
  });

  it('rejects keys and nonces of the wrong length', () => {
    expect(() => new StreamEncryptor(new Uint8Array(16))).toThrow(InvalidParametersError);
    expect(() => new StreamDecryptor(new Uint8Array(31))).toThrow(InvalidParametersError);
    expect(() => deriveStreamKey(new Uint8Array(32), new Uint8Array(12))).toThrow(InvalidParametersError);
  });

  it('derives a different payload key for every nonce', () => {
    const fileKey = new Uint8Array(32).fill(1);
    const a = deriveStreamKey(fileKey, new Uint8Array(16).fill(1));
    const b = deriveStreamKey(fileKey, new Uint8Array(16).fill(2));
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});
