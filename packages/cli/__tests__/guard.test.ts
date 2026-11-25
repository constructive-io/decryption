import { generateIdentity, recipientToString } from '@decryption/keys';
import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { Inquirerer, parseArgv } from 'inquirerer';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { dispatch, EXIT, options } from '../src';
import { HOOK_MARKER, SNIPPETS } from '../src/workspace/snippets';

jest.setTimeout(60000);

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs one command line through `dispatch`, the entry point the `dcrypt` bin uses. */
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

const aRecipient = (): string => recipientToString(generateIdentity().publicKey);

let root: string;

beforeAll(() => {
  for (const [name, value] of Object.entries({
    ...GIT_ENVIRONMENT,
    // An empty home: the guard needs no identity, and must not find the developer's.
    APPSTASH_BASE_DIR: mkdtempSync(join(tmpdir(), 'dcrypt-home-')),
  })) {
    inherited[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

afterAll(() => {
  for (const [name, value] of Object.entries(inherited)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const git = (args: string[], env: NodeJS.ProcessEnv = process.env): ReturnType<typeof spawnSync> =>
  spawnSync('git', args, { cwd: root, encoding: 'utf8', env });

const gitOk = (...args: string[]): string => {
  const result = git(args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout);
};

const commit = (env?: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> =>
  git(['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', 'commit', '-q', '-m', 'a commit'], env);

const staged = (): string[] => gitOk('diff', '--cached', '--name-only').split('\n').filter(Boolean).sort();

const dcrypt = (line: string): Promise<Result> => run(`${line} --workspace ${root}`);

const write = (path: string, content: string | Buffer, mode?: number): void => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  if (mode !== undefined) chmodSync(target, mode);
};

/** A workspace in a new repository, with one encrypted section and its plaintext beside it. */
const plant = async (): Promise<void> => {
  write('recipients.txt', `${aRecipient()}  ada (laptop)\n${aRecipient()}  recovery (offline)\n`);
  write('README.md', '# Garden records\n');
  write('garden/beds.csv', 'bed,crop\n1,tomatoes\n');
  write('garden/notes/todo.txt', 'water on tuesdays\n');
  write('notes.txt', 'a stray file, not in any section\n');
  await dcrypt('encrypt-section garden');
};

const allowList = (): void => {
  write('.gitignore', SNIPPETS.gitignore.text);
  write('.gitattributes', SNIPPETS.gitattributes.text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dcrypt-repository-'));
  gitOk('init', '-q');
});

describe('guard snippet', () => {
  it('lists the snippets, and prints one ready to redirect into its file', async () => {
    const list = await dcrypt('guard snippet');
    expect(list.stdout.split('\n').filter(Boolean)).toHaveLength(Object.keys(SNIPPETS).length);
    expect(list.stdout).toMatch(/^gitignore\s+\.gitignore$/m);

    for (const [name, { text }] of Object.entries(SNIPPETS)) {
      expect((await dcrypt(`guard snippet ${name}`)).stdout).toBe(text);
    }
  });

  it('does not know a snippet it does not have', async () => {
    const result = await dcrypt('guard snippet dockerignore');
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain('unknown snippet "dockerignore"');
  });
});

describe('the allow-list .gitignore', () => {
  it('lets "git add -A" stage the bundles and nothing that is plaintext', async () => {
    await plant();
    allowList();
    gitOk('add', '-A');
    expect(staged()).toEqual(['.gitattributes', '.gitignore', 'README.md', 'garden.tar.dcrypt', 'recipients.txt']);

    const result = await dcrypt('guard');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('dcrypt guard: 5 staged files checked, nothing to stop');
  });

  it('opens a sub-folder for its bundles alone, with the lines it carries commented out', async () => {
    await plant();
    write('clients/northwind/order.txt', 'forty widgets\n');
    write('clients/notes.txt', 'another stray file\n');
    await dcrypt('encrypt-section clients/northwind');
    write('.gitignore', SNIPPETS.gitignore.text.replace(/^# (?=[!/])/gm, ''));

    gitOk('add', '-A');
    expect(staged()).toEqual([
      '.gitignore',
      'README.md',
      'clients/northwind.tar.dcrypt',
      'garden.tar.dcrypt',
      'recipients.txt',
    ]);
    expect((await dcrypt('guard')).code).toBe(0);
  });
});

describe('guard', () => {
  it('stops plaintext, a mislabelled file and a forced file, and says which is which', async () => {
    await plant();
    allowList();
    write('export.dcrypt', 'bed,crop\n1,tomatoes\n');
    gitOk('add', '-A');
    gitOk('add', '-f', 'garden/beds.csv', 'export.dcrypt', 'notes.txt');

    const result = await dcrypt('guard --json');
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain('3 of 8 staged files must not be committed');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      scope: 'staged',
      checked: 8,
      violations: [
        { path: 'export.dcrypt', rule: 'not encrypted' },
        { path: 'garden/beds.csv', rule: 'plaintext' },
        { path: 'notes.txt', rule: 'ignored' },
      ],
    });

    const readable = await dcrypt('guard');
    expect(readable.stdout).toContain(
      'garden/beds.csv: plaintext of the encrypted section "garden"; commit garden.tar.dcrypt instead'
    );
    expect(readable.stdout).toContain('export.dcrypt: named .dcrypt but its content is not a dcrypt envelope');
    expect(readable.stdout).toContain('notes.txt: covered by .gitignore, so it was added by force');
  });

  it('stops plaintext in a repository with no ignore rules at all', async () => {
    await plant();
    write('clients/northwind/order.txt', 'forty widgets\n');
    await dcrypt('encrypt-section clients/northwind');
    gitOk('add', '-A');

    const { violations } = JSON.parse((await dcrypt('guard --json')).stdout);
    expect(violations.map(({ path, rule }: { path: string; rule: string }) => `${rule}: ${path}`)).toEqual([
      'plaintext: clients/northwind/order.txt',
      'plaintext: garden/beds.csv',
      'plaintext: garden/notes/todo.txt',
    ]);
  });

  it('reads what is staged, not what is in the working tree', async () => {
    await plant();
    write('export.dcrypt', 'bed,crop\n1,tomatoes\n');
    gitOk('add', 'export.dcrypt');
    // Encrypted after it was staged: the commit would still record the plaintext.
    await run(`encrypt --binary --recipient ${aRecipient()} --in ${join(root, 'notes.txt')} --out ${join(root, 'export.dcrypt')}`);
    expect((await dcrypt('guard')).code).toBe(EXIT.usage);

    gitOk('add', 'export.dcrypt');
    expect((await dcrypt('guard')).code).toBe(0);
  });

  it('accepts a .dcrypt file in either form of the envelope', async () => {
    const to = `--recipient ${aRecipient()} --in ${join(root, 'notes.txt')}`;
    write('notes.txt', 'water on tuesdays\n');
    await run(`encrypt --binary ${to} --out ${join(root, 'binary.dcrypt')}`);
    await run(`encrypt ${to} --out ${join(root, 'armored.dcrypt')}`);
    gitOk('add', 'binary.dcrypt', 'armored.dcrypt');

    const result = await dcrypt('guard');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('2 staged files checked');
  });

  it('follows a Git LFS pointer to the file it stands for', async () => {
    await plant();
    const bundle = readFileSync(join(root, 'garden.tar.dcrypt'));
    write('garden.tar.dcrypt', 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n');
    gitOk('add', 'garden.tar.dcrypt');

    // What LFS leaves behind: a pointer in the index, the real file in the working tree.
    write('garden.tar.dcrypt', bundle);
    expect((await dcrypt('guard')).code).toBe(0);

    write('garden.tar.dcrypt', 'bed,crop\n1,tomatoes\n');
    const result = await dcrypt('guard');
    expect(result.code).toBe(EXIT.usage);
    expect(result.stdout).toContain('garden.tar.dcrypt: named .dcrypt but its content is not a dcrypt envelope');
  });

  it('checks everything tracked with --all, long after it was committed', async () => {
    await plant();
    allowList();
    gitOk('add', '-A');
    gitOk('add', '-f', 'garden/beds.csv');
    expect(commit().status).toBe(0);

    const stagedNow = await dcrypt('guard');
    expect(stagedNow.code).toBe(0);
    expect(stagedNow.stdout).toContain('0 staged files checked');

    const all = await dcrypt('guard --all');
    expect(all.code).toBe(EXIT.usage);
    expect(all.stdout).toContain('garden/beds.csv: plaintext of the encrypted section "garden"');
    expect(all.stderr).toContain('1 of 6 tracked files must not be committed');
  });

  it('refuses to guess: one scope, a known subcommand, a real repository', async () => {
    expect((await dcrypt('guard --staged --all')).stderr).toContain('--staged and --all are alternatives');
    expect((await dcrypt('guard uninstall')).stderr).toContain('unknown guard subcommand: uninstall');

    rmSync(join(root, '.git'), { recursive: true });
    const result = await dcrypt('guard');
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain('is not in a git repository');
  });
});

describe('guard install', () => {
  const hook = (): string => join(root, '.git/hooks/pre-commit');

  /** A folder to use as PATH, holding a `dcrypt` that records how it was called and exits `code`. */
  const pathWith = (code: number): string => {
    const bin = mkdtempSync(join(tmpdir(), 'dcrypt-bin-'));
    writeFileSync(join(bin, 'dcrypt'), `#!/bin/sh\necho "dcrypt $*"\nexit ${code}\n`, { mode: 0o755 });
    return bin;
  };

  it('writes an executable pre-commit hook, and writes it again without complaint', async () => {
    const result = await dcrypt('guard install');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`pre-commit guard installed at ${hook()}`);
    expect(readFileSync(hook(), 'utf8')).toBe(SNIPPETS.hook.text);
    expect(readFileSync(hook(), 'utf8')).toContain(HOOK_MARKER);
    expect(statSync(hook()).mode & 0o111).toBe(0o111);

    expect(JSON.parse((await dcrypt('guard install --json')).stdout)).toEqual({ installed: hook() });
  });

  it('leaves a hook it did not write alone, unless forced', async () => {
    const theirs = '#!/bin/sh\necho "lint first"\n';
    write('.git/hooks/pre-commit', theirs, 0o755);

    const refused = await dcrypt('guard install');
    expect(refused.code).toBe(EXIT.usage);
    expect(refused.stderr).toContain('was not written by dcrypt');
    expect(readFileSync(hook(), 'utf8')).toBe(theirs);

    expect((await dcrypt('guard install --force')).code).toBe(0);
    expect(readFileSync(hook(), 'utf8')).toBe(SNIPPETS.hook.text);
  });

  it('puts the hook where this repository keeps its hooks', async () => {
    gitOk('config', 'core.hooksPath', '.githooks');
    expect((await dcrypt('guard install')).code).toBe(0);
    expect(readFileSync(join(root, '.githooks/pre-commit'), 'utf8')).toContain(HOOK_MARKER);
    expect(existsSync(hook())).toBe(false);
  });

  it('does not install into a repository the workspace is only a part of', async () => {
    mkdirSync(join(root, 'private'));
    const result = await run(`guard install --workspace ${join(root, 'private')}`);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain('is not the top of its git repository');
    expect(existsSync(hook())).toBe(false);
  });

  it('installs a hook that runs the guard, and fails closed when dcrypt is missing', async () => {
    await dcrypt('guard install');

    const present = spawnSync('/bin/sh', [hook()], { cwd: root, encoding: 'utf8', env: { PATH: pathWith(0) } });
    expect(present.stdout).toBe('dcrypt guard --staged\n');
    expect(present.status).toBe(0);

    const empty = mkdtempSync(join(tmpdir(), 'dcrypt-bin-'));
    const missing = spawnSync('/bin/sh', [hook()], { cwd: root, encoding: 'utf8', env: { PATH: empty } });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('dcrypt is not installed, so this commit cannot be checked');
  });

  it('installs a hook git runs: a commit goes through only when the guard passes', async () => {
    await dcrypt('guard install');
    write('README.md', '# Garden records\n');
    gitOk('add', 'README.md');
    const withGuard = (code: number): NodeJS.ProcessEnv => ({
      ...process.env,
      PATH: `${pathWith(code)}:${process.env.PATH}`,
    });

    expect(commit(withGuard(1)).status).not.toBe(0);
    expect(git(['rev-parse', '--verify', '-q', 'HEAD']).status).not.toBe(0);

    expect(commit(withGuard(0)).status).toBe(0);
    expect(gitOk('log', '--format=%s')).toBe('a commit\n');
  });
});
