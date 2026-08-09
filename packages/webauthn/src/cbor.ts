/**
 * Just enough CBOR for WebAuthn: canonical (CTAP2) encoding of the maps and
 * byte strings an authenticator emits, and decoding of the same. A passkey
 * only ever needs integers, byte strings, text, arrays and maps — no tags, no
 * floats, no indefinite lengths — so a full CBOR library would be a dependency
 * carrying far more than it is asked to do.
 */
export type CborValue =
  | number
  | string
  | boolean
  | null
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>;

const head = (major: number, length: number): Uint8Array => {
  if (length < 24) return Uint8Array.from([(major << 5) | length]);
  if (length < 0x100) return Uint8Array.from([(major << 5) | 24, length]);
  if (length < 0x10000) {
    return Uint8Array.from([(major << 5) | 25, length >> 8, length & 0xff]);
  }
  return Uint8Array.from([
    (major << 5) | 26,
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);
};

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

/**
 * Canonical ordering per CTAP2: shorter keys first, then bytewise. Relying
 * parties re-encode the COSE key to compare it, so the order is not cosmetic.
 */
const canonical = (entries: [CborValue, CborValue][]): [CborValue, CborValue][] =>
  [...entries].sort(([a], [b]) => {
    const left = encode(a);
    const right = encode(b);
    if (left.length !== right.length) return left.length - right.length;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  });

export const encode = (value: CborValue): Uint8Array => {
  if (value === null) return Uint8Array.from([0xf6]);
  if (typeof value === 'boolean') return Uint8Array.from([value ? 0xf5 : 0xf4]);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('cbor: only integers are supported');
    return value < 0 ? head(1, -value - 1) : head(0, value);
  }
  if (value instanceof Uint8Array) return concat([head(2, value.length), value]);
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concat([head(3, bytes.length), bytes]);
  }
  if (Array.isArray(value)) {
    return concat([head(4, value.length), ...value.map(encode)]);
  }
  const entries = canonical([...value.entries()]);
  return concat([
    head(5, entries.length),
    ...entries.map(([key, item]) => concat([encode(key), encode(item)])),
  ]);
};

interface Cursor {
  bytes: Uint8Array;
  at: number;
}

const readLength = (cursor: Cursor, extra: number): number => {
  if (extra < 24) return extra;
  const width = extra === 24 ? 1 : extra === 25 ? 2 : extra === 26 ? 4 : 0;
  if (!width) throw new Error('cbor: unsupported length encoding');
  let length = 0;
  for (let i = 0; i < width; i += 1) {
    length = length * 256 + cursor.bytes[cursor.at + i];
  }
  cursor.at += width;
  return length;
};

const readValue = (cursor: Cursor): CborValue => {
  const byte = cursor.bytes[cursor.at];
  cursor.at += 1;
  const major = byte >> 5;
  const extra = byte & 0x1f;
  switch (major) {
    case 0:
      return readLength(cursor, extra);
    case 1:
      return -1 - readLength(cursor, extra);
    case 2: {
      const length = readLength(cursor, extra);
      const slice = cursor.bytes.slice(cursor.at, cursor.at + length);
      cursor.at += length;
      return slice;
    }
    case 3: {
      const length = readLength(cursor, extra);
      const slice = cursor.bytes.slice(cursor.at, cursor.at + length);
      cursor.at += length;
      return new TextDecoder().decode(slice);
    }
    case 4: {
      const length = readLength(cursor, extra);
      return Array.from({ length }, () => readValue(cursor));
    }
    case 5: {
      const length = readLength(cursor, extra);
      const map = new Map<CborValue, CborValue>();
      for (let i = 0; i < length; i += 1) {
        const key = readValue(cursor);
        map.set(key, readValue(cursor));
      }
      return map;
    }
    case 7:
      if (extra === 20) return false;
      if (extra === 21) return true;
      if (extra === 22) return null;
      throw new Error('cbor: unsupported simple value');
    default:
      throw new Error(`cbor: unsupported major type ${major}`);
  }
};

export const decode = (bytes: Uint8Array): CborValue =>
  readValue({ bytes, at: 0 });
