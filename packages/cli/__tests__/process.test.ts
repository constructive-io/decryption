import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The real process, with real pipes. Everything else in this package drives `dispatch` in-process,
 * which cannot show what happens when stdin carries the data: the prompter and the command are
 * then two readers of one descriptor, and only the entry point decides who gets it.
 */
jest.setTimeout(120000);

const FAST_KDF = 't=1,m=8192,p=1';
const ENTRY = join(__dirname, '..', 'src', 'index.ts');

let home: string;
let work: string;

const dcrypt = (args: string[], input?: Buffer) =>
  spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', ENTRY, ...args], {
    cwd: join(__dirname, '..'),
    input: input ?? Buffer.alloc(0),
    env: { ...process.env, NODE_OPTIONS: '', APPSTASH_BASE_DIR: home },
    maxBuffer: 64 * 1024 * 1024,
  });

const secretFile = (name: string, contents: string): string => {
  const path = join(work, name);
  writeFileSync(path, contents);
  return path;
};

/** Several chunks of bytes that are easy to tell apart when one goes missing. */
const pattern = (length: number): Buffer => Buffer.from(Array.from({ length }, (_, i) => (i * 31 + (i >> 8)) & 0xff));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dcrypt-home-'));
  work = mkdtempSync(join(tmpdir(), 'dcrypt-work-'));
});

describe('dcrypt over pipes', () => {
  it('encrypts to a recipient and decrypts again, stdin to stdout, without losing a byte', () => {
    const unlock = secretFile('identity-passphrase', 'a fictional identity passphrase');
    const generated = dcrypt(['keys', 'generate', '--json', '--kdf', FAST_KDF, '--passphrase-file', unlock]);
    expect(generated.stderr.toString()).toBe('');
    const { recipient } = JSON.parse(generated.stdout.toString());

    const data = pattern(5 * 65536 + 123);
    const sealed = dcrypt(['encrypt', '--binary', '--recipient', recipient, '--in', '-'], data);
    expect(sealed.status).toBe(0);
    expect(sealed.stdout.length).toBeGreaterThan(data.length);

    const opened = dcrypt(['decrypt', '--in', '-', '--passphrase-file', unlock], sealed.stdout);
    expect(opened.stderr.toString()).toBe('');
    expect(opened.stdout.equals(data)).toBe(true);
  });

  it('does the same with a passphrase', () => {
    const passphrase = secretFile('passphrase', 'correct horse battery staple');
    const data = pattern(2 * 65536 + 7);
    const sealed = dcrypt(
      ['encrypt', '--binary', '--kdf', FAST_KDF, '--passphrase-file', passphrase],
      data
    );
    expect(sealed.status).toBe(0);

    const opened = dcrypt(['decrypt', '--passphrase-file', passphrase], sealed.stdout);
    expect(opened.status).toBe(0);
    expect(opened.stdout.equals(data)).toBe(true);
  });

  it('never prompts on a stdin that is not a terminal, and never reads the data as the answer', () => {
    const result = dcrypt(['encrypt', '--binary', '--in', '-'], Buffer.from('not a passphrase\n'));
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain('stdin is not a terminal');
    expect(result.stdout.length).toBe(0);
  });
});
