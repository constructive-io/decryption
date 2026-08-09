import { mkdtempSync, writeFileSync } from 'fs';
import { Inquirerer, parseArgv } from 'inquirerer';
import { tmpdir } from 'os';
import { join } from 'path';

import { dispatch, EXIT } from '../src';

/** The weakest Argon2id costs the core accepts — the tests assert behaviour, not work factor. */
const FAST_KDF = 't=1,m=8192,p=1';
const CHALLENGE = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

jest.setTimeout(300000);

let home: string;
let work: string;
let out: string[];
let errors: string[];

const run = async (line: string): Promise<number> => {
  const argv = parseArgv(['node', 'dcrypt', ...line.split(' ').filter(Boolean)], {
    '--': true,
    string: ['passphrase-file', 'challenge', 'origin', 'user', 'credential', 'kdf'],
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

describe('dcrypt passkey', () => {
  it('documents itself', async () => {
    expect(await run('passkey help')).toBe(0);
    expect(stdout()).toContain('dcrypt passkey <subcommand>');
    expect(stdout()).toContain('cannot be phished');
  });

  it('refuses to sign a challenge it made up itself', async () => {
    const pass = file('pass.txt', 'a strong master password');
    expect(
      await run(`passkey register auth.example.com --passphrase-file ${pass} --kdf ${FAST_KDF}`)
    ).toBe(EXIT.usage);
    expect(stderr()).toContain('--challenge from the site is required');
  });

  it('registers, lists, signs and forgets — all against the same vault', async () => {
    const pass = file('pass.txt', 'a strong master password');
    const vault = `--passphrase-file ${pass} --kdf ${FAST_KDF}`;

    expect(
      await run(
        `passkey register auth.example.com --user dev@example.com --challenge ${CHALLENGE} ${vault}`
      )
    ).toBe(0);
    expect(stdout()).toContain('registered dev@example.com at auth.example.com');

    out = [];
    expect(await run(`passkey list ${vault}`)).toBe(0);
    expect(stdout()).toContain('dev@example.com');
    expect(stdout()).toContain('used 0×');

    out = [];
    expect(
      await run(`passkey assert auth.example.com --challenge ${CHALLENGE} --json ${vault}`)
    ).toBe(0);
    const assertion = JSON.parse(stdout()) as {
      type: string;
      response: { signature: string; clientDataJSON: string };
    };
    expect(assertion.type).toBe('public-key');
    expect(assertion.response.signature).toBeTruthy();
    // the origin it signed is the site's, which is what makes it unphishable
    expect(
      JSON.parse(Buffer.from(assertion.response.clientDataJSON, 'base64url').toString())
    ).toMatchObject({ origin: 'https://auth.example.com', challenge: CHALLENGE });

    out = [];
    expect(await run(`passkey list ${vault}`)).toBe(0);
    expect(stdout()).toContain('used 1×');

    out = [];
    expect(await run(`passkey forget auth.example.com ${vault}`)).toBe(0);
    out = [];
    expect(await run(`passkey list ${vault}`)).toBe(0);
    expect(stdout()).toContain('(no passkeys)');
  });

  it('says when a site has no passkey', async () => {
    const pass = file('pass.txt', 'a strong master password');
    expect(
      await run(
        `passkey assert auth.example.com --challenge ${CHALLENGE} --passphrase-file ${pass} --kdf ${FAST_KDF}`
      )
    ).toBe(EXIT.notFound);
    expect(stderr()).toContain('no passkey for "auth.example.com"');
  });
});
