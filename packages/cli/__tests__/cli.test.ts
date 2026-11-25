import { decryptFromString } from '@decryption/core';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { Inquirerer, parseArgv } from 'inquirerer';
import { tmpdir } from 'os';
import { join } from 'path';

import { dispatch, EXIT, options } from '../src';

// Argon2id in pure JavaScript is slow under jest even at the minimum cost, and several tests
// derive a handful of keys each.
jest.setTimeout(120000);

/** Armored envelopes are prefixed rather than PEM-wrapped. */
const ARMOR_PREFIX = 'dcrypt.v1.';

/** The weakest Argon2id costs the core still accepts — tests assert behaviour, not work factor. */
const FAST_KDF = 't=1,m=8192,p=1';

/**
 * The CLI is driven end to end here — every test goes through `dispatch`, the same entry point the
 * `dcrypt` bin uses, with a non-TTY prompter so nothing can hang waiting for input.
 */
let home: string;
let work: string;
let out: string[];
let errors: string[];

const prompter = () =>
  new Inquirerer({ noTty: true, useDefaults: true });

const run = async (line: string): Promise<number> => {
  // the same argv parsing options the `dcrypt` bin uses
  const argv = parseArgv(['node', 'dcrypt', ...line.split(' ').filter(Boolean)], options.minimistOpts);
  const p = prompter();
  try {
    return await dispatch(argv, p);
  } finally {
    p.close();
  }
};

/** The last thing written to stdout, trimmed. */
const stdout = (): string => out.join('').trim();

const file = (name: string, contents = ''): string => {
  const path = join(work, name);
  if (contents) writeFileSync(path, contents);
  return path;
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dcrypt-home-'));
  work = mkdtempSync(join(tmpdir(), 'dcrypt-work-'));
  process.env.APPSTASH_BASE_DIR = home;
  out = [];
  errors = [];
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    out.push(String(chunk));
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    errors.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.APPSTASH_BASE_DIR;
});

describe('dispatch', () => {
  it('prints usage for help', async () => {
    expect(await run('help')).toBe(0);
    expect(stdout()).toContain('dcrypt <command>');
  });

  it('rejects an unknown command with exit code 1', async () => {
    expect(await run('nope')).toBe(EXIT.usage);
    expect(errors.join('')).toContain('unknown command: nope');
  });

  it('prints per-command help', async () => {
    expect(await run('wallet --help')).toBe(0);
    expect(stdout()).toContain('Wallet Command');
  });

  it('rejects an unknown subcommand', async () => {
    expect(await run('wallet fly')).toBe(EXIT.usage);
    expect(errors.join('')).toContain('unknown wallet subcommand: fly');
  });
});

describe('wallet', () => {
  it('creates a mnemonic with addresses', async () => {
    expect(await run('wallet create --words 12 --network cosmoshub --network osmosis --json')).toBe(0);
    const result = JSON.parse(stdout());
    expect(result.mnemonic.split(' ')).toHaveLength(12);
    expect(result.accounts.map((a: { network: string }) => a.network)).toEqual([
      'cosmoshub',
      'osmosis',
    ]);
    expect(result.accounts[0].address).toMatch(/^cosmos1/);
    expect(result.accounts[1].address).toMatch(/^osmo1/);
    expect(result.accounts[0]).not.toHaveProperty('privateKey');
  });

  it('derives the documented address for a known mnemonic', async () => {
    const mnemonic = file(
      'mnemonic.txt',
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );
    expect(await run(`wallet address --in ${mnemonic} --network cosmoshub --json`)).toBe(0);
    expect(JSON.parse(stdout()).accounts[0].address).toBe(
      'cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4'
    );
  });

  it('rejects an invalid mnemonic', async () => {
    const mnemonic = file('bad.txt', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon');
    expect(await run(`wallet validate --in ${mnemonic}`)).toBe(EXIT.usage);
  });

  it('rejects an unsupported word count', async () => {
    expect(await run('wallet create --words 13')).toBe(EXIT.usage);
  });
});

describe('encrypt / decrypt', () => {
  const passphrase = () => file('pass.txt', 'correct horse battery staple');

  it('round trips through files', async () => {
    const plain = file('plain.txt', 'attack at dawn');
    const sealed = join(work, 'sealed.dcrypt');
    expect(
      await run(
        `encrypt --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
      )
    ).toBe(0);
    expect(readFileSync(sealed, 'utf8')).toContain(ARMOR_PREFIX);

    expect(await run(`decrypt --in ${sealed} --passphrase-file ${passphrase()}`)).toBe(0);
    expect(stdout()).toBe('attack at dawn');
  });

  it('exits 2 on a wrong passphrase', async () => {
    const plain = file('plain.txt', 'attack at dawn');
    const sealed = join(work, 'sealed.dcrypt');
    await run(
      `encrypt --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
    );
    const wrong = file('wrong.txt', 'hunter2');
    expect(await run(`decrypt --in ${sealed} --passphrase-file ${wrong}`)).toBe(EXIT.auth);
  });

  it('exits 3 on corrupt input', async () => {
    const junk = file('junk.txt', 'not an envelope');
    expect(await run(`decrypt --in ${junk} --passphrase-file ${passphrase()}`)).toBe(EXIT.corrupt);
  });

  it('refuses a passphrase passed in argv', async () => {
    const plain = file('plain.txt', 'attack at dawn');
    expect(await run(`encrypt --in ${plain} --passphrase hunter2`)).toBe(EXIT.usage);
    expect(errors.join('')).toContain('refusing to read a passphrase from argv');
  });

  it('rejects an unknown kdf profile', async () => {
    const plain = file('plain.txt', 'x');
    expect(await run(`encrypt --in ${plain} --kdf lightning --passphrase-file ${passphrase()}`)).toBe(
      EXIT.usage
    );
  });
});

describe('encrypt --binary / --recipient (the file format)', () => {
  const passphrase = () => file('pass.txt', 'correct horse battery staple');
  const identityPassphrase = () => file('identity-pass.txt', 'identity-passphrase');

  /** Deterministic filler: no real data, and not valid UTF-8, so a text path would corrupt it. */
  const pattern = (length: number): Buffer =>
    Buffer.from(Uint8Array.from({ length }, (_, i) => (i * 131 + (i >> 8) * 17 + 255) % 256));

  /** Creates an identity in a home directory of its own and returns its public recipient. */
  const newIdentity = async (): Promise<{ home: string; recipient: string }> => {
    const dir = mkdtempSync(join(tmpdir(), 'dcrypt-home-'));
    process.env.APPSTASH_BASE_DIR = dir;
    out = [];
    expect(
      await run(`keys generate --kdf ${FAST_KDF} --json --passphrase-file ${identityPassphrase()}`)
    ).toBe(0);
    const { recipient } = JSON.parse(stdout()) as { recipient: string };
    out = [];
    return { home: dir, recipient };
  };

  const leftovers = (): string[] => readdirSync(work).filter((name) => name.includes('dcrypt-tmp'));

  it('writes a binary envelope with a passphrase and restores the exact bytes', async () => {
    const data = pattern(1000);
    const plain = file('plain.bin');
    writeFileSync(plain, data);
    const sealed = join(work, 'plain.bin.dcrypt');
    expect(
      await run(
        `encrypt --binary --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
      )
    ).toBe(0);

    const envelope = readFileSync(sealed);
    expect(envelope.subarray(0, 6).toString('latin1')).toBe('DCRYPT');
    expect(envelope[6]).toBe(2);
    expect(envelope.includes(data.subarray(0, 32))).toBe(false);

    const restored = join(work, 'restored.bin');
    expect(await run(`decrypt --in ${sealed} --out ${restored} --passphrase-file ${passphrase()}`)).toBe(0);
    expect(readFileSync(restored).equals(data)).toBe(true);
    expect(statSync(restored).mode & 0o777).toBe(0o600);
    expect(leftovers()).toEqual([]);
  });

  it('streams a file of several chunks to a recipient without asking for a passphrase', async () => {
    const { recipient } = await newIdentity();
    const data = pattern(3 * 65536 + 4321);
    const plain = file('large.bin');
    writeFileSync(plain, data);
    const sealed = join(work, 'large.bin.dcrypt');

    // No passphrase source at all: encrypting to a public key must not need one.
    expect(await run(`encrypt --binary --recipient ${recipient} --in ${plain} --out ${sealed}`)).toBe(0);
    // header: 10 bytes, one 115-byte stanza, 32-byte MAC, 16-byte nonce; then four chunks.
    expect(statSync(sealed).size).toBe(10 + 115 + 32 + 16 + data.length + 4 * 16);

    const restored = join(work, 'large.restored');
    expect(
      await run(`decrypt --in ${sealed} --out ${restored} --passphrase-file ${identityPassphrase()}`)
    ).toBe(0);
    expect(readFileSync(restored).equals(data)).toBe(true);
  });

  it('writes the text form with --recipient alone', async () => {
    const { recipient } = await newIdentity();
    const sealed = join(work, 'note.dcrypt');
    expect(await run(`encrypt hello-team --recipient ${recipient} --out ${sealed}`)).toBe(0);
    expect(readFileSync(sealed, 'utf8')).toMatch(/^dcrypt\.v2\.[A-Za-z0-9+/=]+\n$/);

    expect(await run(`decrypt --in ${sealed} --passphrase-file ${identityPassphrase()}`)).toBe(0);
    expect(stdout()).toBe('hello-team');
  });

  it('keeps inline text as the input when --binary comes first', async () => {
    const sealed = join(work, 'inline.dcrypt');
    expect(
      await run(`encrypt --binary hello-team --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`)
    ).toBe(0);
    expect(await run(`decrypt --in ${sealed} --passphrase-file ${passphrase()}`)).toBe(0);
    expect(stdout()).toBe('hello-team');
  });

  it('encrypts to every key in a recipients file, and to nobody else', async () => {
    const ada = await newIdentity();
    const grace = await newIdentity();
    const outsider = await newIdentity();
    const recipients = file(
      'recipients.txt',
      [`# who can open the bundle`, `${ada.recipient}  ada (laptop)`, '', `${grace.recipient} recovery`, ''].join('\n')
    );
    const plain = file('plain.txt', 'the tuesday meeting moved to wednesday');
    const sealed = join(work, 'plain.dcrypt');
    expect(await run(`encrypt --binary --recipients-file ${recipients} --in ${plain} --out ${sealed}`)).toBe(0);

    for (const member of [ada, grace]) {
      process.env.APPSTASH_BASE_DIR = member.home;
      out = [];
      expect(await run(`decrypt --in ${sealed} --passphrase-file ${identityPassphrase()}`)).toBe(0);
      expect(stdout()).toBe('the tuesday meeting moved to wednesday');
    }

    process.env.APPSTASH_BASE_DIR = outsider.home;
    const target = join(work, 'outsider.txt');
    // Exit 5 without even reading a passphrase: the recipient list in the header is public.
    expect(await run(`decrypt --in ${sealed} --out ${target}`)).toBe(EXIT.permission);
    expect(errors.join('')).toContain('is not a recipient');
    expect(existsSync(target)).toBe(false);
  });

  it('exits 4 when a recipient file is opened on a machine with no identity', async () => {
    const { recipient } = await newIdentity();
    const sealed = join(work, 'note.dcrypt');
    await run(`encrypt hello --binary --recipient ${recipient} --out ${sealed}`);
    process.env.APPSTASH_BASE_DIR = home;
    expect(await run(`decrypt --in ${sealed} --passphrase-file ${identityPassphrase()}`)).toBe(EXIT.notFound);
  });

  it('rejects a malformed recipient', async () => {
    expect(await run(`encrypt hello --recipient dcrypt1notakey`)).toBe(EXIT.usage);
    const recipients = file('recipients.txt', '# team\nnot-a-key ada\n');
    expect(await run(`encrypt hello --recipients-file ${recipients}`)).toBe(EXIT.usage);
    expect(errors.join('')).toContain('recipients.txt:2');
  });

  it('never replaces the output on a wrong passphrase', async () => {
    const plain = file('plain.txt', 'attack at dawn');
    const sealed = join(work, 'sealed.dcrypt');
    await run(
      `encrypt --binary --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
    );
    const wrong = file('wrong.txt', 'hunter2');

    const fresh = join(work, 'fresh.txt');
    expect(await run(`decrypt --in ${sealed} --out ${fresh} --passphrase-file ${wrong}`)).toBe(EXIT.auth);
    expect(existsSync(fresh)).toBe(false);

    const existing = file('existing.txt', 'work in progress, do not lose');
    expect(await run(`decrypt --in ${sealed} --out ${existing} --passphrase-file ${wrong}`)).toBe(EXIT.auth);
    expect(readFileSync(existing, 'utf8')).toBe('work in progress, do not lose');
    expect(leftovers()).toEqual([]);
  });

  it('exits 2 on a wrong identity passphrase', async () => {
    const { recipient } = await newIdentity();
    const sealed = join(work, 'note.dcrypt');
    await run(`encrypt hello --binary --recipient ${recipient} --out ${sealed}`);
    const wrong = file('wrong.txt', 'hunter2');
    expect(await run(`decrypt --in ${sealed} --passphrase-file ${wrong}`)).toBe(EXIT.auth);
  });

  it('never leaves a partial file when the envelope is truncated or modified', async () => {
    const data = pattern(2 * 65536 + 100);
    const plain = file('plain.bin');
    writeFileSync(plain, data);
    const sealed = join(work, 'sealed.dcrypt');
    await run(
      `encrypt --binary --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
    );
    const envelope = readFileSync(sealed);
    const existing = file('existing.bin', 'work in progress, do not lose');

    const damaged: Record<string, Buffer> = {
      // the last chunk is missing: the first two authenticate, the file as a whole must not
      'cut-at-chunk-boundary': envelope.subarray(0, envelope.length - 116),
      'cut-in-header': envelope.subarray(0, 40),
      'flipped-in-first-chunk': Buffer.from(envelope).fill(envelope[300] ^ 0x01, 300, 301),
      // the stanza count: caught by the header MAC or by the parser, never accepted
      'flipped-in-header': Buffer.from(envelope).fill(envelope[9] ^ 0x02, 9, 10),
      appended: Buffer.concat([envelope, Buffer.from('extra')]),
    };
    for (const [name, bytes] of Object.entries(damaged)) {
      const path = join(work, `${name}.dcrypt`);
      writeFileSync(path, bytes);
      const code = await run(`decrypt --in ${path} --out ${existing} --passphrase-file ${passphrase()}`);
      expect([name, code]).toEqual([name, EXIT.corrupt]);
      expect(readFileSync(existing, 'utf8')).toBe('work in progress, do not lose');
    }
    expect(leftovers()).toEqual([]);

    // The undamaged file still replaces it, in one step.
    expect(await run(`decrypt --in ${sealed} --out ${existing} --passphrase-file ${passphrase()}`)).toBe(0);
    expect(readFileSync(existing).equals(data)).toBe(true);
  });

  it('refuses to print binary ciphertext to a terminal', async () => {
    const plain = file('plain.txt', 'attack at dawn');
    const original = process.stdout.isTTY;
    process.stdout.isTTY = true;
    try {
      expect(
        await run(`encrypt --binary --in ${plain} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`)
      ).toBe(EXIT.usage);
    } finally {
      process.stdout.isTTY = original;
    }
    expect(errors.join('')).toContain('refusing to write binary ciphertext to a terminal');
  });

  it('refuses to print binary plaintext to a terminal, and prints text', async () => {
    const seal = async (name: string, contents: string | Uint8Array): Promise<string> => {
      const plain = file(name);
      writeFileSync(plain, contents);
      expect(
        await run(
          `encrypt --binary --in ${plain} --out ${plain}.dcrypt --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
        )
      ).toBe(0);
      return `${plain}.dcrypt`;
    };
    const reveal = (sealed: string): Promise<number> =>
      run(`decrypt --in ${sealed} --passphrase-file ${passphrase()}`);

    // What is not text, and the text before it: the most a terminal may be shown.
    const euro = Buffer.from('\u20ac');
    const binary: [sealed: string, shown: string][] = [
      [await seal('any.bin', pattern(1000)), ''],
      [await seal('not-utf8.bin', Uint8Array.of(0xff, 0xfe, 0x41)), ''],
      [await seal('zero.bin', Buffer.from('caf\0')), ''],
      [await seal('cut-short.bin', Buffer.concat([Buffer.from('caf'), euro.subarray(0, 2)])), 'caf'],
      // The unfinished character begins in one chunk and goes on into the next.
      [await seal('straddling.bin', Buffer.concat([Buffer.alloc(65_535, 'a'), euro.subarray(0, 2)])), 'a'.repeat(65_535)],
    ];
    const text = await seal('plain.txt', 'attack at dawn \u2014 caf\u00e9\n');
    // Text longer than a chunk, of two-byte and of four-byte characters, begun at every offset:
    // whichever character meets the end of the first chunk is split there at each possible place.
    const long = [await seal('accents.txt', `a${'\u00e9'.repeat(40_000)}\n`)];
    for (const lead of ['', 'a', 'aa', 'aaa']) {
      long.push(await seal(`faces-${lead.length}.txt`, `${lead}${'\u{1f600}'.repeat(20_000)}\n`));
    }

    const original = process.stdout.isTTY;
    process.stdout.isTTY = true;
    try {
      for (const [sealed, shown] of binary) {
        out.length = 0;
        errors.length = 0;
        expect(await reveal(sealed)).toBe(EXIT.usage);
        expect(errors.join('')).toContain('refusing to write binary data to a terminal');
        expect(out.join('')).toBe(shown);
      }
      out.length = 0;

      expect(await reveal(text)).toBe(0);
      expect(stdout()).toBe('attack at dawn \u2014 caf\u00e9');
      for (const sealed of long) expect(await reveal(sealed)).toBe(0);
    } finally {
      process.stdout.isTTY = original;
    }
  });

  it('gives back the armored envelope byte for byte, and ends the line only on a terminal', async () => {
    const sealed = join(work, 'sealed.dcrypt');
    const restored = join(work, 'restored');
    const seal = async (contents: Uint8Array): Promise<void> => {
      const plain = file('plain');
      writeFileSync(plain, contents);
      expect(
        await run(`encrypt --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`)
      ).toBe(0);
    };
    const reveal = (to = ''): Promise<number> => run(`decrypt --in ${sealed} ${to} --passphrase-file ${passphrase()}`);

    // Not text, and no newline at its end: nothing is replaced, and nothing is added.
    const binary = pattern(300);
    await seal(binary);
    expect(await reveal(`--out ${restored}`)).toBe(0);
    expect(readFileSync(restored).equals(binary)).toBe(true);

    const text = Buffer.from('attack at dawn');
    await seal(text);
    out.length = 0;
    expect(await reveal()).toBe(0);
    expect(out.join('')).toBe('attack at dawn');

    const original = process.stdout.isTTY;
    process.stdout.isTTY = true;
    try {
      out.length = 0;
      expect(await reveal()).toBe(0);
      expect(out.join('')).toBe('attack at dawn\n');

      await seal(binary);
      out.length = 0;
      expect(await reveal()).toBe(EXIT.usage);
      expect(errors.join('')).toContain('refusing to write binary data to a terminal');
      expect(out).toEqual([]);
    } finally {
      process.stdout.isTTY = original;
    }
  });

  it('replaces --out by rename for the armored forms too', async () => {
    const plain = file('plain.txt', 'attack at dawn');
    const sealed = file('sealed.dcrypt', 'something that was here before');
    const restored = file('restored.txt', 'something that was here before');
    const inodes = { sealed: statSync(sealed).ino, restored: statSync(restored).ino };

    expect(
      await run(`encrypt --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`)
    ).toBe(0);
    expect(readFileSync(sealed, 'utf8')).toMatch(/^dcrypt\.v1\..+\n$/);
    expect(await run(`decrypt --in ${sealed} --out ${restored} --passphrase-file ${passphrase()}`)).toBe(0);
    expect(readFileSync(restored, 'utf8')).toBe('attack at dawn');

    // A new file took each one's place: neither was truncated and written into.
    expect(statSync(sealed).ino).not.toBe(inodes.sealed);
    expect(statSync(restored).ino).not.toBe(inodes.restored);
    expect(statSync(restored).mode & 0o777).toBe(0o600);
    expect(leftovers()).toEqual([]);
  });

  it('rejects --aad, which the file format does not carry', async () => {
    const plain = file('plain.txt', 'attack at dawn');
    const sealed = join(work, 'sealed.dcrypt');
    expect(
      await run(
        `encrypt --binary --aad invoice --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
      )
    ).toBe(EXIT.usage);
    expect(existsSync(sealed)).toBe(false);

    await run(
      `encrypt --binary --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
    );
    expect(
      await run(`decrypt --aad invoice --in ${sealed} --passphrase-file ${passphrase()}`)
    ).toBe(EXIT.usage);
  });

  it('still opens the armored envelope with associated data', async () => {
    const plain = file('plain.txt', 'attack at dawn');
    const sealed = join(work, 'sealed.dcrypt');
    await run(
      `encrypt --aad invoice --in ${plain} --out ${sealed} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`
    );
    expect(await run(`decrypt --aad invoice --in ${sealed} --passphrase-file ${passphrase()}`)).toBe(0);
    expect(stdout()).toBe('attack at dawn');
    expect(await run(`decrypt --aad receipt --in ${sealed} --passphrase-file ${passphrase()}`)).toBe(EXIT.auth);
  });

  it('prints help instead of waiting for input', async () => {
    expect(await run('encrypt --help')).toBe(0);
    expect(stdout()).toContain('--recipient <key>');
    out = [];
    expect(await run('decrypt --help')).toBe(0);
    expect(stdout()).toContain('renamed into');
  });
});

describe('shamir', () => {
  it('splits and recombines', async () => {
    const secret = file('secret.txt', 'the-secret');
    expect(await run(`shamir split --in ${secret} --shares 5 --threshold 3 --json`)).toBe(0);
    const { shares } = JSON.parse(stdout()) as { shares: string[] };
    expect(shares).toHaveLength(5);

    out = [];
    const chosen = [shares[4], shares[1], shares[2]].map((s) => `--share ${s}`).join(' ');
    expect(await run(`shamir combine ${chosen}`)).toBe(0);
    expect(stdout()).toBe('the-secret');
  });

  it('fails loudly on a corrupted share', async () => {
    const secret = file('secret.txt', 'the-secret');
    await run(`shamir split --in ${secret} --shares 3 --threshold 2 --json`);
    const { shares } = JSON.parse(stdout()) as { shares: string[] };
    const broken = `${shares[0].slice(0, -4)}AAAA`;
    out = [];
    expect(await run(`shamir combine --share ${broken} --share ${shares[1]}`)).not.toBe(0);
  });
});

describe('keys and keychain', () => {
  const passphrase = () => file('pass.txt', 'identity-passphrase');

  it('generates an identity, stores it encrypted, and never prints the private key', async () => {
    expect(await run(`keys generate --kdf ${FAST_KDF} --json --passphrase-file ${passphrase()}`)).toBe(0);
    const { recipient } = JSON.parse(stdout()) as { recipient: string };
    expect(recipient).toMatch(/^dcrypt1/);

    const stored = JSON.parse(readFileSync(join(home, '.dcrypt/config/identity.json'), 'utf8'));
    expect(stored.encrypted).toContain(ARMOR_PREFIX);
    expect(JSON.stringify(stored)).not.toContain('dcryptsec');

    out = [];
    expect(await run(`keys verify --json --passphrase-file ${passphrase()}`)).toBe(0);
    expect(JSON.parse(stdout()).recipient).toBe(recipient);
  });

  it('refuses to overwrite an identity without --force', async () => {
    await run(`keys generate --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`);
    expect(await run(`keys generate --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`)).toBe(
      EXIT.usage
    );
  });

  it('stores keychain entries as ciphertext only', async () => {
    const value = file('token.txt', 'ghp_supersecret');
    expect(
      await run(`keychain set github --in ${value} --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`)
    ).toBe(0);
    const keychain = readFileSync(join(home, '.dcrypt/data/keychain.json'), 'utf8');
    expect(keychain).not.toContain('ghp_supersecret');
    expect(JSON.parse(keychain).entries.github).toContain(ARMOR_PREFIX);

    out = [];
    expect(await run(`keychain get github --passphrase-file ${passphrase()}`)).toBe(0);
    expect(stdout()).toBe('ghp_supersecret');

    out = [];
    expect(await run(`keychain list --json`)).toBe(0);
    expect(JSON.parse(stdout()).entries).toEqual(['github']);

    expect(await run(`keychain del github`)).toBe(0);
    expect(await run(`keychain get missing --passphrase-file ${passphrase()}`)).toBe(EXIT.notFound);
  });
});

describe('salt', () => {
  it('wraps the data key under the passphrase and back', async () => {
    const pass = file('pass.txt', 'two-layer');
    const plain = file('plain.txt', 'wrapped payload');
    const sealed = join(work, 'sealed.dcrypt');
    const saltFile = join(work, 'sealed.salt');
    expect(
      await run(
        `salt encrypt --in ${plain} --out ${sealed} --salt-file ${saltFile} --kdf ${FAST_KDF} --passphrase-file ${pass}`
      )
    ).toBe(0);
    expect(readFileSync(saltFile, 'utf8')).not.toContain('wrapped payload');

    out = [];
    expect(
      await run(`salt decrypt --in ${sealed} --salt-file ${saltFile} --passphrase-file ${pass}`)
    ).toBe(0);
    expect(stdout()).toBe('wrapped payload');
  });

  it('generates a salt of the requested size', async () => {
    expect(await run('salt generate --bytes 16 --json')).toBe(0);
    expect(Buffer.from(JSON.parse(stdout()).salt, 'base64')).toHaveLength(16);
  });
});

describe('cosmology', () => {
  // Produced by @cosmology/core: crypt('my-salt', 'legacy plaintext').
  const legacyBlob =
    'U2FsdGVkX1+e1rSKneHnXFk1ufVWBgAjucz2FBFi5Qxzkuhk6KCkZF+naLOt+APM';

  it('decrypts an old cryptojs blob and upgrades it', async () => {
    const blob = file('old.txt', legacyBlob);
    const salt = file('salt.txt', 'my-salt');
    expect(await run(`cosmology decrypt --in ${blob} --salt-file ${salt}`)).toBe(0);
    expect(stdout()).toBe('legacy plaintext');

    out = [];
    const pass = file('pass.txt', 'modern');
    const upgraded = join(work, 'new.dcrypt');
    expect(
      await run(
        `cosmology upgrade --in ${blob} --salt-file ${salt} --out ${upgraded} --kdf ${FAST_KDF} --passphrase-file ${pass}`
      )
    ).toBe(0);
    expect(decryptFromString(readFileSync(upgraded, 'utf8').trim(), 'modern')).toBe(
      'legacy plaintext'
    );
  });

  it('encrypts in the old format and reads it back', async () => {
    const plain = file('plain.txt', 'legacy plaintext');
    const salt = file('salt.txt', 'my-salt');
    const blob = join(work, 'old.txt');
    expect(await run(`cosmology encrypt --in ${plain} --salt-file ${salt} --out ${blob}`)).toBe(0);

    out = [];
    expect(await run(`cosmology decrypt --in ${blob} --salt-file ${salt}`)).toBe(0);
    expect(stdout()).toBe('legacy plaintext');
  });

  it('reads the salt from SALT, like the cosmology CLI', async () => {
    const blob = file('old.txt', legacyBlob);
    process.env.SALT = 'my-salt';
    try {
      expect(await run(`cosmology decrypt --in ${blob}`)).toBe(0);
      expect(stdout()).toBe('legacy plaintext');
    } finally {
      delete process.env.SALT;
    }
  });
});

describe('environment variables', () => {
  it('reads the passphrase from DCRYPT_PASSPHRASE', async () => {
    const plain = file('plain.txt', 'env secret');
    const encrypted = join(work, 'secret.dcrypt');
    process.env.DCRYPT_PASSPHRASE = 'from-the-environment';
    try {
      expect(await run(`encrypt --in ${plain} --out ${encrypted} --kdf ${FAST_KDF}`)).toBe(0);
      expect(await run(`decrypt --in ${encrypted}`)).toBe(0);
      expect(stdout()).toBe('env secret');
    } finally {
      delete process.env.DCRYPT_PASSPHRASE;
    }
  });

  it('reads the mnemonic from MNEMONIC, like the cosmology CLI', async () => {
    process.env.MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    try {
      expect(await run('wallet validate --json')).toBe(0);
      expect(JSON.parse(stdout()).valid).toBe(true);
    } finally {
      delete process.env.MNEMONIC;
    }
  });

  it('namespaces the keychain with KEYCHAIN_ACCOUNT, like the cosmology CLI', async () => {
    const pass = file('pass.txt', 'kc-pass');
    const value = file('value.txt', 'namespaced');
    process.env.KEYCHAIN_ACCOUNT = 'work';
    try {
      expect(
        await run(`keychain set token --in ${value} --kdf ${FAST_KDF} --passphrase-file ${pass}`)
      ).toBe(0);
      expect(existsSync(join(home, '.dcrypt', 'data', 'keychain-work.json'))).toBe(true);
    } finally {
      delete process.env.KEYCHAIN_ACCOUNT;
    }
    out = [];
    // Without the namespace, the entry is invisible.
    expect(await run('keychain list')).toBe(0);
    expect(stdout()).toBe('');
  });
});

describe('wallet defaults', () => {
  it('derives bitcoin when no network is named', async () => {
    expect(await run('wallet create --words 12 --json')).toBe(0);
    const { accounts } = JSON.parse(stdout());
    expect(accounts).toHaveLength(1);
    expect(accounts[0].network).toBe('bitcoin');
    expect(accounts[0].address.startsWith('bc1')).toBe(true);
  });
});

describe('secrets', () => {
  const passphrase = () => file('pass.txt', 'identity-passphrase');

  const withIdentity = async (): Promise<void> => {
    await run(`keys generate --kdf ${FAST_KDF} --passphrase-file ${passphrase()}`);
    out = [];
  };

  it('runs the whole team-secrets flow', async () => {
    await withIdentity();
    const vault = join(work, 'vault.json');

    expect(await run(`secrets init --file ${vault}`)).toBe(0);
    expect(existsSync(vault)).toBe(true);

    const value = file('db.txt', 'postgres://localhost/app');
    expect(
      await run(`secrets set DATABASE_URL --file ${vault} --in ${value} --passphrase-file ${passphrase()}`)
    ).toBe(0);
    expect(readFileSync(vault, 'utf8')).not.toContain('postgres://');

    out = [];
    expect(await run(`secrets list --file ${vault} --json`)).toBe(0);
    expect(JSON.parse(stdout()).secrets).toEqual(['DATABASE_URL']);

    out = [];
    expect(
      await run(`secrets get DATABASE_URL --file ${vault} --passphrase-file ${passphrase()}`)
    ).toBe(0);
    expect(stdout()).toBe('postgres://localhost/app');

    out = [];
    expect(
      await run(`secrets export --file ${vault} --format dotenv --passphrase-file ${passphrase()}`)
    ).toBe(0);
    expect(stdout()).toBe('DATABASE_URL=postgres://localhost/app');

    expect(await run(`secrets rm DATABASE_URL --file ${vault}`)).toBe(0);
    out = [];
    expect(await run(`secrets list --file ${vault} --json`)).toBe(0);
    expect(JSON.parse(stdout()).secrets).toEqual([]);
  });

  it('adds a recipient and rekeys', async () => {
    await withIdentity();
    const vault = join(work, 'vault.json');
    await run(`secrets init --file ${vault}`);

    // A second identity, standing in for a teammate.
    const otherHome = mkdtempSync(join(tmpdir(), 'dcrypt-other-'));
    process.env.APPSTASH_BASE_DIR = otherHome;
    const otherPass = file('other.txt', 'teammate');
    out = [];
    await run(`keys generate --kdf ${FAST_KDF} --json --passphrase-file ${otherPass}`);
    const teammate = JSON.parse(stdout()).recipient as string;
    process.env.APPSTASH_BASE_DIR = home;

    out = [];
    expect(
      await run(
        `secrets add-recipient --file ${vault} --label ada --recipient ${teammate} --passphrase-file ${passphrase()}`
      )
    ).toBe(0);
    out = [];
    expect(await run(`secrets recipients --file ${vault} --json`)).toBe(0);
    const labels = JSON.parse(stdout()).recipients.map((r: { label: string }) => r.label);
    expect(labels).toEqual(expect.arrayContaining(['me', 'ada']));

    expect(
      await run(`secrets rm-recipient ada --file ${vault} --passphrase-file ${passphrase()}`)
    ).toBe(0);
    out = [];
    await run(`secrets recipients --file ${vault} --json`);
    expect(JSON.parse(stdout()).recipients).toHaveLength(1);
  });

  it('reports a missing vault as not found', async () => {
    await withIdentity();
    expect(await run(`secrets list --file ${join(work, 'nope.json')}`)).toBe(EXIT.notFound);
  });
});
