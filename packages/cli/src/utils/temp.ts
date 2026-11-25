import { randomBytes } from 'crypto';
import { rmSync } from 'fs';
import { basename, dirname, join } from 'path';

/**
 * Temporary files and directories that must not outlive the command.
 *
 * Output is always built next to its destination and renamed into place, so an interrupted run
 * leaves the destination exactly as it was. What an interrupt would leave behind is the
 * half-written temporary itself, which may hold plaintext; everything registered here is removed
 * on Ctrl-C and on termination.
 */
const live = new Set<string>();

const remove = (path: string): void => {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // best effort: there is nothing useful to do about a temp file that will not delete
  }
};

const onSignal = (signal: NodeJS.Signals): void => {
  for (const path of live) remove(path);
  live.clear();
  process.exit(signal === 'SIGINT' ? 130 : 143);
};

/** A sibling path of `target`, so that renaming onto `target` never crosses a filesystem. */
export const tempPathFor = (target: string): string =>
  join(dirname(target), `.${basename(target)}.dcrypt-tmp-${randomBytes(6).toString('hex')}`);

/** True for names produced by {@link tempPathFor}. */
export const isTempName = (name: string): boolean => /\.dcrypt-tmp-[0-9a-f]{12}$/.test(name);

/** Registers `path` for removal if the process is interrupted. */
export const trackTemp = (path: string): void => {
  if (live.size === 0) {
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  }
  live.add(path);
};

/** Forgets `path`: call once it has been renamed into place or removed. */
export const untrackTemp = (path: string): void => {
  live.delete(path);
  if (live.size === 0) {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
};

/** Removes a temporary path now and forgets it. */
export const discardTemp = (path: string): void => {
  remove(path);
  untrackTemp(path);
};
