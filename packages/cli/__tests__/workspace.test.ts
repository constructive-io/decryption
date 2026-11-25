import { createRecipientFileEncryptor, generateIdentity, recipientToString } from '@decryption/keys';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { Inquirerer, parseArgv } from 'inquirerer';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { chainBytes, dispatch, EXIT, exitCodeFor, options, transformBytes, writeFileAtomically } from '../src';
import * as passphrases from '../src/utils/passphrase';
import { extractSection } from '../src/workspace/bundle';
import { Section } from '../src/workspace/layout';
import { hashBytes, MANIFEST_PATH, ManifestFile, serializeManifest } from '../src/workspace/manifest';
import { TarFile, writeTar } from '../src/workspace/tar';

// Unlocking the identity is an Argon2id run, slow in pure JavaScript even at the minimum cost.
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

/** A key that is on no machine in these tests: the recovery recipient, or a colleague. */
const someoneElse = (): string => recipientToString(generateIdentity().publicKey);

let home: string;
let mine: string;
let unlock: string;
let wrongUnlock: string;
let root: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'dcrypt-home-'));
  process.env.APPSTASH_BASE_DIR = home;
  writeFileSync(join(home, 'passphrase'), 'correct horse battery staple');
  writeFileSync(join(home, 'wrong'), 'incorrect horse');
  unlock = `--passphrase-file ${join(home, 'passphrase')}`;
  wrongUnlock = `--passphrase-file ${join(home, 'wrong')}`;
  const generated = await run(`keys generate --kdf ${FAST_KDF} --json ${unlock}`);
  mine = JSON.parse(generated.stdout).recipient;
});

afterAll(() => {
  delete process.env.APPSTASH_BASE_DIR;
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dcrypt-workspace-'));
  writeFileSync(join(root, 'recipients.txt'), `${mine}  ada (laptop)\n${someoneElse()}  recovery (offline)\n`);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Runs a workspace command against this test's workspace. */
const dcrypt = (line: string): Promise<Result> => run(`${line} --workspace ${root}`);

const write = (path: string, content: string | Buffer, mode?: number): void => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  if (mode !== undefined) chmodSync(target, mode);
};

const read = (path: string): string => readFileSync(join(root, path), 'utf8');

/** A section's files as `path → content`, with a marker on executables. */
const tree = (directory: string, prefix = ''): Record<string, string> =>
  Object.assign(
    {},
    ...readdirSync(join(root, directory), { withFileTypes: true }).map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return tree(path, `${prefix}${entry.name}/`);
      const executable = (statSync(join(root, path)).mode & 0o100) !== 0;
      return { [prefix + entry.name]: `${executable ? '(x) ' : ''}${read(path)}` };
    })
  );

/** Anything a run should have cleaned up: temporary files, folders set aside during a swap. */
const leftovers = (directory = ''): string[] =>
  readdirSync(join(root, directory)).filter((name) => /\.dcrypt-(tmp|old)-/.test(name));

const plantGarden = (): void => {
  write('garden/beds.csv', 'bed,crop\n1,tomatoes\n2,basil\n');
  write('garden/notes/todo.txt', 'water on tuesdays\n');
  write('garden/notes/café.txt', 'accents survive\n');
  write('garden/run.sh', '#!/bin/sh\necho watering\n', 0o755);
};

const GARDEN = {
  'beds.csv': 'bed,crop\n1,tomatoes\n2,basil\n',
  'notes/todo.txt': 'water on tuesdays\n',
  'notes/café.txt': 'accents survive\n',
  'run.sh': '(x) #!/bin/sh\necho watering\n',
};

/**
 * Leaves `garden` with a bundle that is older than its plaintext: the state a `git pull` that
 * brought someone else's bundle produces. Returns what the plaintext holds and what the bundle
 * would restore.
 */
const pullOlderBundle = async (): Promise<{ local: string; pulled: string }> => {
  plantGarden();
  await dcrypt('encrypt-section garden');
  const pulled = readFileSync(join(root, 'garden.tar.dcrypt'));
  write('garden/beds.csv', 'bed,crop\n1,carrots\n');
  await dcrypt('encrypt-section garden');
  writeFileSync(join(root, 'garden.tar.dcrypt'), pulled);
  return { local: 'bed,crop\n1,carrots\n', pulled: GARDEN['beds.csv'] };
};

const stateOf = async (section: string): Promise<{ state: string; advice: string }> => {
  const { stdout } = await dcrypt('status --json');
  return JSON.parse(stdout).sections.find((entry: { section: string }) => entry.section === section);
};

describe('encrypt-section', () => {
  it('turns a folder into one bundle that shows nothing of what is inside', async () => {
    plantGarden();
    const result = await dcrypt('encrypt-section garden');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('garden: encrypted 4 files to 2 recipients → garden.tar.dcrypt');
    expect(result.stderr).toBe('');

    const bundle = readFileSync(join(root, 'garden.tar.dcrypt'));
    expect(bundle.subarray(0, 6).toString('latin1')).toBe('DCRYPT');
    for (const hidden of ['beds.csv', 'todo.txt', 'tomatoes', MANIFEST_PATH, 'ustar']) {
      expect(bundle.includes(hidden)).toBe(false);
    }
    expect(leftovers()).toEqual([]);
    expect(tree('garden')).toEqual(GARDEN);
  });

  it('writes nothing when nothing changed', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');
    const before = readFileSync(join(root, 'garden.tar.dcrypt'));
    const { mtimeMs } = statSync(join(root, 'garden.tar.dcrypt'));

    const again = await dcrypt('encrypt-section garden --json');
    expect(JSON.parse(again.stdout)).toMatchObject({ section: 'garden', changed: false, files: 4 });
    expect(readFileSync(join(root, 'garden.tar.dcrypt')).equals(before)).toBe(true);
    expect(statSync(join(root, 'garden.tar.dcrypt')).mtimeMs).toBe(mtimeMs);

    write('garden/beds.csv', 'bed,crop\n1,carrots\n');
    const edited = await dcrypt('encrypt-section garden --json');
    expect(JSON.parse(edited.stdout)).toMatchObject({ changed: true });
    expect(readFileSync(join(root, 'garden.tar.dcrypt')).equals(before)).toBe(false);
  });

  it('gives the same plaintext the same digest wherever it is encrypted', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');
    const { garden } = JSON.parse(read('.dcrypt/state.json')).sections;

    // The same files, written in another order, at another time, in another place.
    write('allotment/run.sh', '#!/bin/sh\necho watering\n', 0o755);
    write('allotment/notes/café.txt', 'accents survive\n');
    write('allotment/notes/todo.txt', 'water on tuesdays\n');
    write('allotment/beds.csv', 'bed,crop\n1,tomatoes\n2,basil\n');
    write('allotment/.DS_Store', 'finder droppings');
    await dcrypt('encrypt-section allotment');
    const { allotment } = JSON.parse(read('.dcrypt/state.json')).sections;

    expect(allotment.digest).toBe(garden.digest);
    // The bundles differ all the same: each encryption draws a fresh file key.
    expect(allotment.bundle).not.toBe(garden.bundle);
  });

  it('takes exactly one section, named by its folder or its bundle', async () => {
    plantGarden();
    write('clients/northwind/order.txt', 'forty widgets\n');
    expect((await dcrypt('encrypt-section')).code).toBe(EXIT.usage);
    expect((await dcrypt('encrypt-section garden clients/northwind')).code).toBe(EXIT.usage);
    expect(existsSync(join(root, 'garden.tar.dcrypt'))).toBe(false);

    expect((await dcrypt('encrypt-section garden.tar.dcrypt')).code).toBe(0);
    expect((await dcrypt('encrypt-section clients/northwind/')).code).toBe(0);
    expect(existsSync(join(root, 'garden.tar.dcrypt'))).toBe(true);
    expect(existsSync(join(root, 'clients/northwind.tar.dcrypt'))).toBe(true);
  });

  it('refuses what cannot be a section', async () => {
    mkdirSync(join(root, 'empty'));
    const outside = await dcrypt('encrypt-section ../elsewhere');
    expect(outside.code).toBe(EXIT.usage);
    expect(outside.stderr).toContain('not a folder inside the workspace');
    expect((await dcrypt('encrypt-section .')).code).toBe(EXIT.usage);
    expect((await dcrypt('encrypt-section .git')).code).toBe(EXIT.usage);
    expect((await dcrypt('encrypt-section nowhere')).code).toBe(EXIT.notFound);
    const empty = await dcrypt('encrypt-section empty');
    expect(empty.code).toBe(EXIT.usage);
    expect(empty.stderr).toContain('has no files to encrypt');
  });

  it('refuses a link, and leaves no bundle behind', async () => {
    plantGarden();
    symlinkSync(join(home, 'passphrase'), join(root, 'garden/shortcut'));
    const result = await dcrypt('encrypt-section garden');
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain('is a link or a special file');
    expect(readdirSync(root).sort()).toEqual(['garden', 'recipients.txt']);
  });

  it('needs a recipients.txt', async () => {
    plantGarden();
    rmSync(join(root, 'recipients.txt'));
    const result = await dcrypt('encrypt-section garden');
    expect(result.code).toBe(EXIT.notFound);
    expect(result.stderr).toContain('no recipients.txt');
  });

  it('warns when no recipient is a recovery key', async () => {
    plantGarden();
    write('recipients.txt', `${mine}  ada (laptop)\n`);
    const result = await dcrypt('encrypt-section garden');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('warning: no recovery recipient');
  });

  it('warns when this machine could not decrypt what it encrypts', async () => {
    plantGarden();
    write('recipients.txt', `${someoneElse()}  recovery (offline)\n`);
    const result = await dcrypt('encrypt-section garden');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('is not in recipients.txt');
  });

  it('encrypts again when recipients.txt changes, though the files did not', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');
    const recipients = read('recipients.txt');

    write('recipients.txt', `${recipients}${someoneElse()}  grace (laptop)\n`);
    expect(await stateOf('garden')).toMatchObject({
      state: 'in sync',
      advice: '1 recipient in recipients.txt cannot open it yet; encrypt it again',
    });
    expect(JSON.parse((await dcrypt('encrypt-section garden --json')).stdout)).toMatchObject({
      changed: true,
      recipients: 3,
    });
    expect(await stateOf('garden')).toMatchObject({ state: 'in sync', advice: '' });

    // Taking someone out of recipients.txt takes effect at the next encryption, and status says so.
    write('recipients.txt', recipients);
    expect((await stateOf('garden')).advice).toContain('still encrypted to 1 key no longer in recipients.txt');
    expect(JSON.parse((await dcrypt('encrypt-section garden --json')).stdout).changed).toBe(true);
    expect((await stateOf('garden')).advice).toBe('');
  });

  it('does not replace a bundle that is newer than the plaintext, unless forced', async () => {
    const { pulled } = await pullOlderBundle();
    const bundle = readFileSync(join(root, 'garden.tar.dcrypt'));

    const refused = await dcrypt('encrypt-section garden');
    expect(refused.code).toBe(EXIT.usage);
    expect(refused.stderr).toContain('its bundle has changed since this machine last decrypted it');
    expect(readFileSync(join(root, 'garden.tar.dcrypt')).equals(bundle)).toBe(true);

    expect((await dcrypt('encrypt-section garden --force')).code).toBe(0);
    expect(readFileSync(join(root, 'garden.tar.dcrypt')).equals(bundle)).toBe(false);
    expect(read('garden/beds.csv')).not.toBe(pulled);
    expect((await stateOf('garden')).state).toBe('in sync');
  });
});

describe('decrypt-workspace', () => {
  it('restores every section, asking for the passphrase once', async () => {
    plantGarden();
    write('clients/northwind/order.txt', 'forty widgets\n');
    await dcrypt('encrypt-section garden');
    await dcrypt('encrypt-section clients/northwind');
    rmSync(join(root, 'garden'), { recursive: true });
    rmSync(join(root, 'clients/northwind'), { recursive: true });
    expect((await stateOf('garden')).state).toBe('not decrypted');

    const asked = jest.spyOn(passphrases, 'resolvePassphrase');
    const result = await dcrypt(`decrypt-workspace --json ${unlock}`);
    expect(result.code).toBe(0);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.stdout).sections).toEqual([
      { section: 'clients/northwind', result: 'decrypted', detail: '1 file' },
      { section: 'garden', result: 'decrypted', detail: '4 files' },
    ]);
    expect(tree('garden')).toEqual(GARDEN);
    expect(tree('clients/northwind')).toEqual({ 'order.txt': 'forty widgets\n' });
    expect(leftovers()).toEqual([]);
    expect(leftovers('clients')).toEqual([]);
    expect((await stateOf('garden')).state).toBe('in sync');
  });

  it('asks for nothing when every section is up to date', async () => {
    plantGarden();
    write('clients/northwind/order.txt', 'forty widgets\n');
    await dcrypt('encrypt-section garden');
    await dcrypt('encrypt-section clients/northwind');

    // No passphrase is offered and there is no terminal: a prompt would fail the command.
    const all = await dcrypt('decrypt-workspace --json');
    expect(all.code).toBe(0);
    expect(JSON.parse(all.stdout).sections.map((entry: { result: string }) => entry.result)).toEqual([
      'unchanged',
      'unchanged',
    ]);

    const one = await dcrypt('decrypt-workspace garden --json');
    expect(JSON.parse(one.stdout).sections).toEqual([
      { section: 'garden', result: 'unchanged', detail: 'in sync' },
    ]);
  });

  it('changes nothing on a wrong passphrase', async () => {
    const { local } = await pullOlderBundle();
    write('clients/northwind/order.txt', 'forty widgets\n');
    await dcrypt('encrypt-section clients/northwind');
    rmSync(join(root, 'clients/northwind'), { recursive: true });

    const result = await dcrypt(`decrypt-workspace ${wrongUnlock}`);
    expect(result.code).toBe(EXIT.auth);
    expect(result.stderr).toContain('wrong passphrase');
    expect(read('garden/beds.csv')).toBe(local);
    expect(existsSync(join(root, 'clients/northwind'))).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(leftovers('clients')).toEqual([]);
  });

  it('changes nothing for a bundle that is damaged or cut short, and still decrypts the others', async () => {
    const { local } = await pullOlderBundle();
    const damaged = readFileSync(join(root, 'garden.tar.dcrypt'));
    damaged[damaged.length - 40] ^= 1;
    writeFileSync(join(root, 'garden.tar.dcrypt'), damaged);

    write('ledger/2031.csv', 'month,total\njanuary,12\n');
    await dcrypt('encrypt-section ledger');
    const whole = readFileSync(join(root, 'ledger.tar.dcrypt'));
    write('ledger/2031.csv', 'month,total\njanuary,13\n');
    await dcrypt('encrypt-section ledger');
    writeFileSync(join(root, 'ledger.tar.dcrypt'), whole.subarray(0, whole.length - 20));

    write('clients/northwind/order.txt', 'forty widgets\n');
    await dcrypt('encrypt-section clients/northwind');
    rmSync(join(root, 'clients/northwind'), { recursive: true });

    const result = await dcrypt(`decrypt-workspace --json ${unlock}`);
    expect(result.code).toBe(EXIT.corrupt);
    expect(result.stderr).toContain('2 sections could not be decrypted');
    const outcomes = Object.fromEntries(
      JSON.parse(result.stdout).sections.map((entry: { section: string; result: string }) => [
        entry.section,
        entry.result,
      ])
    );
    expect(outcomes).toEqual({ 'clients/northwind': 'decrypted', garden: 'failed', ledger: 'failed' });

    expect(read('garden/beds.csv')).toBe(local);
    expect(read('ledger/2031.csv')).toBe('month,total\njanuary,13\n');
    expect(read('clients/northwind/order.txt')).toBe('forty widgets\n');
    expect(leftovers()).toEqual([]);
  });

  /** Encrypts `clients/northwind` and removes its folder: a section that is there to decrypt. */
  const plantNorthwind = async (): Promise<void> => {
    write('clients/northwind/order.txt', 'forty widgets\n');
    await dcrypt('encrypt-section clients/northwind');
    rmSync(join(root, 'clients/northwind'), { recursive: true });
  };

  const resultsOf = (stdout: string): Record<string, string> =>
    Object.fromEntries(
      JSON.parse(stdout).sections.map((entry: { section: string; result: string }) => [entry.section, entry.result])
    );

  it('fails one section, not the run, when a bundle cannot even be read', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');
    const garden = readFileSync(join(root, 'garden.tar.dcrypt'));
    garden[0] ^= 1; // no longer a dcrypt file of any kind
    writeFileSync(join(root, 'garden.tar.dcrypt'), garden);

    write('ledger/2031.csv', 'month,total\njanuary,12\n');
    await dcrypt('encrypt-section ledger');
    // Cut off inside the header, before the payload begins.
    writeFileSync(join(root, 'ledger.tar.dcrypt'), readFileSync(join(root, 'ledger.tar.dcrypt')).subarray(0, 12));
    await plantNorthwind();

    const result = await dcrypt(`decrypt-workspace --json ${unlock}`);
    expect(result.code).toBe(EXIT.corrupt);
    expect(result.stderr).toContain('2 sections could not be decrypted');
    expect(resultsOf(result.stdout)).toEqual({ 'clients/northwind': 'decrypted', garden: 'failed', ledger: 'failed' });
    expect(read('clients/northwind/order.txt')).toBe('forty widgets\n');
    expect(tree('garden')).toEqual(GARDEN);

    // status describes every section, the unreadable ones included.
    expect((await dcrypt('status')).code).toBe(0);
    expect((await stateOf('garden')).state).toBe('bundle unreadable');
    expect((await stateOf('ledger')).advice).toContain('restore the bundle from git');
    expect((await stateOf('clients/northwind')).state).toBe('in sync');

    // The plaintext is still here, so the bundle can be made again: but only when asked to.
    const refused = await dcrypt('encrypt-section garden');
    expect(refused.code).toBe(EXIT.usage);
    expect(refused.stderr).toContain('its bundle cannot be read');
    expect(readFileSync(join(root, 'garden.tar.dcrypt')).equals(garden)).toBe(true);
    expect((await dcrypt('encrypt-section garden --force')).code).toBe(0);
    expect((await stateOf('garden')).state).toBe('in sync');
  });

  it('fails one section, not the run, when a folder holds what a bundle cannot', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');
    symlinkSync(join(home, 'passphrase'), join(root, 'garden/shortcut'));
    await plantNorthwind();

    const result = await dcrypt(`decrypt-workspace --json ${unlock}`);
    expect(result.code).toBe(EXIT.usage);
    expect(resultsOf(result.stdout)).toEqual({ 'clients/northwind': 'decrypted', garden: 'failed' });
    expect(await stateOf('garden')).toMatchObject({
      state: 'plaintext unreadable',
      advice: expect.stringContaining('is a link or a special file'),
    });
    expect((await stateOf('clients/northwind')).state).toBe('in sync');
  });

  it('takes a newer bundle, and keeps edits that are not encrypted yet', async () => {
    const { pulled } = await pullOlderBundle();
    expect(await stateOf('garden')).toMatchObject({ state: 'bundle changed' });

    const updated = await dcrypt(`decrypt-workspace ${unlock}`);
    expect(updated.code).toBe(0);
    expect(updated.stdout).toContain('garden  updated (4 files)');
    expect(read('garden/beds.csv')).toBe(pulled);
    expect(tree('garden')).toEqual(GARDEN);

    write('garden/beds.csv', 'bed,crop\n1,leeks\n');
    expect((await stateOf('garden')).state).toBe('plaintext changed');
    const kept = await dcrypt('decrypt-workspace');
    expect(kept.code).toBe(0);
    expect(kept.stdout).toContain('garden  kept (it has changes that are not encrypted yet)');
    expect(read('garden/beds.csv')).toBe('bed,crop\n1,leeks\n');

    expect((await dcrypt(`decrypt-workspace --force ${unlock}`)).code).toBe(0);
    expect(read('garden/beds.csv')).toBe(pulled);
    expect(leftovers()).toEqual([]);
  });

  it('stops when the plaintext and the bundle have both changed', async () => {
    await pullOlderBundle();
    write('garden/beds.csv', 'bed,crop\n1,leeks\n');
    expect((await stateOf('garden')).state).toBe('conflict');

    const result = await dcrypt('decrypt-workspace');
    expect(result.code).toBe(EXIT.usage);
    expect(result.stdout).toContain('garden  failed (the plaintext and the bundle have both changed');
    expect(read('garden/beds.csv')).toBe('bed,crop\n1,leeks\n');
  });

  it('settles a section this machine has no record of by comparing, never by overwriting', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');
    rmSync(join(root, '.dcrypt'), { recursive: true });
    expect((await stateOf('garden')).state).toBe('unknown');
    expect((await dcrypt('encrypt-section garden')).code).toBe(EXIT.usage);

    const same = await dcrypt(`decrypt-workspace ${unlock}`);
    expect(same.code).toBe(0);
    expect(same.stdout).toContain('garden  unchanged (already matches its bundle)');
    expect((await stateOf('garden')).state).toBe('in sync');

    rmSync(join(root, '.dcrypt'), { recursive: true });
    write('garden/beds.csv', 'bed,crop\n1,leeks\n');
    const different = await dcrypt(`decrypt-workspace ${unlock}`);
    expect(different.code).toBe(EXIT.usage);
    expect(different.stdout).toContain('it differs from its bundle');
    expect(read('garden/beds.csv')).toBe('bed,crop\n1,leeks\n');
    expect(leftovers()).toEqual([]);
  });

  it('finishes what a killed run left half done', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');
    // Killed between the two renames of a swap: the plaintext is under its set-aside name.
    renameSync(join(root, 'garden'), join(root, '.garden.dcrypt-old-0123456789ab'));
    mkdirSync(join(root, '.garden.dcrypt-tmp-0123456789ab'));
    write('.garden.dcrypt-tmp-0123456789ab/beds.csv', 'half written');
    write('.garden.tar.dcrypt.dcrypt-tmp-0123456789ab', 'half written');

    const result = await dcrypt('decrypt-workspace');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('restored garden after an interrupted run');
    expect(tree('garden')).toEqual(GARDEN);
    expect(leftovers()).toEqual([]);
    expect((await stateOf('garden')).state).toBe('in sync');
  });

  it('says when a bundle is a Git LFS pointer', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');
    write('garden.tar.dcrypt', 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n');

    expect(await stateOf('garden')).toMatchObject({ state: 'not downloaded' });
    const result = await dcrypt('decrypt-workspace');
    expect(result.code).toBe(EXIT.notFound);
    expect(result.stdout).toContain('git lfs pull');
    expect(tree('garden')).toEqual(GARDEN);
  });

  it('says, without asking for a passphrase, when this machine is not a recipient', async () => {
    plantGarden();
    write('recipients.txt', `${someoneElse()}  recovery (offline)\n`);
    await dcrypt('encrypt-section garden');
    rmSync(join(root, 'garden'), { recursive: true });

    const result = await dcrypt('decrypt-workspace');
    expect(result.code).toBe(EXIT.permission);
    expect(result.stdout).toContain('is not one of its recipients');
    expect(existsSync(join(root, 'garden'))).toBe(false);
  });

  it('reports a workspace with no sections', async () => {
    const result = await dcrypt('decrypt-workspace');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('no sections in');
    expect((await dcrypt('status')).stdout).toContain('no sections in');
  });
});

/**
 * Recipient keys are public, so anyone can make a bundle that decrypts. These build bundles the
 * commands would never write and check that extraction takes nothing in them on trust.
 */
describe('status', () => {
  it('still reports the sections when recipients.txt cannot be used', async () => {
    plantGarden();
    await dcrypt('encrypt-section garden');

    for (const [content, complaint] of [
      ['not-a-key  grace (laptop)\n', 'recipients.txt:1:'],
      ['# nobody yet\n', 'lists no recipients'],
    ]) {
      writeFileSync(join(root, 'recipients.txt'), content);
      const status = await dcrypt('status');
      expect(status.code).toBe(0);
      expect(status.stdout).toMatch(/^garden {2}in sync$/m);
      expect(status.stderr).toContain(`warning: `);
      expect(status.stderr).toContain(complaint);
    }
  });
});

describe('a bundle made by someone else', () => {
  const identity = generateIdentity();
  let section: Section;

  beforeEach(() => {
    section = { name: 'garden', directory: join(root, 'garden'), bundle: join(root, 'garden.tar.dcrypt') };
  });

  const entry = (path: string, content: string): TarFile => {
    const bytes = Buffer.from(content);
    return { path, size: bytes.length, executable: false, content: [bytes] };
  };

  const listed = async (path: string, content: string): Promise<ManifestFile> => ({
    path,
    size: Buffer.byteLength(content),
    sha256: await hashBytes([Buffer.from(content)]),
    executable: false,
  });

  const manifestOf = (files: ManifestFile[]): TarFile =>
    entry(MANIFEST_PATH, serializeManifest({ version: 1, files }).toString('utf8'));

  const forge = async (entries: TarFile[]): Promise<void> => {
    const { header, stream } = createRecipientFileEncryptor([recipientToString(identity.publicKey)]);
    await writeFileAtomically(section.bundle, chainBytes([header], transformBytes(writeTar(entries), stream)));
  };

  const rejected = async (message: RegExp): Promise<void> => {
    const failure: unknown = await extractSection(section, identity).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(message);
    expect(exitCodeFor(failure)).toBe(EXIT.corrupt);
    // Nothing is left of the attempt, in the workspace or beside it.
    expect(readdirSync(root).sort()).toEqual(['garden.tar.dcrypt', 'recipients.txt']);
    expect(existsSync(join(dirname(root), 'escape.txt'))).toBe(false);
  };

  it('is extracted when it is well formed', async () => {
    await forge([manifestOf([await listed('beds.csv', 'tomatoes')]), entry('beds.csv', 'tomatoes')]);
    const extraction = await extractSection(section, identity);
    expect(readFileSync(join(extraction.directory, 'beds.csv'), 'utf8')).toBe('tomatoes');
    expect(existsSync(section.directory)).toBe(false);
    rmSync(extraction.directory, { recursive: true });
  });

  it('cannot name a path outside its folder', async () => {
    for (const path of ['../escape.txt', '/tmp/escape.txt', 'notes/../../escape.txt', 'notes//beds.csv', '.']) {
      await forge([manifestOf([await listed(path, 'out')]), entry(path, 'out')]);
      await rejected(/manifest is invalid: path .* is not acceptable/);
    }
  });

  it('cannot carry content its manifest does not describe', async () => {
    await forge([manifestOf([await listed('beds.csv', 'tomatoes')]), entry('beds.csv', 'potatoes')]);
    await rejected(/"beds.csv" does not have the content it lists/);
  });

  it('cannot carry a file its manifest does not list, or leave one out', async () => {
    const beds = await listed('beds.csv', 'tomatoes');
    await forge([manifestOf([beds]), entry('beds.csv', 'tomatoes'), entry('extra.txt', 'surprise')]);
    await rejected(/"extra.txt" is not the file it lists next/);

    await forge([manifestOf([beds, await listed('todo.txt', 'water')]), entry('beds.csv', 'tomatoes')]);
    await rejected(/files it lists are missing/);
  });

  it('cannot do without a manifest, or hide a second one', async () => {
    await forge([entry('beds.csv', 'tomatoes')]);
    await rejected(/does not begin with one/);

    await forge([]);
    await rejected(/it is empty/);

    const beds = await listed('beds.csv', 'tomatoes');
    await forge([manifestOf([beds]), entry('beds.csv', 'tomatoes'), manifestOf([beds])]);
    await rejected(/is not the file it lists next/);
  });

  it('cannot list the same file twice, or two that collide', async () => {
    const beds = await listed('beds.csv', 'tomatoes');
    await forge([manifestOf([beds, beds]), entry('beds.csv', 'tomatoes'), entry('beds.csv', 'tomatoes')]);
    await rejected(/the files are not sorted/);

    // A file and a folder of the same name cannot both exist.
    const inside = await listed('beds.csv/inside.txt', 'tomatoes');
    await forge([manifestOf([beds, inside]), entry('beds.csv', 'tomatoes'), entry('beds.csv/inside.txt', 'tomatoes')]);
    await rejected(/cannot create "beds.csv\/inside.txt"/);
  });
});
