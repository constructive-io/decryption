import { generateIdentity, recipientToString } from '@decryption/keys';
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { Inquirerer, parseArgv } from 'inquirerer';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { dispatch, EXIT, options } from '../src';
import { Check, CheckLevel } from '../src/workspace/doctor';
import { SNIPPETS } from '../src/workspace/snippets';

// Creating the identity is an Argon2id run, slow in pure JavaScript even at the minimum cost.
jest.setTimeout(120000);

/** The weakest Argon2id costs the core still accepts: tests assert behaviour, not work factor. */
const FAST_KDF = 't=1,m=8192,p=1';

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs one command line through `dispatch`, the entry point the `dcrypt` bin uses, with a
 * prompter that has no terminal: a command that tries to ask for anything fails instead of
 * hanging.
 */
const run = async (line: string): Promise<Result> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const capture = (sink: string[]) => (chunk: unknown) => {
    sink.push(String(chunk));
    return true;
  };
  const spies = [
    jest.spyOn(process.stdout, 'write').mockImplementation(capture(stdout)),
    jest.spyOn(process.stderr, 'write').mockImplementation(capture(stderr)),
  ];
  const prompter = new Inquirerer({ noTty: true, useDefaults: true });
  try {
    const argv = parseArgv(['node', 'dcrypt', ...line.split(' ').filter(Boolean)], options.minimistOpts);
    const code = await dispatch(argv, prompter);
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
  } finally {
    prompter.close();
    spies.forEach((spy) => spy.mockRestore());
  }
};

/** git, as this process sees it, is the developer's: these make it the same git everywhere. */
const GIT_ENVIRONMENT: Record<string, string | undefined> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
};
const inherited: Record<string, string | undefined> = {};

const someoneElse = (): string => recipientToString(generateIdentity().publicKey);

let home: string;
let mine: string;
let root: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'dcrypt-home-'));
  for (const [name, value] of Object.entries({ ...GIT_ENVIRONMENT, APPSTASH_BASE_DIR: home })) {
    inherited[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  writeFileSync(join(home, 'passphrase'), 'correct horse battery staple');
  const generated = await run(
    `keys generate --kdf ${FAST_KDF} --json --passphrase-file ${join(home, 'passphrase')}`
  );
  mine = JSON.parse(generated.stdout).recipient;
});

afterAll(() => {
  for (const [name, value] of Object.entries(inherited)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dcrypt-workspace-'));
});

const git = (...args: string[]): string => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
};

const dcrypt = (line: string): Promise<Result> => run(`${line} --workspace ${root}`);

const write = (path: string, content: string): void => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};

const recipients = (...lines: string[]): void => write('recipients.txt', `${lines.join('\n')}\n`);

/** A workspace with nothing to complain about: one section, a recovery key, git set up. */
const healthy = async (): Promise<void> => {
  git('init', '-q');
  recipients(`${mine}  ada (laptop)`, `${someoneElse()}  recovery (offline)`);
  write('.gitignore', SNIPPETS.gitignore.text);
  write('.gitattributes', SNIPPETS.gitattributes.text);
  write('garden/beds.csv', 'bed,crop\n1,tomatoes\n');
  await dcrypt('encrypt-section garden');
  await dcrypt('guard install');
  git('add', '-A');
};

interface Report {
  code: number;
  ok: boolean;
  checks: Check[];
  /** The checks that are not `ok`, as `level name`. */
  findings: string[];
  messageOf(name: string, level: CheckLevel): string;
}

const doctor = async (): Promise<Report> => {
  const { code, stdout } = await dcrypt('doctor --json');
  const { ok, checks }: { ok: boolean; checks: Check[] } = JSON.parse(stdout);
  return {
    code,
    ok,
    checks,
    findings: checks.filter((check) => check.level !== 'ok').map((check) => `${check.level} ${check.name}`),
    messageOf: (name, level) =>
      checks.find((check) => check.name === name && check.level === level)?.message ?? '',
  };
};

describe('doctor', () => {
  it('has nothing to say about a workspace that is set up properly', async () => {
    await healthy();
    const report = await doctor();
    expect(report.findings).toEqual([]);
    expect(report).toMatchObject({ code: 0, ok: true });
    expect(report.checks.map((check) => check.name)).toEqual([
      'node',
      'identity',
      'recipients',
      'recovery',
      'section garden',
      'guard',
      'gitignore',
      'tracked files',
    ]);

    const readable = await dcrypt('doctor');
    expect(readable.code).toBe(0);
    expect(readable.stdout).toContain(`workspace: ${root}`);
    expect(readable.stdout).toMatch(/^ok {4}recovery: there is a recovery recipient$/m);
    expect(readable.stdout).toMatch(/^0 failed, 0 warnings$/m);
  });

  it('only reads: no passphrase, nothing written', async () => {
    await healthy();
    const before = { status: git('status', '--porcelain'), files: readdirSync(root, { recursive: true }) };
    const bundle = readFileSync(join(root, 'garden.tar.dcrypt'));

    // There is no terminal and no passphrase on offer: asking for one would fail the command.
    expect((await doctor()).code).toBe(0);
    expect({ status: git('status', '--porcelain'), files: readdirSync(root, { recursive: true }) }).toEqual(before);
    expect(readFileSync(join(root, 'garden.tar.dcrypt')).equals(bundle)).toBe(true);
  });

  it('warns when there is no recovery recipient, without failing', async () => {
    await healthy();
    recipients(`${mine}  ada (laptop)`, `${someoneElse()}  grace (laptop)`);
    await dcrypt('encrypt-section garden');

    const report = await doctor();
    expect(report.findings).toEqual(['warn recovery']);
    expect(report).toMatchObject({ code: 0, ok: true });
    expect(report.messageOf('recovery', 'warn')).toContain(
      'no recovery recipient: if every machine key is lost, nothing can decrypt these sections'
    );

    const readable = await dcrypt('doctor');
    expect(readable.code).toBe(0);
    expect(readable.stdout).toMatch(/^warn {2}recovery: no recovery recipient/m);
    expect(readable.stdout).toMatch(/^0 failed, 1 warning$/m);
  });

  it('knows a recovery recipient by the word in its label', async () => {
    const levelFor = async (label: string): Promise<CheckLevel | undefined> => {
      recipients(`${mine}  ada (laptop)`, `${someoneElse()}  ${label}`);
      return (await doctor()).checks.find((check) => check.name === 'recovery')?.level;
    };
    expect(await levelFor('Recovery key, printed, in the safe')).toBe('ok');
    expect(await levelFor('offline RECOVERY')).toBe('ok');
    expect(await levelFor('grace (laptop)')).toBe('warn');
    expect(await levelFor('unrecoverable')).toBe('warn');
    expect(await levelFor('')).toBe('warn');
  });

  it('warns when one lost key would lose everything, or when this machine is left out', async () => {
    recipients(`${mine}  ada (laptop)`);
    const alone = await doctor();
    expect(alone.messageOf('recipients', 'warn')).toContain('there is only one recipient');
    expect(alone.findings).toContain('warn recovery');

    recipients(`${someoneElse()}  grace (laptop)`, `${someoneElse()}  recovery (offline)`);
    const leftOut = await doctor();
    expect(leftOut.messageOf('recipients', 'warn')).toMatch(/this machine's identity \(.+\) is not in recipients.txt/);
    expect(leftOut.code).toBe(0);
  });

  it('fails without a usable recipients.txt', async () => {
    const missing = await doctor();
    expect(missing).toMatchObject({ code: EXIT.usage, ok: false });
    expect(missing.messageOf('recipients', 'fail')).toContain('no recipients.txt in');

    recipients('# nobody yet');
    expect((await doctor()).messageOf('recipients', 'fail')).toBe('recipients.txt lists no recipients');

    recipients(`${mine}  ada (laptop)`, 'not-a-key  grace (laptop)');
    const malformed = await doctor();
    expect(malformed.code).toBe(EXIT.usage);
    expect(malformed.messageOf('recipients', 'fail')).toContain('recipients.txt:2:');

    const readable = await dcrypt('doctor');
    expect(readable.stderr).toContain('doctor found 1 problem');
  });

  it('fails on a machine with no identity', async () => {
    recipients(`${mine}  ada (laptop)`, `${someoneElse()}  recovery (offline)`);
    process.env.APPSTASH_BASE_DIR = mkdtempSync(join(tmpdir(), 'dcrypt-home-'));
    try {
      const report = await doctor();
      expect(report.code).toBe(EXIT.usage);
      expect(report.messageOf('identity', 'fail')).toContain('run `dcrypt keys generate`');
    } finally {
      process.env.APPSTASH_BASE_DIR = home;
    }
  });

  it('says what each section needs', async () => {
    await healthy();
    write('garden/beds.csv', 'bed,crop\n1,carrots\n');
    write('ledger/2031.csv', 'month,total\njanuary,12\n');
    await dcrypt('encrypt-section ledger');
    writeFileSync(join(root, 'recipients.txt'), `${someoneElse()}  grace (laptop)\n`, { flag: 'a' });

    const report = await doctor();
    expect(report.code).toBe(0);
    expect(report.messageOf('section garden', 'warn')).toContain(
      'plaintext changed: run `dcrypt encrypt-section` to encrypt the changes'
    );
    expect(report.messageOf('section ledger', 'warn')).toContain(
      '1 recipient in recipients.txt cannot open it yet; encrypt it again'
    );
  });

  it('warns outside git, where nothing checks what is committed', async () => {
    recipients(`${mine}  ada (laptop)`, `${someoneElse()}  recovery (offline)`);
    const report = await doctor();
    expect(report.findings).toEqual(['warn git']);
    expect(report.checks.find((check) => check.name === 'sections')?.message).toBe('no sections are encrypted yet');
    expect(report.code).toBe(0);
  });

  it('fails when git would take the plaintext', async () => {
    git('init', '-q');
    recipients(`${mine}  ada (laptop)`, `${someoneElse()}  recovery (offline)`);
    write('garden/beds.csv', 'bed,crop\n1,tomatoes\n');
    await dcrypt('encrypt-section garden');

    const report = await doctor();
    expect(report).toMatchObject({ code: EXIT.usage, ok: false });
    expect(report.findings).toEqual(['warn guard', 'fail gitignore', 'warn gitignore', 'warn lfs']);
    expect(report.messageOf('gitignore', 'fail')).toContain('git does not ignore the plaintext of: garden');
    expect(report.messageOf('gitignore', 'warn')).toBe('git does not ignore .dcrypt/');
  });

  it('fails when plaintext is already tracked', async () => {
    await healthy();
    git('add', '-f', 'garden/beds.csv');

    const report = await doctor();
    expect(report.findings).toEqual(['fail tracked files']);
    expect(report.messageOf('tracked files', 'fail')).toContain('1 tracked file should not be in the repository');
    expect(report.code).toBe(EXIT.usage);
  });
});
