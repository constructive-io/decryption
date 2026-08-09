import { mkdtempSync, writeFileSync } from 'fs';
import { Inquirerer, parseArgv } from 'inquirerer';
import { tmpdir } from 'os';
import { join } from 'path';

import { dispatch, EXIT } from '../src';

/** The weakest Argon2id costs the core accepts — the tests assert behaviour, not work factor. */
const FAST_KDF = 't=1,m=8192,p=1';

jest.setTimeout(300000);

let home: string;
let work: string;
let out: string[];
let errors: string[];

const run = async (line: string): Promise<number> => {
  const argv = parseArgv(['node', 'dcrypt', ...line.split(' ').filter(Boolean)], {
    '--': true,
    string: ['passphrase-file', 'password-file', 'endpoint', 'account', 'kdf'],
  });
  const prompter = new Inquirerer({ noTty: true, useDefaults: true });
  try {
    return await dispatch(argv, prompter);
  } finally {
    prompter.close();
  }
};

const stdout = (): string => out.join('').trim();
const stderr = (): string => errors.join('').trim();

const file = (name: string, contents: string): string => {
  const path = join(work, name);
  writeFileSync(path, contents);
  return path;
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dcrypt-home-'));
  work = mkdtempSync(join(tmpdir(), 'dcrypt-work-'));
  process.env.APPSTASH_BASE_DIR = home;
  delete process.env.DCRYPT_AUTH_ENDPOINT;
  delete process.env.DCRYPT_ACCOUNT_PASSWORD;
  out = [];
  errors = [];
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    errors.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('dcrypt account', () => {
  it('documents itself, including that it is the one command that uses the network', async () => {
    expect(await run('account help')).toBe(0);
    expect(stdout()).toContain('dcrypt account <subcommand>');
    expect(stdout()).toContain('the endpoint you name');
  });

  it('refuses a password on the command line', async () => {
    expect(await run('account signin dev@example.com --endpoint http://x/graphql --password hunter22')).toBe(
      EXIT.usage
    );
    expect(stderr()).toContain('refusing to read a password from argv');
  });

  it('requires an endpoint', async () => {
    const password = file('password.txt', 'hunter22');
    expect(await run(`account signin dev@example.com --password-file ${password}`)).toBe(
      EXIT.usage
    );
    expect(stderr()).toContain('--endpoint is required');
  });

  it('reports an empty vault rather than reaching the network', async () => {
    const pass = file('pass.txt', 'a strong master password');
    expect(await run(`account list --passphrase-file ${pass} --kdf ${FAST_KDF}`)).toBe(0);
    expect(stdout()).toContain('(no accounts)');
  });

  it('cannot mint a key without an account', async () => {
    const pass = file('pass.txt', 'a strong master password');
    expect(await run(`account key create ci --passphrase-file ${pass} --kdf ${FAST_KDF}`)).toBe(
      EXIT.usage
    );
    expect(stderr()).toContain('no account in the vault');
  });

  it('documents the harness token and principal surface', async () => {
    expect(await run('account help')).toBe(0);
    expect(stdout()).toContain('token [email]');
    expect(stdout()).toContain('principal create <name>');
    expect(stdout()).toContain('--database <id>');
  });

  it('serves no bearer from an empty vault', async () => {
    const pass = file('pass.txt', 'a strong master password');
    expect(await run(`account token --passphrase-file ${pass} --kdf ${FAST_KDF}`)).toBe(
      EXIT.notFound
    );
    expect(stderr()).toContain('exactly one account');
  });

  it('needs an org for a principal', async () => {
    const pass = file('pass.txt', 'a strong master password');
    expect(
      await run(`account principal create ci --passphrase-file ${pass} --kdf ${FAST_KDF}`)
    ).toBe(EXIT.usage);
    expect(stderr()).toContain('--org <id> is required');
  });

  it('says which key it cannot tag', async () => {
    const pass = file('pass.txt', 'a strong master password');
    expect(
      await run(`account key assign ci db-1 --passphrase-file ${pass} --kdf ${FAST_KDF}`)
    ).toBe(EXIT.notFound);
    expect(stderr()).toContain('no API key "ci"');
  });

  it('says which account it cannot find', async () => {
    const pass = file('pass.txt', 'a strong master password');
    expect(
      await run(`account signout dev@example.com --passphrase-file ${pass} --kdf ${FAST_KDF}`)
    ).toBe(EXIT.notFound);
    expect(stderr()).toContain('no account "dev@example.com"');
  });
});
