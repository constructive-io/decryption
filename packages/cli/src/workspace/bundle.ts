import { StreamDecryptor } from '@decryption/core';
import {
  createIdentityFileDecryptor,
  createRecipientFileEncryptor,
  fileRecipients,
  Identity,
} from '@decryption/keys';
import { createHash, Hash, randomBytes } from 'crypto';
import { createReadStream, existsSync, readdirSync, renameSync, rmSync } from 'fs';
import { mkdir, open } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { pipeline } from 'stream/promises';

import {
  ByteReader,
  ByteStream,
  chainBytes,
  IO_CHUNK_SIZE,
  syncDirectory,
  syncFile,
  transformBytes,
  writeFileAtomically,
} from '../utils/bytes';
import { CliError, EXIT } from '../utils/errors';
import { readFileHeader } from '../utils/header';
import { discardTemp, isTempName, tempPathFor, trackTemp, untrackTemp } from '../utils/temp';
import { REPLACED_MARKER, Section } from './layout';
import {
  digestOf,
  Manifest,
  MANIFEST_PATH,
  ManifestFile,
  parseManifest,
  SectionFile,
  serializeManifest,
  Snapshot,
} from './manifest';
import { readTar, TarEntry, TarFile, writeTar } from './tar';

/**
 * A bundle is a section's files as one encrypted file: a deterministic tar whose first entry is
 * the manifest, inside the streamed envelope `dcrypt encrypt --binary --recipient` writes.
 *
 * Everything about the section is inside the encryption: file names, sizes, how many files there
 * are. From outside, a bundle shows its own size and the fingerprints of its recipients.
 *
 * A bundle says nothing about who made it. Recipient keys are public, so anyone who has them can
 * produce a bundle that decrypts cleanly. That is why extraction trusts nothing in one: every
 * path is checked before a byte is written, and nothing is written outside a fresh folder.
 */
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/';

/** Far more than any real manifest; it is held in memory, so it has a bound. */
const MAX_MANIFEST_SIZE = 256 * 1024 * 1024;

/** The bundle on disk is a Git LFS pointer: the real file has not been downloaded. */
export class LfsPointerError extends CliError {
  constructor(path: string) {
    super(`${path} is a Git LFS pointer, not the bundle itself; run \`git lfs pull\``, EXIT.notFound);
    this.name = 'LfsPointerError';
  }
}

const mismatch = (message: string): CliError =>
  new CliError(`the bundle does not match its manifest: ${message}`, EXIT.corrupt);

const readFile = (path: string): ByteStream & { destroy(): void } =>
  createReadStream(path, { highWaterMark: IO_CHUNK_SIZE });

/** Passes bytes through unchanged, feeding each piece to `hash` on the way. */
async function* hashing(source: ByteStream, hash: Hash): AsyncGenerator<Uint8Array> {
  for await (const piece of source) {
    hash.update(piece);
    yield piece;
  }
}

export interface BundleInfo {
  /** SHA-256 of the bundle file. */
  sha256: string;
  /** Fingerprints of the recipients it is encrypted to. */
  recipients: string[];
}

/** Reads what a bundle shows without a key: its hash, and who can open it. */
export const inspectBundle = async (path: string): Promise<BundleInfo> => {
  const input = readFile(path);
  const hash = createHash('sha256');
  try {
    const reader = new ByteReader(hashing(input, hash));
    const head = await reader.fill(LFS_POINTER_PREFIX.length);
    if (head.toString('latin1').startsWith(LFS_POINTER_PREFIX)) throw new LfsPointerError(path);
    const header = await readFileHeader(reader);
    for await (const piece of reader.rest()) void piece;
    return { sha256: hash.digest('hex'), recipients: fileRecipients(header) };
  } finally {
    input.destroy();
  }
};

/** A file's bytes, with a check at the end that they are still the ones the manifest describes. */
async function* unchanged(file: SectionFile): AsyncGenerator<Uint8Array> {
  const hash = createHash('sha256');
  yield* hashing(readFile(file.source), hash);
  if (hash.digest('hex') !== file.sha256) {
    throw new CliError(`${file.source} changed while it was being encrypted; run the command again`);
  }
}

/** The archive's entries: the manifest first, then every file in manifest order. */
function* archiveEntries(snapshot: Snapshot): Generator<TarFile> {
  const manifest = serializeManifest(snapshot.manifest);
  yield { path: MANIFEST_PATH, size: manifest.length, executable: false, content: [manifest] };
  for (const file of snapshot.files) {
    yield { path: file.path, size: file.size, executable: file.executable, content: unchanged(file) };
  }
}

/**
 * Encrypts a section to `recipients` and replaces its bundle atomically. Resolves to the new
 * bundle's SHA-256. If a file changes underneath it, the old bundle is left as it was.
 */
export const encryptSection = async (
  section: Section,
  snapshot: Snapshot,
  recipients: string[]
): Promise<string> => {
  const { header, stream } = createRecipientFileEncryptor(recipients);
  const hash = createHash('sha256');
  try {
    const archive = transformBytes(writeTar(archiveEntries(snapshot)), stream);
    await writeFileAtomically(section.bundle, hashing(chainBytes([header], archive), hash));
  } finally {
    stream.destroy();
  }
  return hash.digest('hex');
};

const readManifest = async (entry: TarEntry): Promise<Manifest> => {
  if (entry.path !== MANIFEST_PATH) throw mismatch('it does not begin with one');
  if (entry.size > MAX_MANIFEST_SIZE) throw mismatch('the manifest is implausibly large');
  const pieces: Uint8Array[] = [];
  for await (const piece of entry.content) pieces.push(piece);
  return parseManifest(Buffer.concat(pieces));
};

/** Writes one archive entry to its place under `directory`, and checks it against the manifest. */
const writeEntry = async (directory: string, entry: TarEntry, expected: ManifestFile): Promise<void> => {
  const target = join(directory, ...expected.path.split('/'));
  const hash = createHash('sha256');
  const handle = await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    // "wx" refuses a name that is already there: two paths the file system considers the same.
    .then(() => open(target, 'wx', expected.executable ? 0o700 : 0o600))
    .catch((error: NodeJS.ErrnoException) => {
      throw new CliError(
        `cannot create "${expected.path}" (${error.code ?? 'error'}); two paths in the bundle may be the same on this file system`,
        EXIT.corrupt
      );
    });
  await pipeline(hashing(entry.content, hash), handle.createWriteStream());
  if (hash.digest('hex') !== expected.sha256) {
    throw mismatch(`"${expected.path}" does not have the content it lists`);
  }
};

/**
 * Writes an archive's files under `directory`, accepting exactly what the manifest lists, in the
 * order it lists it. Paths come from the manifest, which {@link parseManifest} has vetted.
 */
const extractArchive = async (entries: AsyncIterable<TarEntry>, directory: string): Promise<Manifest> => {
  let manifest: Manifest | undefined;
  let index = 0;
  for await (const entry of entries) {
    if (!manifest) {
      manifest = await readManifest(entry);
      continue;
    }
    const expected = manifest.files[index++];
    const listed =
      expected !== undefined &&
      entry.path === expected.path &&
      entry.size === expected.size &&
      entry.executable === expected.executable;
    if (!listed) throw mismatch(`"${entry.path}" is not the file it lists next`);
    await writeEntry(directory, entry, expected);
  }
  if (!manifest) throw mismatch('it is empty');
  if (index !== manifest.files.length) throw mismatch('files it lists are missing');
  return manifest;
};

/**
 * Forces an extracted folder to disk: every file, then every folder, before it may replace
 * anything. One pass at the end, not a sync as each file is closed: that waits for the device
 * once per file, milliseconds each, where this pass costs next to nothing after its first sync.
 */
const syncExtraction = async (directory: string, manifest: Manifest): Promise<void> => {
  const folders = new Set([directory]);
  for (const { path } of manifest.files) {
    const target = join(directory, ...path.split('/'));
    await syncFile(target);
    for (let folder = dirname(target); !folders.has(folder); folder = dirname(folder)) folders.add(folder);
  }
  for (const folder of folders) await syncDirectory(folder);
};

export interface Extraction {
  /** A new folder beside the section, holding the bundle's files. Not yet the section itself. */
  directory: string;
  manifest: Manifest;
  digest: string;
  /** SHA-256 of the bundle that was read. */
  bundle: string;
}

/**
 * Decrypts a bundle into a new folder beside the section's own, which is not touched.
 *
 * It resolves only once every chunk has authenticated, the ciphertext is known to be complete,
 * and every file matches the manifest. On any failure the new folder is removed and the error is
 * rethrown: there is no partial result.
 */
export const extractSection = async (section: Section, identity: Identity): Promise<Extraction> => {
  const directory = tempPathFor(section.directory);
  await mkdir(directory, { mode: 0o700 });
  trackTemp(directory);

  const input = readFile(section.bundle);
  const hash = createHash('sha256');
  let decryptor: StreamDecryptor | undefined;
  try {
    const reader = new ByteReader(hashing(input, hash));
    decryptor = createIdentityFileDecryptor(await readFileHeader(reader), identity);
    const archive = readTar(transformBytes(reader.rest(), decryptor));
    const manifest = await extractArchive(archive, directory);
    await syncExtraction(directory, manifest);
    return { directory, manifest, digest: digestOf(manifest), bundle: hash.digest('hex') };
  } catch (error) {
    discardTemp(directory);
    throw error;
  } finally {
    decryptor?.destroy();
    input.destroy();
  }
};

const setAsidePathFor = (directory: string): string =>
  join(dirname(directory), `.${basename(directory)}${REPLACED_MARKER}${randomBytes(6).toString('hex')}`);

/**
 * Makes an extracted folder the section's plaintext, replacing what was there.
 *
 * The two renames run back to back without returning to the event loop, so Ctrl-C cannot land
 * between them. If the machine dies there instead, the previous plaintext is still on disk under
 * its set-aside name, and {@link recoverSection} puts it back.
 */
export const installExtraction = async (section: Section, extraction: Extraction): Promise<void> => {
  const setAside = existsSync(section.directory) ? setAsidePathFor(section.directory) : undefined;
  if (setAside) renameSync(section.directory, setAside);
  try {
    renameSync(extraction.directory, section.directory);
  } catch (error) {
    if (setAside) renameSync(setAside, section.directory);
    discardTemp(extraction.directory);
    throw error;
  }
  untrackTemp(extraction.directory);
  // The swap is on disk before the old plaintext goes, and before anyone records it as done.
  await syncDirectory(dirname(section.directory));
  if (setAside) rmSync(setAside, { recursive: true, force: true });
};

/**
 * Cleans up after a run that was killed: restores a section's plaintext if it had been set aside
 * and nothing took its place, and removes half-written leftovers. Returns true if it restored.
 */
export const recoverSection = (section: Section): boolean => {
  const parent = dirname(section.directory);
  if (!existsSync(parent)) return false;
  const own = (name: string, target: string): boolean => name.startsWith(`.${basename(target)}.dcrypt-`);
  const names = readdirSync(parent);
  const setAside = names.filter((name) => own(name, section.directory) && name.includes(REPLACED_MARKER));
  const temporary = names.filter(
    (name) => isTempName(name) && (own(name, section.directory) || own(name, section.bundle))
  );

  const restored = !existsSync(section.directory) && setAside.length > 0;
  if (restored) renameSync(join(parent, setAside.shift() as string), section.directory);
  for (const name of [...setAside, ...temporary]) {
    rmSync(join(parent, name), { recursive: true, force: true });
  }
  return restored;
};
