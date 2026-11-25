import { ByteReader, ByteStream } from '../utils/bytes';
import { CliError, EXIT } from '../utils/errors';

/**
 * A deterministic subset of POSIX tar (ustar, plus a pax `path` record where a name does not fit).
 *
 * The same files always produce the same bytes: entries are written in the order given, and
 * every field that describes the machine rather than the content is fixed. There is no owner, no
 * group, no timestamp, and the mode is one of two values. Only regular files are stored.
 *
 * The output is ordinary tar. `dcrypt decrypt --in section.tar.dcrypt --out section.tar` followed
 * by `tar -xf` recovers a section without any of the code in this folder.
 */
const BLOCK_SIZE = 512;
const NAME_LENGTH = 100;
const MAX_PAX_LENGTH = 64 * 1024;

/** The largest file an 11-digit octal size field can describe: one byte under 8 GiB. */
export const MAX_TAR_FILE_SIZE = 0o77777777777;

const TYPE_FILE = '0';
const TYPE_PAX = 'x';
const MODE_FILE = 0o644;
const MODE_EXECUTABLE = 0o755;
const OWNER_EXECUTE = 0o100;

/** Offset and length of each header field this format reads or writes. */
const FIELD = {
  name: [0, NAME_LENGTH],
  mode: [100, 8],
  uid: [108, 8],
  gid: [116, 8],
  size: [124, 12],
  mtime: [136, 12],
  checksum: [148, 8],
  type: [156, 1],
  magic: [257, 6],
  version: [263, 2],
  prefix: [345, 155],
} as const;

type Field = readonly [offset: number, length: number];

/** A file to archive. `content` must yield exactly `size` bytes. */
export interface TarFile {
  /** Path inside the archive, `/`-separated. */
  path: string;
  size: number;
  executable: boolean;
  content: ByteStream;
}

/** A file read back from an archive. `content` is only valid until the next entry is requested. */
export interface TarEntry {
  path: string;
  size: number;
  executable: boolean;
  content: AsyncIterable<Uint8Array>;
}

const corrupt = (message: string): CliError =>
  new CliError(`the archive is corrupt: ${message}`, EXIT.corrupt);

const paddingFor = (length: number): number => (BLOCK_SIZE - (length % BLOCK_SIZE)) % BLOCK_SIZE;

/** Sum of the header's bytes, with the checksum field itself counted as spaces. */
const checksumOf = (block: Uint8Array): number => {
  const [start, length] = FIELD.checksum;
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += i >= start && i < start + length ? 0x20 : block[i];
  }
  return sum;
};

const octal = (value: number, [, length]: Field): string =>
  value.toString(8).padStart(length - 1, '0') + '\0';

const headerBlock = (name: string, size: number, mode: number, type: string): Buffer => {
  const block = Buffer.alloc(BLOCK_SIZE);
  const put = (field: Field, value: string): void => void block.write(value, field[0], 'latin1');
  put(FIELD.name, name);
  put(FIELD.mode, octal(mode, FIELD.mode));
  put(FIELD.uid, octal(0, FIELD.uid));
  put(FIELD.gid, octal(0, FIELD.gid));
  put(FIELD.size, octal(size, FIELD.size));
  put(FIELD.mtime, octal(0, FIELD.mtime));
  put(FIELD.type, type);
  put(FIELD.magic, 'ustar\0');
  put(FIELD.version, '00');
  put(FIELD.checksum, checksumOf(block).toString(8).padStart(6, '0') + '\0 ');
  return block;
};

/** True when `path` can be stored in the 100-byte name field as it is. */
const fitsNameField = (path: string): boolean => /^[\x20-\x7e]{1,100}$/.test(path);

/** A pax record is `<length> <key>=<value>\n`, where the length counts its own digits. */
const paxRecord = (key: string, value: string): Buffer => {
  const body = Buffer.from(` ${key}=${value}\n`, 'utf8');
  let length = body.length;
  while (String(length).length + body.length !== length) {
    length = String(length).length + body.length;
  }
  return Buffer.concat([Buffer.from(String(length), 'latin1'), body]);
};

/** The header blocks that introduce one file: a pax header first when the path needs one. */
const entryHeader = ({ path, size, executable }: TarFile): Buffer => {
  const mode = executable ? MODE_EXECUTABLE : MODE_FILE;
  if (fitsNameField(path)) return headerBlock(path, size, mode, TYPE_FILE);

  const record = paxRecord('path', path);
  // What a reader without pax support would see: the tail of the path, in printable ASCII.
  const fallback = path.replace(/[^\x20-\x7e]/g, '_').slice(-NAME_LENGTH);
  return Buffer.concat([
    headerBlock('PaxHeader', record.length, MODE_FILE, TYPE_PAX),
    record,
    Buffer.alloc(paddingFor(record.length)),
    headerBlock(fallback, size, mode, TYPE_FILE),
  ]);
};

/** Writes `files` as a tar archive, in the order given. */
export async function* writeTar(
  files: Iterable<TarFile> | AsyncIterable<TarFile>
): AsyncGenerator<Uint8Array> {
  for await (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_TAR_FILE_SIZE) {
      throw new CliError(`${file.path} is too large to archive (the limit is 8 GiB per file)`);
    }
    yield entryHeader(file);
    let written = 0;
    for await (const piece of file.content) {
      written += piece.length;
      if (written > file.size) break;
      yield piece;
    }
    if (written !== file.size) {
      throw new CliError(`${file.path} changed size while it was being archived; run the command again`);
    }
    if (paddingFor(file.size)) yield Buffer.alloc(paddingFor(file.size));
  }
  yield Buffer.alloc(2 * BLOCK_SIZE);
}

const takeBlock = async (reader: ByteReader): Promise<Buffer> => {
  const held = await reader.fill(BLOCK_SIZE);
  if (held.length < BLOCK_SIZE) throw corrupt('it ends in the middle of a block');
  const block = held.subarray(0, BLOCK_SIZE);
  reader.skip(BLOCK_SIZE);
  return block;
};

/** Streams the next `count.remaining` bytes, keeping the count current as they are handed out. */
async function* takeBytes(
  reader: ByteReader,
  count: { remaining: number }
): AsyncGenerator<Uint8Array> {
  while (count.remaining > 0) {
    const held = await reader.fill(1);
    if (!held.length) throw corrupt('it ends in the middle of a file');
    const piece = held.subarray(0, Math.min(held.length, count.remaining));
    reader.skip(piece.length);
    count.remaining -= piece.length;
    yield piece;
  }
}

const skipBytes = async (reader: ByteReader, length: number): Promise<void> => {
  for await (const piece of takeBytes(reader, { remaining: length })) void piece;
};

const textOf = (block: Buffer, [offset, length]: Field): string => {
  const end = block.indexOf(0, offset);
  const stop = end === -1 || end > offset + length ? offset + length : end;
  return block.toString('utf8', offset, stop);
};

const numberOf = (block: Buffer, field: Field, name: string): number => {
  const digits = textOf(block, field).trim();
  if (!/^[0-7]*$/.test(digits)) throw corrupt(`a header has an unreadable ${name}`);
  return parseInt(digits || '0', 8);
};

interface Header {
  path: string;
  size: number;
  mode: number;
  type: string;
}

const parseHeader = (block: Buffer): Header => {
  if (textOf(block, FIELD.magic) !== 'ustar') throw corrupt('a header is not in ustar format');
  if (numberOf(block, FIELD.checksum, 'checksum') !== checksumOf(block)) {
    throw corrupt('a header fails its checksum');
  }
  const name = textOf(block, FIELD.name);
  const prefix = textOf(block, FIELD.prefix);
  return {
    path: prefix ? `${prefix}/${name}` : name,
    size: numberOf(block, FIELD.size, 'size'),
    mode: numberOf(block, FIELD.mode, 'mode'),
    // Archives older than ustar mark a regular file with a NUL instead of "0".
    type: textOf(block, FIELD.type) || TYPE_FILE,
  };
};

/** Reads the one pax record this format writes. Anything else is refused, not skipped. */
const paxPath = (data: Buffer): string => {
  let path: string | undefined;
  for (let offset = 0; offset < data.length; ) {
    const space = data.indexOf(0x20, offset);
    const length = space === -1 ? NaN : Number(data.toString('latin1', offset, space));
    const end = offset + length;
    if (!Number.isInteger(length) || end <= space + 1 || end > data.length || data[end - 1] !== 0x0a) {
      throw corrupt('an extended header is malformed');
    }
    const record = data.toString('utf8', space + 1, end - 1);
    const equals = record.indexOf('=');
    if (record.slice(0, Math.max(equals, 0)) !== 'path') {
      throw corrupt('an extended header carries something other than a path');
    }
    path = record.slice(equals + 1);
    offset = end;
  }
  if (path === undefined) throw corrupt('an extended header is empty');
  return path;
};

const readPaxPath = async (reader: ByteReader, size: number): Promise<string> => {
  if (size > MAX_PAX_LENGTH) throw corrupt('an extended header is implausibly large');
  const pieces: Uint8Array[] = [];
  for await (const piece of takeBytes(reader, { remaining: size })) pieces.push(piece);
  await skipBytes(reader, paddingFor(size));
  return paxPath(Buffer.concat(pieces));
};

/**
 * Reads a tar archive one file at a time. An entry's `content` has to be consumed before the
 * next entry is requested; whatever is left of it then is skipped.
 *
 * The generator only finishes once `source` itself has ended. When the source is a decryptor,
 * that is what makes it check its final chunk: an archive that completes normally came from a
 * ciphertext that was complete.
 */
export async function* readTar(source: ByteStream): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source);
  let path: string | undefined;

  for (;;) {
    const block = await takeBlock(reader);
    if (block.every((byte) => byte === 0)) break;

    const header = parseHeader(block);
    if (header.type === TYPE_PAX) {
      path = await readPaxPath(reader, header.size);
      continue;
    }
    if (header.type !== TYPE_FILE) {
      throw corrupt(`"${header.path}" is not a regular file (links and devices are not accepted)`);
    }

    const count = { remaining: header.size };
    yield {
      path: path ?? header.path,
      size: header.size,
      executable: (header.mode & OWNER_EXECUTE) !== 0,
      content: takeBytes(reader, count),
    };
    path = undefined;
    await skipBytes(reader, count.remaining + paddingFor(header.size));
  }

  if (path !== undefined) throw corrupt('an extended header is not followed by a file');
  // The end marker is two empty blocks; nothing but padding may follow it.
  do {
    if (reader.buffered.some((byte) => byte !== 0)) throw corrupt('data follows the end marker');
    reader.skip(reader.buffered.length);
  } while (await reader.more());
}
