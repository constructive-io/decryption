import { existsSync, mkdtempSync, writeFileSync } from 'fs';
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

const run = async (line: string): Promise<number> => {
  const argv = parseArgv(['node', 'dcrypt', ...line.split(' ').filter(Boolean)], {
    '--': true,
    string: ['in', 'out', 'passphrase-file', 'kind', 'field', 'format', 'from', 'kdf'],
  });
  const prompter = new Inquirerer({ noTty: true, useDefaults: true });
  try {
    return await dispatch(argv, prompter);
  } finally {
    prompter.close();
  }
};

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
  jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('dcrypt vault', () => {
  it('walks the whole lifecycle: add, list, get, totp, export, import, rm', async () => {
    const pass = file('pass.txt', 'a strong master password');
    const flags = `--passphrase-file ${pass} --kdf ${FAST_KDF}`;

    expect(await run('vault status')).toBe(0);
    expect(stdout()).toContain('no vault yet');
    out = [];

    // add a login (creates the vault)
    const secret = file('secret.txt', 'hunter2-but-longer');
    expect(await run(`vault item add github --kind login --in ${secret} ${flags}`)).toBe(0);
    expect(stdout()).toContain('added "github"');
    expect(existsSync(join(home, '.dcrypt', 'data', 'db', 'vault.dcrypt'))).toBe(true);
    out = [];

    // add a totp seed
    const seed = file('seed.txt', 'JBSWY3DPEHPK3PXP');
    expect(await run(`vault item add work-email --kind totp --in ${seed} ${flags}`)).toBe(0);
    out = [];

    // list shows both, without values
    expect(await run(`vault item list ${flags}`)).toBe(0);
    expect(stdout()).toContain('github');
    expect(stdout()).toContain('work-email');
    expect(stdout()).not.toContain('hunter2');
    out = [];

    // get without --reveal conceals; with --reveal prints
    expect(await run(`vault item get github ${flags}`)).toBe(0);
    expect(stdout()).toContain('(concealed)');
    expect(stdout()).not.toContain('hunter2');
    out = [];
    expect(await run(`vault item get github --reveal ${flags}`)).toBe(0);
    expect(stdout()).toContain('hunter2-but-longer');
    out = [];

    // totp produces a 6-digit code
    expect(await run(`vault totp work-email ${flags}`)).toBe(0);
    expect(stdout()).toMatch(/^\d{6}$/);
    out = [];

    // export json → wipe → import json restores
    const backup = join(work, 'backup.json');
    expect(await run(`vault export --out ${backup} ${flags}`)).toBe(0);
    out = [];
    expect(await run(`vault item rm github ${flags}`)).toBe(0);
    out = [];
    expect(await run(`vault import --in ${backup} ${flags}`)).toBe(0);
    expect(stdout()).toContain('imported');
    out = [];
    expect(await run(`vault item get github --reveal ${flags}`)).toBe(0);
    expect(stdout()).toContain('hunter2-but-longer');
    out = [];

    // wrong passphrase exits with the auth code
    const wrong = file('wrong.txt', 'not the master password');
    expect(await run(`vault item list --passphrase-file ${wrong} --kdf ${FAST_KDF}`)).toBe(
      EXIT.auth
    );
  });

  it('imports a generic csv export', async () => {
    const pass = file('pass.txt', 'a strong master password');
    const flags = `--passphrase-file ${pass} --kdf ${FAST_KDF}`;
    const csv = file(
      'export.csv',
      'name,url,username,password\nExample,https://example.com,alice,"pa,ss"\n'
    );
    expect(await run(`vault import --from csv --in ${csv} ${flags}`)).toBe(0);
    out = [];
    expect(await run(`vault item get Example --reveal ${flags}`)).toBe(0);
    expect(stdout()).toContain('alice');
    expect(stdout()).toContain('pa,ss');
  });
});
