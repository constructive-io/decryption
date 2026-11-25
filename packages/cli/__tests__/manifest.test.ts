import { createHash } from 'crypto';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { EXIT, exitCodeFor } from '../src';
import {
  assertSafePath,
  digestOf,
  hashBytes,
  Manifest,
  MANIFEST_PATH,
  ManifestFile,
  parseManifest,
  serializeManifest,
  snapshotSection,
} from '../src/workspace/manifest';

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex');

const fileOf = (path: string, content = ''): ManifestFile => ({
  path,
  size: Buffer.byteLength(content),
  sha256: sha256(content),
  executable: false,
});

const manifestOf = (...files: ManifestFile[]): Manifest => ({ version: 1, files });

/** A manifest as some other program might have written it: any value, any shape. */
const written = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

describe('assertSafePath', () => {
  it('accepts paths that stay inside the folder', () => {
    for (const path of ['beds.csv', 'notes/todo.txt', 'notes/café.txt', '.hidden', '..hidden', '...', 'a b/c d']) {
      expect(() => assertSafePath(path)).not.toThrow();
    }
  });

  it('rejects every path that could leave it, or name two things at once', () => {
    const unacceptable = [
      '',
      '/etc/hosts',
      '../escape.txt',
      'notes/../../escape.txt',
      'notes/..',
      '.',
      'notes/./todo.txt',
      'notes//todo.txt',
      'notes/',
      'notes\\todo.txt',
      'notes\0.txt',
      MANIFEST_PATH,
      'notes/café.txt', // "é" as two code points: the same name as its one-code-point form
    ];
    for (const path of unacceptable) {
      const failure = ((): unknown => {
        try {
          return assertSafePath(path);
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain('is not acceptable');
      expect(exitCodeFor(failure)).toBe(EXIT.corrupt);
    }
  });
});

describe('serializeManifest / parseManifest', () => {
  const manifest = manifestOf(fileOf('beds.csv', 'tomatoes'), fileOf('notes/todo.txt', 'water'));

  it('round trips', () => {
    expect(parseManifest(serializeManifest(manifest))).toEqual(manifest);
  });

  it('writes one byte sequence for one manifest, whatever order its keys were built in', () => {
    const [beds, todo] = manifest.files;
    const shuffled = manifestOf(
      { executable: beds.executable, sha256: beds.sha256, size: beds.size, path: beds.path },
      { sha256: todo.sha256, path: todo.path, executable: todo.executable, size: todo.size }
    );
    expect(serializeManifest(shuffled).equals(serializeManifest(manifest))).toBe(true);
    expect(digestOf(shuffled)).toBe(digestOf(manifest));
    expect(digestOf(manifest)).toBe(sha256(serializeManifest(manifest).toString('utf8')));
  });

  it('gives a different digest for any difference', () => {
    const [beds, todo] = manifest.files;
    const variants = [
      manifestOf(beds),
      manifestOf(beds, { ...todo, path: 'notes/todo.md' }),
      manifestOf(beds, { ...todo, executable: true }),
      manifestOf(beds, fileOf('notes/todo.txt', 'weed')),
    ];
    const digests = new Set([manifest, ...variants].map(digestOf));
    expect(digests.size).toBe(variants.length + 1);
  });

  const invalid = (bytes: Uint8Array, message: RegExp): void => {
    const failure = ((): unknown => {
      try {
        return parseManifest(bytes);
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(message);
    expect(exitCodeFor(failure)).toBe(EXIT.corrupt);
  };

  it('rejects what is not a manifest', () => {
    invalid(Buffer.from('not json'), /it is not JSON/);
    invalid(written(null), /version undefined is not supported/);
    invalid(written({ version: 2, files: [] }), /version 2 is not supported/);
    invalid(written({ version: 1 }), /the file list is malformed/);
    invalid(written({ version: 1, files: {} }), /the file list is malformed/);
  });

  it('rejects a file entry with a missing or mistyped field', () => {
    const beds = fileOf('beds.csv', 'tomatoes');
    const malformed = [
      null,
      'beds.csv',
      { ...beds, path: 7 },
      { ...beds, size: -1 },
      { ...beds, size: 1.5 },
      { ...beds, size: '8' },
      { ...beds, sha256: beds.sha256.toUpperCase() },
      { ...beds, sha256: beds.sha256.slice(1) },
      { ...beds, executable: 'no' },
      { path: beds.path, size: beds.size, sha256: beds.sha256 },
    ];
    for (const entry of malformed) invalid(written({ version: 1, files: [entry] }), /the file list is malformed/);
  });

  it('rejects files that are out of order, repeated, or unsafe', () => {
    const [beds, todo] = manifest.files;
    invalid(serializeManifest(manifestOf(todo, beds)), /the files are not sorted/);
    invalid(serializeManifest(manifestOf(beds, beds)), /the files are not sorted/);
    invalid(serializeManifest(manifestOf(fileOf('../escape.txt'))), /is not acceptable/);
    invalid(serializeManifest(manifestOf(fileOf(MANIFEST_PATH))), /that name is reserved/);
  });

  it('keeps nothing but the fields it knows', () => {
    const [beds] = manifest.files;
    const parsed = parseManifest(written({ version: 1, files: [{ ...beds, owner: 'ada' }], note: 'hello' }));
    expect(parsed).toEqual(manifestOf(beds));
  });
});

describe('hashBytes', () => {
  it('is SHA-256 over the pieces, in order', async () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await hashBytes([Buffer.from('abc')])).toBe(abc);
    expect(await hashBytes([Buffer.from('a'), Buffer.from(''), Buffer.from('bc')])).toBe(abc);
  });
});

describe('snapshotSection', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'dcrypt-section-'));
  });

  const write = (path: string, content: string, mode?: number, root = directory): void => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    if (mode !== undefined) chmodSync(target, mode);
  };

  it('lists every file with its size, hash and executable bit, sorted by the bytes of its path', async () => {
    write('a/b.txt', 'nested');
    write('a.txt', 'water on tuesdays\n');
    write('a-b.txt', '');
    write('B.txt', 'capital');
    write('run.sh', '#!/bin/sh\n', 0o755);
    write('étagère.txt', 'accents');
    mkdirSync(join(directory, 'empty/folders'), { recursive: true });

    const { manifest, digest, files } = await snapshotSection(directory);
    expect(manifest.files.map((file) => file.path)).toEqual([
      'B.txt',
      'a-b.txt',
      'a.txt',
      'a/b.txt',
      'run.sh',
      'étagère.txt',
    ]);
    expect(manifest.files[2]).toEqual({
      path: 'a.txt',
      size: 18,
      sha256: sha256('water on tuesdays\n'),
      executable: false,
    });
    expect(manifest.files.filter((file) => file.executable).map((file) => file.path)).toEqual(['run.sh']);
    expect(files.map((file) => file.source)).toContain(join(directory, 'a/b.txt'));
    expect(digest).toBe(digestOf(manifest));
    expect(parseManifest(serializeManifest(manifest))).toEqual(manifest);
  });

  it('depends on the content alone: not on where, when or in what order it was written', async () => {
    write('beds.csv', 'tomatoes');
    write('notes/todo.txt', 'water');
    write('run.sh', '#!/bin/sh\n', 0o700);

    const elsewhere = mkdtempSync(join(tmpdir(), 'dcrypt-section-'));
    write('run.sh', '#!/bin/sh\n', 0o755, elsewhere);
    write('notes/todo.txt', 'water', 0o600, elsewhere);
    write('beds.csv', 'tomatoes', 0o644, elsewhere);
    write('.DS_Store', 'finder droppings', undefined, elsewhere);
    write('notes/.DS_Store', 'more of them', undefined, elsewhere);
    mkdirSync(join(elsewhere, 'empty'));

    const here = await snapshotSection(directory);
    expect((await snapshotSection(elsewhere)).digest).toBe(here.digest);

    write('notes/todo.txt', 'weed', undefined, elsewhere);
    expect((await snapshotSection(elsewhere)).digest).not.toBe(here.digest);
  });

  it('records a name in its normalized form, however the file system stores it', async () => {
    write('café.txt', 'accents');
    const { manifest, files } = await snapshotSection(directory);
    expect(manifest.files.map((file) => file.path)).toEqual(['café.txt']);
    expect(await hashBytes([Buffer.from('accents')])).toBe(files[0].sha256);
  });

  it('is empty for an empty folder', async () => {
    const { manifest } = await snapshotSection(directory);
    expect(manifest.files).toEqual([]);
  });

  it('refuses a link, wherever it points', async () => {
    write('beds.csv', 'tomatoes');
    symlinkSync(join(directory, 'beds.csv'), join(directory, 'shortcut'));
    await expect(snapshotSection(directory)).rejects.toThrow(/shortcut is a link or a special file/);
  });

  it('refuses a name it could not write back', async () => {
    write(MANIFEST_PATH, '{}');
    await expect(snapshotSection(directory)).rejects.toThrow(/cannot be stored/);
  });
});
