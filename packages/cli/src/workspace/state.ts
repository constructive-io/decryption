import { existsSync, readFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';

import { writeFileAtomically } from '../utils/bytes';
import { STATE_DIRECTORY, Workspace } from './layout';

/**
 * What this machine last encrypted or decrypted, per section.
 *
 * Comparing a section against its bundle would otherwise need the bundle decrypted, and so a
 * passphrase. Remembering the two hashes that were in agreement the last time lets `status` and
 * an unchanged `encrypt-section` answer without one. The file is local, holds only hashes, and is
 * never committed; losing it loses nothing but that shortcut.
 */
const STATE_VERSION = 1;

export interface SectionRecord {
  /** Digest of the manifest the plaintext and the bundle agreed on. */
  digest: string;
  /** SHA-256 of the bundle file at that moment. */
  bundle: string;
}

export type State = Record<string, SectionRecord>;

export const statePath = (workspace: Workspace): string =>
  join(workspace.root, STATE_DIRECTORY, 'state.json');

const isRecord = (value: unknown): value is SectionRecord => {
  const record = value as SectionRecord;
  return (
    typeof record === 'object' &&
    record !== null &&
    typeof record.digest === 'string' &&
    typeof record.bundle === 'string'
  );
};

/** Reads the state. A missing or unreadable file is an empty one: every section is then unknown. */
export const readState = (workspace: Workspace): State => {
  const path = statePath(workspace);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.version !== STATE_VERSION || typeof parsed.sections !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed.sections ?? {}).filter(([, value]) => isRecord(value))) as State;
  } catch {
    return {};
  }
};

/** Records that `name`'s plaintext and bundle agree, replacing what was known about it. */
export const recordSection = async (
  workspace: Workspace,
  name: string,
  record: SectionRecord
): Promise<void> => {
  const sections = { ...readState(workspace), [name]: record };
  const sorted = Object.fromEntries(Object.entries(sections).sort(([a], [b]) => (a < b ? -1 : 1)));
  const path = statePath(workspace);
  await mkdir(join(workspace.root, STATE_DIRECTORY), { recursive: true });
  const text = JSON.stringify({ version: STATE_VERSION, sections: sorted }, null, 2) + '\n';
  await writeFileAtomically(path, [Buffer.from(text, 'utf8')]);
};
