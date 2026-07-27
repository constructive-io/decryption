import { decryptFromString } from '@decryption/core';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { Inquirerer, parseArgv } from 'inquirerer';
import { tmpdir } from 'os';
import { join } from 'path';

import { dispatch, EXIT } from '../src';

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
  const argv = parseArgv(['node', 'dcrypt', ...line.split(' ').filter(Boolean)], {
    '--': true,
    string: ['in', 'out', 'passphrase-file', 'salt-file', 'aad', 'vault', 'file', 'format', 'kdf'],
  });
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
