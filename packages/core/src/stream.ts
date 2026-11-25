import { chacha20poly1305 } from '@decryption/ciphers/chacha';
import { hkdf } from '@decryption/hashes/hkdf';
import { sha256 } from '@decryption/hashes/sha2';
import { concatBytes, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import { copyBytes } from './bytes';
import { CorruptEnvelopeError, InvalidParametersError } from './errors';

/**
 * Chunked authenticated encryption for payloads too large to hold in one buffer.
 *
 * This is the payload layer of the age file format (https://age-encryption.org/v1, "Payload"),
 * which is the STREAM construction of Hoang, Reyhanitabar, Rogaway and Vizár ("Online
 * Authenticated-Encryption and its Nonce-Reuse Misuse-Resistance", 2015), implemented as
 * specified rather than redesigned:
 *
 * - the plaintext is split into 64 KiB chunks, each sealed with ChaCha20-Poly1305;
 * - the 12-byte nonce is an 11-byte big-endian chunk counter followed by one flag byte, `0x01`
 *   on the final chunk and `0x00` on every other;
 * - the final chunk may be short, but may be empty only when the whole payload is empty;
 * - the key is `HKDF-SHA256(ikm = file key, salt = 16-byte random nonce, info = "payload")`.
 *
 * Reordered, dropped, duplicated and truncated chunks all fail authentication, because the
 * counter and the final flag are part of every nonce. The test suite decrypts age's own STREAM
 * test vectors with this code.
 */

/** Plaintext bytes per chunk. */
export const STREAM_CHUNK_SIZE = 64 * 1024;

/** Poly1305 tag appended to every chunk. */
export const STREAM_TAG_LENGTH = 16;

/** Random per-file nonce the payload key is derived with; it precedes the first chunk. */
export const STREAM_NONCE_LENGTH = 16;

/** Length of the derived ChaCha20-Poly1305 payload key. */
export const STREAM_KEY_LENGTH = 32;

const ENCRYPTED_CHUNK_SIZE = STREAM_CHUNK_SIZE + STREAM_TAG_LENGTH;
const PAYLOAD_INFO = utf8ToBytes('payload');
const EMPTY = new Uint8Array(0);

/** Draws the random nonce that is stored in front of the chunks. */
export const generateStreamNonce = (): Uint8Array => randomBytes(STREAM_NONCE_LENGTH);

/** Derives the payload key exactly as age does. A file key is used for one payload only. */
export const deriveStreamKey = (fileKey: Uint8Array, nonce: Uint8Array): Uint8Array => {
  if (fileKey.length < 16) {
    throw new InvalidParametersError(`file key must be at least 16 bytes, got ${fileKey.length}`);
  }
  if (nonce.length !== STREAM_NONCE_LENGTH) {
    throw new InvalidParametersError(
      `stream nonce must be ${STREAM_NONCE_LENGTH} bytes, got ${nonce.length}`
    );
  }
  return hkdf(sha256, fileKey, nonce, PAYLOAD_INFO, STREAM_KEY_LENGTH);
};

/** Builds chunk nonces: an 11-byte big-endian counter, then the last-chunk flag. */
class ChunkNonces {
  private counter = 0;

  /** Number of chunks numbered so far. */
  get count(): number {
    return this.counter;
  }

  next(last: boolean): Uint8Array {
    // 2^53 chunks of 64 KiB is far beyond any real file, but the counter must never wrap.
    if (!Number.isSafeInteger(this.counter + 1)) {
      throw new InvalidParametersError('stream chunk counter exhausted');
    }
    const nonce = new Uint8Array(12);
    let remaining = this.counter;
    for (let i = 10; i >= 0 && remaining > 0; i--) {
      nonce[i] = remaining % 256;
      remaining = Math.floor(remaining / 256);
    }
    nonce[11] = last ? 1 : 0;
    this.counter += 1;
    return nonce;
  }
}

const assertStreamKey = (key: Uint8Array): void => {
  if (key.length !== STREAM_KEY_LENGTH) {
    throw new InvalidParametersError(`stream key must be ${STREAM_KEY_LENGTH} bytes, got ${key.length}`);
  }
};

const joinChunks = (chunks: Uint8Array[]): Uint8Array =>
  chunks.length === 1 ? chunks[0] : concatBytes(...chunks);

/**
 * Encrypts a payload incrementally. Feed plaintext in pieces of any size through
 * {@link StreamEncryptor.update} and call {@link StreamEncryptor.finish} exactly once; each call
 * returns the ciphertext that is ready to be written. Memory use is bounded by one chunk plus
 * the largest piece passed in.
 */
export class StreamEncryptor {
  private readonly key: Uint8Array;
  private readonly nonces = new ChunkNonces();
  private pending: Uint8Array = EMPTY;
  private finished = false;

  constructor(key: Uint8Array) {
    assertStreamKey(key);
    this.key = Uint8Array.from(key);
  }

  update(data: Uint8Array): Uint8Array {
    if (this.finished) throw new InvalidParametersError('stream is already finished');
    if (data.length === 0) return EMPTY;
    const sealed: Uint8Array[] = [];
    // A full chunk is only written once more plaintext follows it: whichever chunk turns out to
    // be the last one has to be sealed with the final flag, and only finish() knows that.
    let buffered = data;
    if (this.pending.length === STREAM_CHUNK_SIZE) {
      sealed.push(this.seal(this.pending, false));
    } else if (this.pending.length) {
      buffered = concatBytes(this.pending, data);
    }
    let offset = 0;
    while (buffered.length - offset > STREAM_CHUNK_SIZE) {
      sealed.push(this.seal(buffered.subarray(offset, offset + STREAM_CHUNK_SIZE), false));
      offset += STREAM_CHUNK_SIZE;
    }
    this.pending.fill(0);
    this.pending = copyBytes(buffered, offset);
    return joinChunks(sealed);
  }

  /** Seals whatever is buffered as the final chunk. An empty payload is one empty final chunk. */
  finish(): Uint8Array {
    if (this.finished) throw new InvalidParametersError('stream is already finished');
    this.finished = true;
    try {
      return this.seal(this.pending, true);
    } finally {
      this.destroy();
    }
  }

  /** Wipes the key and any buffered plaintext. Called by finish(); call it yourself on abort. */
  destroy(): void {
    this.finished = true;
    this.key.fill(0);
    this.pending.fill(0);
    this.pending = EMPTY;
  }

  private seal(chunk: Uint8Array, last: boolean): Uint8Array {
    return chacha20poly1305(this.key, this.nonces.next(last)).encrypt(chunk);
  }
}

/**
 * Decrypts a payload incrementally. Plaintext returned by {@link StreamDecryptor.update} has been
 * authenticated chunk by chunk, but the payload as a whole is only known to be complete once
 * {@link StreamDecryptor.finish} returns: a truncated file fails there. Callers that write the
 * plaintext somewhere must therefore treat it as provisional until finish() succeeds.
 */
export class StreamDecryptor {
  private readonly key: Uint8Array;
  private readonly nonces = new ChunkNonces();
  private pending: Uint8Array = EMPTY;
  private finished = false;

  constructor(key: Uint8Array) {
    assertStreamKey(key);
    this.key = Uint8Array.from(key);
  }

  update(data: Uint8Array): Uint8Array {
    if (this.finished) throw new InvalidParametersError('stream is already finished');
    if (data.length === 0) return EMPTY;
    const opened: Uint8Array[] = [];
    // Mirror of the encryptor: a chunk is opened as a non-final one only when ciphertext
    // follows it. The trailing chunk waits for finish(), which requires the final flag.
    let buffered = data;
    if (this.pending.length === ENCRYPTED_CHUNK_SIZE) {
      opened.push(this.open(this.pending, false));
    } else if (this.pending.length) {
      buffered = concatBytes(this.pending, data);
    }
    let offset = 0;
    while (buffered.length - offset > ENCRYPTED_CHUNK_SIZE) {
      opened.push(this.open(buffered.subarray(offset, offset + ENCRYPTED_CHUNK_SIZE), false));
      offset += ENCRYPTED_CHUNK_SIZE;
    }
    this.pending = copyBytes(buffered, offset);
    return joinChunks(opened);
  }

  /** Opens the final chunk. Throws if the payload was truncated or extended. */
  finish(): Uint8Array {
    if (this.finished) throw new InvalidParametersError('stream is already finished');
    try {
      if (this.pending.length < STREAM_TAG_LENGTH) {
        throw new CorruptEnvelopeError('encrypted payload is truncated');
      }
      if (this.pending.length === STREAM_TAG_LENGTH && this.nonces.count > 0) {
        // age: "the final chunk MUST NOT be empty unless the whole payload is empty".
        throw new CorruptEnvelopeError('encrypted payload ends with an empty chunk');
      }
      return this.open(this.pending, true);
    } finally {
      this.destroy();
    }
  }

  /** Wipes the key. Called by finish(); call it yourself when abandoning a stream. */
  destroy(): void {
    this.finished = true;
    this.key.fill(0);
    this.pending = EMPTY;
  }

  private open(chunk: Uint8Array, last: boolean): Uint8Array {
    const index = this.nonces.count;
    try {
      return chacha20poly1305(this.key, this.nonces.next(last)).decrypt(chunk);
    } catch {
      this.destroy();
      throw new CorruptEnvelopeError(
        `encrypted payload failed authentication at chunk ${index}: it is corrupt, truncated or was modified`
      );
    }
  }
}

/** One-shot form of {@link StreamEncryptor}, for payloads already in memory. */
export const streamEncrypt = (key: Uint8Array, plaintext: Uint8Array): Uint8Array => {
  const encryptor = new StreamEncryptor(key);
  const head = encryptor.update(plaintext);
  return concatBytes(head, encryptor.finish());
};

/** One-shot form of {@link StreamDecryptor}. Returns nothing unless the whole payload is intact. */
export const streamDecrypt = (key: Uint8Array, ciphertext: Uint8Array): Uint8Array => {
  const decryptor = new StreamDecryptor(key);
  const head = decryptor.update(ciphertext);
  return concatBytes(head, decryptor.finish());
};
