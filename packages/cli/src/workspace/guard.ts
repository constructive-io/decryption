import { ARMOR_PREFIX, FILE_ARMOR_PREFIX, MAGIC } from '@decryption/core';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { CliError } from '../utils/errors';
import { hooksDirectory, ignoredPaths, indexedHead, repositoryRoot, stagedPaths, trackedPaths } from './git';
import { BUNDLE_SUFFIX, discoverSections, Workspace } from './layout';
import { HOOK_MARKER, SNIPPETS } from './snippets';

/**
 * The pre-commit guard: looks at what a commit would record and refuses three things.
 *
 * 1. A file inside a section's plaintext folder.
 * 2. A `*.dcrypt` file that is not encrypted: a plain file given the name by mistake.
 * 3. A file the ignore rules cover, which can only be staged by forcing it past them.
 *
 * It reads the index, not the working tree: what matters is what would be committed.
 */
const ENCRYPTED_SUFFIX = '.dcrypt';
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/';
const HEAD_LENGTH = 64;

export type GuardScope = 'staged' | 'all';

export interface Violation {
  path: string;
  rule: 'plaintext' | 'not encrypted' | 'ignored';
  message: string;
}

export interface GuardResult {
  scope: GuardScope;
  checked: number;
  violations: Violation[];
}

const startsWith = (head: Buffer, prefix: Uint8Array | string): boolean =>
  head.subarray(0, prefix.length).equals(Buffer.from(prefix));

const isEnvelope = (head: Buffer): boolean =>
  startsWith(head, MAGIC) || startsWith(head, ARMOR_PREFIX) || startsWith(head, FILE_ARMOR_PREFIX);

const fileHead = (path: string): Buffer | undefined => {
  if (!existsSync(path)) return undefined;
  const head = Buffer.alloc(HEAD_LENGTH);
  const descriptor = openSync(path, 'r');
  try {
    return head.subarray(0, readSync(descriptor, head, 0, HEAD_LENGTH, 0));
  } finally {
    closeSync(descriptor);
  }
};

/**
 * True when what would be committed at `path` is ciphertext. With Git LFS the index holds a
 * pointer, so the file the pointer stands for is checked instead, when it is here to check.
 */
const isEncrypted = async (root: string, path: string): Promise<boolean> => {
  const head = await indexedHead(root, path, HEAD_LENGTH);
  if (!startsWith(head, LFS_POINTER_PREFIX)) return isEnvelope(head);
  const local = fileHead(join(root, path));
  return local === undefined || startsWith(local, LFS_POINTER_PREFIX) || isEnvelope(local);
};

/** Names of every section the repository knows: bundles on disk, staged, or tracked. */
const sectionNames = (workspace: Workspace, paths: string[]): string[] => {
  const fromGit = [...paths, ...trackedPaths(workspace.root)]
    .filter((path) => path.endsWith(BUNDLE_SUFFIX))
    .map((path) => path.slice(0, -BUNDLE_SUFFIX.length));
  const onDisk = discoverSections(workspace).map((section) => section.name);
  return [...new Set([...fromGit, ...onDisk])];
};

/** Checks the given paths (relative to the workspace root) as they stand in the index. */
export const checkPaths = async (workspace: Workspace, paths: string[]): Promise<Violation[]> => {
  const sections = sectionNames(workspace, paths);
  const ignored = new Set(ignoredPaths(workspace.root, paths));
  const violations: Violation[] = [];

  for (const path of paths) {
    const section = sections.find((name) => path.startsWith(`${name}/`));
    if (section) {
      violations.push({
        path,
        rule: 'plaintext',
        message: `plaintext of the encrypted section "${section}"; commit ${section}${BUNDLE_SUFFIX} instead`,
      });
    } else if (path.endsWith(ENCRYPTED_SUFFIX) && !(await isEncrypted(workspace.root, path))) {
      violations.push({
        path,
        rule: 'not encrypted',
        message: `named ${ENCRYPTED_SUFFIX} but its content is not a dcrypt envelope`,
      });
    } else if (ignored.has(path)) {
      violations.push({
        path,
        rule: 'ignored',
        message: 'covered by .gitignore, so it was added by force; it is not on the allow-list',
      });
    }
  }
  return violations;
};

/** Runs the guard over what is staged, or over everything tracked. */
export const runGuard = async (workspace: Workspace, scope: GuardScope): Promise<GuardResult> => {
  const paths = scope === 'staged' ? stagedPaths(workspace.root) : trackedPaths(workspace.root);
  return { scope, checked: paths.length, violations: await checkPaths(workspace, paths) };
};

const hookPath = (workspace: Workspace): string => join(hooksDirectory(workspace.root), 'pre-commit');

/** True when this repository's pre-commit hook is the one `dcrypt guard install` writes. */
export const isHookInstalled = (workspace: Workspace): boolean => {
  const path = hookPath(workspace);
  return existsSync(path) && readFileSync(path, 'utf8').includes(HOOK_MARKER);
};

/**
 * Installs the pre-commit hook. A hook that is already there and is not ours is left alone
 * unless `force` is set.
 */
export const installHook = (workspace: Workspace, force = false): string => {
  if (repositoryRoot(workspace.root) !== realpathSync(workspace.root)) {
    throw new CliError(
      `the workspace ${workspace.root} is not the top of its git repository; the hook runs from the top, so call "dcrypt guard --staged --workspace <dir>" from your own pre-commit hook instead`
    );
  }
  const path = hookPath(workspace);
  if (existsSync(path) && !isHookInstalled(workspace) && !force) {
    throw new CliError(
      `${path} already exists and was not written by dcrypt; add "dcrypt guard --staged" to it, or pass --force to replace it`
    );
  }
  mkdirSync(hooksDirectory(workspace.root), { recursive: true });
  writeFileSync(path, SNIPPETS.hook.text);
  chmodSync(path, 0o755);
  return path;
};
