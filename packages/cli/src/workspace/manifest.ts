import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { lstat, readdir } from 'fs/promises';
import { join } from 'path';

import { ByteStream, IO_CHUNK_SIZE } from '../utils/bytes';
import { CliError, EXIT } from '../utils/errors';

/**
 * What a section contains: every file's path, size and SHA-256.
 *
 * The manifest is the first entry of a section's archive, inside the encryption. It is what makes
 * "nothing changed" cheap to establish (two sections are the same exactly when their manifests
 * are), and it is what an extraction is checked against before any plaintext is replaced.
 */
export const MANIFEST_PATH = '.dcrypt-manifest.json';
export const MANIFEST_VERSION = 1;

/** Finder metadata, rewritten whenever a folder is opened: never part of a section. */
const IGNORED_NAMES = new Set(['.DS_Store']);

const OWNER_EXECUTE = 0o100;

export interface ManifestFile {
  /** Path inside the section: `/`-separated, NFC-normalized, never absolute. */
  path: string;
  size: number;
  /** Lowercase hex. */
  sha256: string;
  executable: boolean;
}

export interface Manifest {
  version: typeof MANIFEST_VERSION;
  /** Sorted by the bytes of `path`. */
  files: ManifestFile[];
}

/** A manifest entry together with where its file is on this machine. */
export interface SectionFile extends ManifestFile {
  source: string;
}

/** A section's plaintext as it is on disk right now. */
export interface Snapshot {
  manifest: Manifest;
  /** SHA-256 of the canonical manifest: one value that identifies the whole content. */
  digest: string;
  files: SectionFile[];
}

const invalid = (message: string): CliError =>
  new CliError(`the manifest is invalid: ${message}`, EXIT.corrupt);

/**
 * Throws unless `path` names a file strictly inside the directory it will be extracted into.
 * Applied to every path that comes out of a bundle, before anything is written.
 */
export const assertSafePath = (path: string): void => {
  const reason =
    path.length === 0
      ? 'it is empty'
      : /[\0\\]/.test(path)
        ? 'it contains a NUL or a backslash'
        : path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
          ? 'it is absolute or has an empty, "." or ".." segment'
          : path === MANIFEST_PATH
            ? 'that name is reserved'
            : path !== path.normalize('NFC')
              ? 'it is not NFC-normalized'
              : undefined;
  if (reason) throw invalid(`path ${JSON.stringify(path)} is not acceptable (${reason})`);
};

const byPath = (a: { path: string }, b: { path: string }): number =>
  Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8'));

/** The one byte sequence a manifest is written as: fixed key order, sorted files. */
export const serializeManifest = (manifest: Manifest): Buffer => {
  const files = manifest.files.map(({ path, size, sha256, executable }) => ({
    path,
    size,
    sha256,
    executable,
  }));
  return Buffer.from(JSON.stringify({ version: manifest.version, files }, null, 2) + '\n', 'utf8');
};

export const digestOf = (manifest: Manifest): string =>
  createHash('sha256').update(serializeManifest(manifest)).digest('hex');

const isManifestFile = (value: unknown): value is ManifestFile => {
  const file = value as ManifestFile;
  return (
    typeof file === 'object' &&
    file !== null &&
    typeof file.path === 'string' &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    typeof file.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(file.sha256) &&
    typeof file.executable === 'boolean'
  );
};

/**
 * Parses a manifest read from a bundle. Strict about every field it reads; a field it does not
 * know is dropped, so that nothing outside the format can reach the digest.
 */
export const parseManifest = (bytes: Uint8Array): Manifest => {
  let parsed: { version?: unknown; files?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw invalid('it is not JSON');
  }
  if (parsed?.version !== MANIFEST_VERSION) {
    throw invalid(`version ${JSON.stringify(parsed?.version)} is not supported`);
  }
  if (!Array.isArray(parsed.files) || !parsed.files.every(isManifestFile)) {
    throw invalid('the file list is malformed');
  }
  const files: ManifestFile[] = parsed.files.map(({ path, size, sha256, executable }) => ({
    path,
    size,
    sha256,
    executable,
  }));
  files.forEach((file, index) => {
    assertSafePath(file.path);
    // Strictly ascending order also rules out duplicates.
    if (index > 0 && byPath(files[index - 1], file) >= 0) throw invalid('the files are not sorted');
  });
  return { version: MANIFEST_VERSION, files };
};

const readBytes = (path: string): ByteStream => createReadStream(path, { highWaterMark: IO_CHUNK_SIZE });

/** SHA-256 of a byte stream, as lowercase hex. */
export const hashBytes = async (bytes: ByteStream): Promise<string> => {
  const hash = createHash('sha256');
  for await (const piece of bytes) hash.update(piece);
  return hash.digest('hex');
};

export const hashFile = (path: string): Promise<string> => hashBytes(readBytes(path));

interface FoundFile {
  path: string;
  source: string;
  size: number;
  executable: boolean;
}

/** Every regular file under `directory`. Anything that is not a file or a folder is refused. */
const findFiles = async (directory: string, prefix = ''): Promise<FoundFile[]> => {
  const found: FoundFile[] = [];
  for (const name of await readdir(directory)) {
    if (IGNORED_NAMES.has(name)) continue;
    const source = join(directory, name);
    // The name on disk is used to read the file; the manifest records its normalized form, so
    // that the same section has the same digest on file systems that store names differently.
    const path = prefix + name.normalize('NFC');
    const stats = await lstat(source);
    if (stats.isDirectory()) {
      found.push(...(await findFiles(source, `${path}/`)));
    } else if (stats.isFile()) {
      found.push({ path, source, size: stats.size, executable: (stats.mode & OWNER_EXECUTE) !== 0 });
    } else {
      throw new CliError(
        `${source} is a link or a special file; a section holds regular files only (empty folders are not kept)`
      );
    }
  }
  return found;
};

/** Reads a section's plaintext: finds its files and hashes each one. */
export const snapshotSection = async (directory: string): Promise<Snapshot> => {
  const found = (await findFiles(directory)).sort(byPath);
  const files: SectionFile[] = [];
  for (const file of found) {
    try {
      assertSafePath(file.path);
    } catch {
      throw new CliError(
        `${file.source} cannot be stored: its name is reserved, or contains a backslash or a NUL`
      );
    }
    if (files.length && files[files.length - 1].path === file.path) {
      throw new CliError(`${file.source} has the same name as another file once normalized`);
    }
    files.push({ ...file, sha256: await hashFile(file.source) });
  }
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    files: files.map(({ path, size, sha256, executable }) => ({ path, size, sha256, executable })),
  };
  return { manifest, digest: digestOf(manifest), files };
};
