import { createWriteStream, readFileSync, realpathSync, Stats, statSync } from 'fs';
import { open, rename } from 'fs/promises';
import { ParsedArgs } from 'minimist';
import { dirname, resolve } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { CliError, EXIT } from './errors';
import { discardTemp, tempPathFor, trackTemp, untrackTemp } from './temp';

/**
 * Byte-level input and output for commands that must not hold a whole file in memory.
 *
 * Everything here is a stream of byte pieces with backpressure: input is a Node `Readable`,
 * transforms are async generators, and output goes through `stream.pipeline`. File output is
 * written to a temporary sibling and renamed over the destination only once every byte has been
 * written and synced. That is what keeps a wrong passphrase, a truncated download or an
 * interrupt from replacing a good file with a partial one.
 */
export const IO_CHUNK_SIZE = 64 * 1024;

/** Pieces of a byte sequence, in order: an array of buffers, a generator, a `Readable`. */
export type ByteStream = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;

export interface ByteInput {
  /** True when the bytes come from stdin, which then cannot also carry a passphrase. */
  readonly stdin: boolean;
  readonly stream: Readable;
  /** Releases the input. Safe to call at any point, and more than once. */
  close(): void;
}

const memoryInput = (bytes: Uint8Array, stdin = false): ByteInput => ({
  stdin,
  stream: Readable.from([bytes]),
  close() {},
});

const fileInput = async (path: string): Promise<ByteInput> => {
  const unreadable = () => new CliError(`cannot read ${path}`, EXIT.notFound);
  const handle = await open(path, 'r').catch(() => {
    throw unreadable();
  });
  if ((await handle.stat()).isDirectory()) {
    await handle.close();
    throw unreadable();
  }
  // The stream owns the handle from here on: it is closed when the stream ends or is destroyed.
  const stream = handle.createReadStream({ highWaterMark: IO_CHUNK_SIZE });
  return { stdin: false, stream, close: () => void stream.destroy() };
};

/**
 * stdin as a byte stream.
 *
 * Nothing else may read stdin while it carries the input, which is why the entry point keeps the
 * prompter off a stdin that is not a terminal. A terminal is shared with the prompter, so what
 * is typed there is read in one blocking pass, before control returns to the event loop.
 */
const stdinInput = (): ByteInput => {
  if (!process.stdin.isTTY) {
    return { stdin: true, stream: process.stdin, close: () => void process.stdin.pause() };
  }
  try {
    return memoryInput(readFileSync(0), true);
  } catch {
    throw new CliError('failed to read stdin');
  }
};

/**
 * Opens the command's input as bytes: `--in <file>`, `-` (stdin), the inline value, then piped
 * stdin — the same order as `readInput`.
 */
export const openInput = async (argv: ParsedArgs, inline?: string): Promise<ByteInput> => {
  if (typeof argv.in === 'string' && argv.in.length) {
    return argv.in === '-' ? stdinInput() : fileInput(argv.in);
  }
  if (inline === '-' || argv.stdin) return stdinInput();
  if (inline !== undefined && inline !== '') return memoryInput(Buffer.from(String(inline), 'utf8'));
  if (!process.stdin.isTTY) return stdinInput();
  throw new CliError('no input: pass a value, --in <file>, or pipe on stdin');
};

/** stdin can carry the data or the passphrase, never both. */
export const assertStdinFree = (argv: ParsedArgs, input: ByteInput): void => {
  if (input.stdin && (argv['passphrase-stdin'] || argv.passphraseStdin)) {
    throw new CliError(
      'stdin cannot carry both the input and the passphrase; use --in <file> or --passphrase-file <path>'
    );
  }
};

const NO_BYTES = Buffer.alloc(0);

const asBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);

/**
 * Reads the front of a byte stream, then hands on whatever was not consumed.
 *
 * A command has to look at the first bytes of its input to know what it was given, and a header
 * has no fixed length. This buffers only as much as it is asked for; {@link ByteReader.rest}
 * streams the remainder untouched.
 */
export class ByteReader {
  private readonly pieces: Iterator<Uint8Array> | AsyncIterator<Uint8Array>;
  private held: Buffer = NO_BYTES;

  constructor(source: ByteStream) {
    this.pieces =
      Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  }

  /** What has been read from the stream and not yet consumed. */
  get buffered(): Buffer {
    return this.held;
  }

  /** Buffers one more piece. Resolves to false once the stream has ended. */
  async more(): Promise<boolean> {
    const next = await this.pieces.next();
    if (next.done) return false;
    this.held = this.held.length ? Buffer.concat([this.held, next.value]) : asBuffer(next.value);
    return true;
  }

  /** Buffers until at least `length` bytes are held, or the stream ends, and returns them. */
  async fill(length: number): Promise<Buffer> {
    while (this.held.length < length && (await this.more()));
    return this.held;
  }

  /** Drops `length` bytes from the front of the buffer. */
  skip(length: number): void {
    this.held = this.held.subarray(length);
  }

  /** Reads everything that is left into memory. For inputs that are small by construction. */
  async all(): Promise<Buffer> {
    while (await this.more());
    const everything = this.held;
    this.held = NO_BYTES;
    return everything;
  }

  /** Everything that is left, as a stream: the buffered bytes, then the rest of the source. */
  async *rest(): AsyncGenerator<Uint8Array> {
    if (this.held.length) {
      const head = this.held;
      this.held = NO_BYTES;
      yield head;
    }
    for (let next = await this.pieces.next(); !next.done; next = await this.pieces.next()) {
      yield next.value;
    }
  }
}

/** A chunked cipher: update() for each piece, finish() once. The shape of core's stream classes. */
export interface ByteTransform {
  update(data: Uint8Array): Uint8Array;
  finish(): Uint8Array;
}

/** Runs `source` through `transform`, one piece at a time. */
export async function* transformBytes(
  source: ByteStream,
  transform: ByteTransform
): AsyncGenerator<Uint8Array> {
  for await (const piece of source) {
    const output = transform.update(piece);
    if (output.length) yield output;
  }
  yield transform.finish();
}

/** Node streams speak Buffer: a bare Uint8Array reads as a list of numbers to anything that inspects a chunk. */
async function* asBuffers(source: ByteStream): AsyncGenerator<Buffer> {
  for await (const piece of source) yield asBuffer(piece);
}

/** Joins byte streams end to end. */
export async function* chainBytes(...sources: ByteStream[]): AsyncGenerator<Uint8Array> {
  for (const source of sources) yield* source;
}

const statOrUndefined = (path: string): Stats | undefined => {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
};

const sync = async (path: string, flags: string): Promise<void> => {
  const handle = await open(path, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

/** Forces a file that has already been written to disk. */
export const syncFile = (path: string): Promise<void> => sync(path, 'r+');

/** Best effort: makes a rename durable. Not every platform can fsync a directory. */
export const syncDirectory = async (path: string): Promise<void> => {
  try {
    await sync(path, 'r');
  } catch {
    // ignored on purpose
  }
};

/**
 * Writes `path` atomically. The bytes go to a temporary file in the same directory, created
 * owner-only; once all of them are written and synced it is renamed over `path`. If `bytes`
 * fails part-way, or the process is interrupted, `path` is left exactly as it was.
 */
export const writeFileAtomically = async (path: string, bytes: ByteStream): Promise<void> => {
  const existing = statOrUndefined(path);
  if (existing?.isDirectory()) throw new CliError(`cannot write ${path}: it is a directory`);
  if (existing && !existing.isFile()) {
    // A pipe, device or other special file: there is nothing to rename over, so write straight in.
    await pipeline(bytes, createWriteStream(path));
    return;
  }

  // Write through a symlink, as a plain overwrite would, instead of replacing the link.
  const target = existing ? realpathSync(path) : resolve(path);
  const temp = tempPathFor(target);
  const handle = await open(temp, 'wx', 0o600).catch(() => {
    throw new CliError(`cannot write ${path}`);
  });
  trackTemp(temp);
  try {
    // The stream owns the handle: `flush` syncs the file to disk before the handle is closed, and
    // pipeline() only resolves after that, so the rename never exposes bytes that are not there.
    await pipeline(bytes, handle.createWriteStream({ flush: true }));
    await rename(temp, target);
  } catch (error) {
    discardTemp(temp);
    throw error;
  }
  untrackTemp(temp);
  await syncDirectory(dirname(target));
};

export interface OutputOptions {
  /** Refuse to write to a terminal: the output is binary. */
  binary?: boolean;
}

const outputFile = (argv: ParsedArgs): string | undefined =>
  typeof argv.out === 'string' && argv.out.length && argv.out !== '-' ? argv.out : undefined;

/** Fails, before any prompt, when binary output would land on a terminal. */
export const assertNotTerminal = (argv: ParsedArgs, options: OutputOptions): void => {
  if (options.binary && outputFile(argv) === undefined && process.stdout.isTTY) {
    throw new CliError(
      'refusing to write binary ciphertext to a terminal; use --out <file> or redirect stdout'
    );
  }
};

/** Passes text through, and stops at a NUL byte: the sign of data a terminal should not be sent. */
async function* textOnly(bytes: ByteStream): AsyncGenerator<Uint8Array> {
  for await (const piece of bytes) {
    if (piece.includes(0)) {
      throw new CliError('refusing to write binary data to a terminal; use --out <file> or redirect stdout');
    }
    yield piece;
  }
}

/** Writes `bytes` to `--out <file>` when given (atomically), otherwise to stdout. */
export const writeBytes = async (
  argv: ParsedArgs,
  bytes: ByteStream,
  options: OutputOptions = {}
): Promise<void> => {
  const path = outputFile(argv);
  if (path !== undefined) {
    await writeFileAtomically(path, bytes);
    return;
  }
  assertNotTerminal(argv, options);
  // stdout belongs to the process: it is written to, never ended.
  await pipeline(asBuffers(process.stdout.isTTY ? textOnly(bytes) : bytes), process.stdout, { end: false });
};

/** Writes text the way {@link writeBytes} writes bytes, ending it with a newline. */
export const writeText = (argv: ParsedArgs, text: string): Promise<void> =>
  writeBytes(argv, [Buffer.from(text.endsWith('\n') ? text : `${text}\n`, 'utf8')]);
