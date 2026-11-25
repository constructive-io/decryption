import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ByteStream, EXIT, exitCodeFor } from '../src';
import { MAX_TAR_FILE_SIZE, readTar, TarFile, writeTar } from '../src/workspace/tar';

const BLOCK = 512;

/** Deterministic filler, so that nothing in an archive is real data. */
const pattern = (length: number): Buffer =>
  Buffer.from(Uint8Array.from({ length }, (_, i) => (i * 131 + (i >> 8) * 17 + 255) % 256));

const fileOf = (path: string, content: Buffer | string, executable = false): TarFile => {
  const bytes = Buffer.from(content);
  return { path, size: bytes.length, executable, content: [bytes] };
};

const collect = async (stream: ByteStream): Promise<Buffer> => {
  const pieces: Uint8Array[] = [];
  for await (const piece of stream) pieces.push(piece);
  return Buffer.concat(pieces);
};

const archive = (files: TarFile[]): Promise<Buffer> => collect(writeTar(files));

/** Feeds an archive to the reader in pieces of `size` bytes, as a stream would deliver it. */
function* inPieces(bytes: Buffer, size: number): Generator<Buffer> {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
}

interface ReadBack {
  path: string;
  executable: boolean;
  content: Buffer;
}

const read = async (bytes: Buffer, pieceSize = 4096): Promise<ReadBack[]> => {
  const entries: ReadBack[] = [];
  for await (const { path, executable, content } of readTar(inPieces(bytes, pieceSize))) {
    entries.push({ path, executable, content: await collect(content) });
  }
  return entries;
};

/** Rewrites a header block's checksum, so that a test can change a field and keep it valid. */
const resealed = (bytes: Buffer, offset = 0): Buffer => {
  const copy = Buffer.from(bytes);
  copy.fill(0x20, offset + 148, offset + 156);
  const sum = copy.subarray(offset, offset + BLOCK).reduce((total, byte) => total + byte, 0);
  copy.write(sum.toString(8).padStart(6, '0') + '\0 ', offset + 148, 'latin1');
  return copy;
};

const LONG_PATH = `${'archive/'.repeat(14)}a-name-that-does-not-fit-the-hundred-byte-field.txt`;

const SAMPLE: TarFile[] = [
  fileOf('beds.csv', 'bed,crop\n1,tomatoes\n'),
  fileOf('empty.txt', ''),
  fileOf('exactly-one-block.bin', pattern(BLOCK)),
  fileOf('notes/café.txt', 'accents survive'),
  fileOf('run.sh', '#!/bin/sh\necho hello\n', true),
  fileOf('several-chunks.bin', pattern(70000)),
  fileOf(LONG_PATH, 'a long way down'),
];

describe('writeTar / readTar', () => {
  it('round trips names, content and the executable bit', async () => {
    const bytes = await archive(SAMPLE);
    expect(bytes.length % BLOCK).toBe(0);
    for (const pieceSize of [7, 4096, bytes.length]) {
      const entries = await read(bytes, pieceSize);
      expect(entries.map((entry) => entry.path)).toEqual(SAMPLE.map((file) => file.path));
      expect(entries.map((entry) => entry.executable)).toEqual(SAMPLE.map((file) => file.executable));
      for (const [index, entry] of entries.entries()) {
        expect(entry.content.equals(await collect(SAMPLE[index].content))).toBe(true);
      }
    }
  });

  it('skips content the caller did not read', async () => {
    const paths: string[] = [];
    for await (const entry of readTar([await archive(SAMPLE)])) paths.push(entry.path);
    expect(paths).toEqual(SAMPLE.map((file) => file.path));
  });

  it('writes the same bytes for the same files, with nothing of the machine in them', async () => {
    const bytes = await archive(SAMPLE);
    expect((await archive(SAMPLE)).equals(bytes)).toBe(true);

    const header = bytes.subarray(0, BLOCK);
    expect(header.toString('latin1', 100, 107)).toBe('0000644');
    expect(header.toString('latin1', 108, 115)).toBe('0000000'); // uid
    expect(header.toString('latin1', 116, 123)).toBe('0000000'); // gid
    expect(header.toString('latin1', 136, 147)).toBe('00000000000'); // mtime
    expect(header.subarray(265, 345).every((byte) => byte === 0)).toBe(true); // owner and group names
  });

  it('is an archive the system tar can extract', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dcrypt-tar-'));
    const files = SAMPLE.filter((file) => /^[\x20-\x7e]+$/.test(file.path));
    writeFileSync(join(directory, 'sample.tar'), await archive(files));
    mkdirSync(join(directory, 'out'));

    const tar = spawnSync('tar', ['-xf', join(directory, 'sample.tar'), '-C', join(directory, 'out')], {
      encoding: 'utf8',
    });
    expect(tar.stderr).toBe('');
    expect(tar.status).toBe(0);
    for (const file of files) {
      const extracted = join(directory, 'out', file.path);
      expect(readFileSync(extracted).equals(await collect(file.content))).toBe(true);
      expect((statSync(extracted).mode & 0o100) !== 0).toBe(file.executable);
    }
  });

  it('refuses a file larger than the format can describe, before reading it', async () => {
    const huge: TarFile = {
      path: 'huge.bin',
      size: MAX_TAR_FILE_SIZE + 1,
      executable: false,
      content: {
        [Symbol.iterator]: () => {
          throw new Error('the content must not be read');
        },
      },
    };
    await expect(archive([huge])).rejects.toThrow(/too large to archive/);
  });

  it('refuses a file whose content is not the size it was given', async () => {
    const shorter = { ...fileOf('notes.txt', 'short'), size: 9 };
    const longer = { ...fileOf('notes.txt', 'rather longer'), size: 4 };
    await expect(archive([shorter])).rejects.toThrow(/changed size/);
    await expect(archive([longer])).rejects.toThrow(/changed size/);
  });
});

describe('readTar on an archive it did not write', () => {
  const corrupt = async (bytes: Buffer, message: RegExp): Promise<void> => {
    const failure: unknown = await read(bytes).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(message);
    expect(exitCodeFor(failure)).toBe(EXIT.corrupt);
  };

  it('rejects a header that fails its checksum', async () => {
    const bytes = await archive([fileOf('beds.csv', 'tomatoes')]);
    bytes[0] ^= 1;
    await corrupt(bytes, /fails its checksum/);
  });

  it('rejects links, folders and devices', async () => {
    for (const type of ['1', '2', '3', '5', 'L']) {
      const bytes = await archive([fileOf('beds.csv', '')]);
      bytes.write(type, 156, 'latin1');
      await corrupt(resealed(bytes), /not a regular file/);
    }
  });

  it('rejects an extended header that carries anything but a path', async () => {
    const bytes = await archive([fileOf(LONG_PATH, 'a long way down')]);
    const record = bytes.indexOf(' path=');
    bytes.write(' size=', record, 'latin1');
    await corrupt(bytes, /something other than a path/);
  });

  it('rejects an archive that stops early', async () => {
    const bytes = await archive([fileOf('several-chunks.bin', pattern(70000))]);
    await corrupt(bytes.subarray(0, BLOCK + 1000), /ends in the middle of a file/);
    await corrupt(bytes.subarray(0, bytes.length - 2 * BLOCK), /ends in the middle of a block/);
    await corrupt(Buffer.alloc(0), /ends in the middle of a block/);
  });

  it('rejects data after the end marker', async () => {
    const bytes = await archive([fileOf('beds.csv', 'tomatoes')]);
    await corrupt(Buffer.concat([bytes, Buffer.from('more')]), /data follows the end marker/);
    // Padding is not data: other tools round an archive up to a multiple of their record size.
    expect(await read(Buffer.concat([bytes, Buffer.alloc(9 * BLOCK)]))).toHaveLength(1);
  });
});
