import { existsSync, readdirSync, statSync } from 'fs';
import { ParsedArgs } from 'minimist';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';

import { CliError, EXIT } from '../utils/errors';
import { isTempName } from '../utils/temp';

/**
 * Where things are in a workspace.
 *
 * ```text
 * <root>/
 *   recipients.txt        who can decrypt (public keys; committed)
 *   finance.tar.dcrypt    a section, encrypted (committed)
 *   finance/              the same section, decrypted (never committed)
 *   .dcrypt/state.json    what this machine last encrypted or decrypted (never committed)
 * ```
 *
 * A section is a folder and the bundle beside it; the bundle's name is the folder's name plus
 * `.tar.dcrypt`. Sections may sit in sub-folders, but not inside one another.
 */
export const BUNDLE_SUFFIX = '.tar.dcrypt';
export const RECIPIENTS_FILE = 'recipients.txt';
export const STATE_DIRECTORY = '.dcrypt';

/** Marks the previous plaintext of a section while a new one is being swapped in. */
export const REPLACED_MARKER = '.dcrypt-old-';

/** True for the temporary and set-aside folders a decryption works in. */
export const isLeftoverName = (name: string): boolean =>
  isTempName(name) || name.includes(REPLACED_MARKER);

/** Folders that are never searched for bundles. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', STATE_DIRECTORY]);

export interface Workspace {
  root: string;
  recipientsFile: string;
}

export interface Section {
  /** Path of the section relative to the workspace root, `/`-separated. */
  name: string;
  /** The plaintext folder. */
  directory: string;
  /** The encrypted bundle. */
  bundle: string;
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

/** The nearest folder, from `start` upwards, that has a recipients file. */
const findRoot = (start: string): string | undefined => {
  for (let directory = start; ; directory = dirname(directory)) {
    if (existsSync(join(directory, RECIPIENTS_FILE))) return directory;
    if (dirname(directory) === directory) return undefined;
  }
};

/**
 * The workspace a command applies to: `--workspace <dir>`, otherwise the nearest folder upwards
 * that has a `recipients.txt`, otherwise the current folder.
 */
export const findWorkspace = (argv: ParsedArgs): Workspace => {
  const given = argv.workspace;
  if (given !== undefined && (typeof given !== 'string' || !isDirectory(given))) {
    throw new CliError(`--workspace ${String(given)} is not a folder`, EXIT.notFound);
  }
  const root = given ? resolve(given) : (findRoot(process.cwd()) ?? process.cwd());
  return { root, recipientsFile: join(root, RECIPIENTS_FILE) };
};

const sectionAt = ({ root }: Workspace, directory: string): Section => ({
  name: relative(root, directory).split(sep).join('/'),
  directory,
  bundle: directory + BUNDLE_SUFFIX,
});

/**
 * The section a user named. The folder and the bundle are both accepted (`finance`, `finance/`,
 * `finance.tar.dcrypt`), relative to the current folder when that is inside the workspace and to
 * the workspace root otherwise.
 */
export const resolveSection = (workspace: Workspace, name: string): Section => {
  const base = isInside(workspace.root, process.cwd()) ? process.cwd() : workspace.root;
  const target = resolve(base, name.endsWith(BUNDLE_SUFFIX) ? name.slice(0, -BUNDLE_SUFFIX.length) : name);
  if (target === workspace.root || !isInside(workspace.root, target)) {
    throw new CliError(`"${name}" is not a folder inside the workspace ${workspace.root}`);
  }
  const section = sectionAt(workspace, target);
  if (section.name.split('/').some((part) => SKIPPED_DIRECTORIES.has(part) || isTempName(part))) {
    throw new CliError(`"${name}" cannot be a section`);
  }
  return section;
};

/** Every section that has a bundle, found by walking the workspace. Sorted by name. */
export const discoverSections = (workspace: Workspace): Section[] => {
  const sections: Section[] = [];
  const walk = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true });
    const bundles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(BUNDLE_SUFFIX))
      .map((entry) => join(directory, entry.name.slice(0, -BUNDLE_SUFFIX.length)))
      .filter((target) => basename(target).length > 0);
    sections.push(...bundles.map((target) => sectionAt(workspace, target)));

    // A section's plaintext is not searched: sections do not nest.
    const plaintext = new Set(bundles);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (plaintext.has(path) || isLeftoverName(entry.name)) continue;
      walk(path);
    }
  };
  walk(workspace.root);
  return sections.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};
