import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import {
  ByteReader,
  ByteStream,
  chainBytes,
  CliError,
  transformBytes,
  writeFileAtomically,
} from '../src';

const bytes = (text: string): Uint8Array => Buffer.from(text, 'utf8');

const collect = async (stream: ByteStream): Promise<string> => {
  const pieces: Uint8Array[] = [];
  for await (const piece of stream) pieces.push(piece);
  return Buffer.concat(pieces).toString('utf8');
};

describe('ByteReader', () => {
  const pieces = () => [bytes('DCR'), bytes('YPT'), bytes('-header|'), bytes('payload '), bytes('bytes')];

  it('buffers only as far as it is asked to', async () => {
    const reader = new ByteReader(pieces());
    expect((await reader.fill(4)).toString()).toBe('DCRYPT');
    expect(reader.buffered.toString()).toBe('DCRYPT');
  });

  it('returns what there is when the stream ends first', async () => {
    const reader = new ByteReader([bytes('short')]);
    expect((await reader.fill(64)).toString()).toBe('short');
    expect(await reader.more()).toBe(false);
  });

  it('hands on exactly the bytes that were not consumed', async () => {
    const reader = new ByteReader(pieces());
    await reader.fill(8);
    reader.skip('DCRYPT-header|'.length);
    expect(await collect(reader.rest())).toBe('payload bytes');
  });

  it('reads the rest into memory', async () => {
    const reader = new ByteReader(pieces());
    await reader.fill(1);
    reader.skip(1);
    expect((await reader.all()).toString()).toBe('CRYPT-header|payload bytes');
    expect(reader.buffered.length).toBe(0);
  });

  it('reads a Node stream the same way', async () => {
    const reader = new ByteReader(Readable.from(pieces()));
    await reader.fill(7);
    reader.skip(7);
    expect(await collect(reader.rest())).toBe('header|payload bytes');
  });
});

describe('transformBytes', () => {
  /** Stands in for a chunked cipher: holds back the last piece, like the real ones do. */
  const shout = () => {
    let held = '';
    return {
      update(data: Uint8Array): Uint8Array {
        const ready = held;
        held = Buffer.from(data).toString('utf8').toUpperCase();
        return bytes(ready);
      },
      finish: (): Uint8Array => bytes(`${held}!`),
    };
  };

  it('runs every piece through update() and ends with finish()', async () => {
    const output = transformBytes([bytes('one '), bytes('two '), bytes('three')], shout());
    expect(await collect(output)).toBe('ONE TWO THREE!');
  });

  it('never emits an empty piece', async () => {
    const lengths: number[] = [];
    for await (const piece of transformBytes([bytes('a'), bytes('b')], shout())) {
      lengths.push(piece.length);
    }
    expect(lengths).toEqual([1, 2]);
  });

  it('chains after a header', async () => {
    const output = chainBytes([bytes('header|')], transformBytes([bytes('body')], shout()));
    expect(await collect(output)).toBe('header|BODY!');
  });
});

describe('writeFileAtomically', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dcrypt-bytes-'));
  });

  /** Yields part of a file, then fails the way a bad authentication tag does. */
  async function* interrupted(): AsyncGenerator<Uint8Array> {
    yield bytes('the first chunk was fine, ');
    throw new Error('chunk 1 failed authentication');
  }

  it('creates the file owner-only, with nothing left beside it', async () => {
    const path = join(dir, 'notes.txt');
    await writeFileAtomically(path, [bytes('meeting '), bytes('notes')]);
    expect(readFileSync(path, 'utf8')).toBe('meeting notes');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['notes.txt']);
  });

  it('replaces an existing file only when every byte arrived', async () => {
    const path = join(dir, 'notes.txt');
    writeFileSync(path, 'the version worth keeping');

    await expect(writeFileAtomically(path, interrupted())).rejects.toThrow('failed authentication');
    expect(readFileSync(path, 'utf8')).toBe('the version worth keeping');
    expect(readdirSync(dir)).toEqual(['notes.txt']);

    await writeFileAtomically(path, [bytes('the new version')]);
    expect(readFileSync(path, 'utf8')).toBe('the new version');
  });

  it('does not create the file when the bytes fail', async () => {
    const path = join(dir, 'never.txt');
    await expect(writeFileAtomically(path, interrupted())).rejects.toThrow();
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('writes through a symlink instead of replacing it', async () => {
    const real = join(dir, 'real.txt');
    const link = join(dir, 'link.txt');
    writeFileSync(real, 'old');
    symlinkSync(real, link);
    await writeFileAtomically(link, [bytes('new')]);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('new');
  });

  it('refuses a directory, and a directory that does not exist', async () => {
    await expect(writeFileAtomically(dir, [bytes('x')])).rejects.toThrow(CliError);
    await expect(writeFileAtomically(join(dir, 'missing', 'x.txt'), [bytes('x')])).rejects.toThrow(
      CliError
    );
  });
});
