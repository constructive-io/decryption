import { spawn, spawnSync } from 'child_process';
import { realpathSync } from 'fs';
import { resolve } from 'path';

import { ByteReader } from '../utils/bytes';
import { CliError } from '../utils/errors';

/**
 * The few questions the guard and `doctor` ask of git, each answered by git itself. Nothing here
 * changes a repository. Paths are relative to `root`, which is the workspace root.
 */
const MAX_OUTPUT = 256 * 1024 * 1024;

interface GitResult {
  status: number;
  stdout: string;
}

const git = (root: string, args: string[], input?: string): GitResult => {
  const result = spawnSync('git', args, { cwd: root, input, encoding: 'utf8', maxBuffer: MAX_OUTPUT });
  if (result.error) throw new CliError(`cannot run git: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout };
};

const gitOrThrow = (root: string, args: string[]): string => {
  const { status, stdout } = git(root, args);
  if (status !== 0) throw new CliError(`git ${args[0]} failed in ${root}`);
  return stdout;
};

const nulSeparated = (output: string): string[] => output.split('\0').filter(Boolean);

export const isRepository = (root: string): boolean =>
  git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';

/** The top of the working tree `root` is in. */
export const repositoryRoot = (root: string): string =>
  realpathSync(gitOrThrow(root, ['rev-parse', '--show-toplevel']).trim());

/** Where this repository's hooks live, honouring `core.hooksPath`. */
export const hooksDirectory = (root: string): string =>
  resolve(root, gitOrThrow(root, ['rev-parse', '--git-path', 'hooks']).trim());

/** Files added or changed in the index: what the next commit would record. */
export const stagedPaths = (root: string): string[] =>
  nulSeparated(
    gitOrThrow(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--relative', '-z'])
  );

/** Every file in the index. */
export const trackedPaths = (root: string): string[] => nulSeparated(gitOrThrow(root, ['ls-files', '-z']));

/**
 * The subset of `paths` the ignore rules match. `--no-index` asks about the rules alone, so a
 * file that was force-added, and is therefore tracked, is still reported.
 */
export const ignoredPaths = (root: string, paths: string[]): string[] => {
  if (!paths.length) return [];
  const { status, stdout } = git(root, ['check-ignore', '--no-index', '-z', '--stdin'], paths.join('\0'));
  // 0: some are ignored. 1: none are. Anything else is git failing.
  if (status > 1) throw new CliError(`git check-ignore failed in ${root}`);
  return nulSeparated(stdout);
};

/** The value of a gitattribute for a path: "lfs", "unspecified", … */
export const attributeOf = (root: string, attribute: string, path: string): string =>
  gitOrThrow(root, ['check-attr', attribute, '--', path]).trim().split(': ').pop() ?? '';

/**
 * The first bytes of a file as it is in the index: what a commit would record, which is not
 * always what is in the working tree. Only the head is read, however large the blob.
 */
export const indexedHead = async (root: string, path: string, length: number): Promise<Buffer> => {
  const child = spawn('git', ['cat-file', 'blob', `:./${path}`], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on('error', () => resolve(null));
    child.on('close', resolve);
  });
  try {
    const head = Buffer.from((await new ByteReader(child.stdout).fill(length)).subarray(0, length));
    // Nothing read is an empty file only if git says so: a git that failed must not pass for one.
    if (!head.length && (await exited) !== 0) throw new CliError(`cannot read ${path} from the git index`);
    return head;
  } finally {
    child.stdout.destroy();
    child.kill();
  }
};
