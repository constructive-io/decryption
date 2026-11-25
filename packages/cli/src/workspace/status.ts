import { statSync } from 'fs';

import { messageFor } from '../utils/errors';
import { count } from '../utils/text';
import { BundleInfo, inspectBundle, LfsPointerError } from './bundle';
import { Section } from './layout';
import { Snapshot, snapshotSection } from './manifest';
import { SectionRecord } from './state';

/** Where a section's plaintext and its bundle stand relative to each other. */
export type SectionState =
  /** Plaintext and bundle are the pair this machine last wrote or read. */
  | 'in sync'
  /** The plaintext was edited and has not been encrypted again. */
  | 'plaintext changed'
  /** The bundle is newer than the plaintext: someone else encrypted it. */
  | 'bundle changed'
  /** Both changed since they last agreed. */
  | 'conflict'
  /** There is a bundle and no plaintext. */
  | 'not decrypted'
  /** There is plaintext and no bundle. */
  | 'not encrypted'
  /** Both exist, and this machine has no record of them agreeing. */
  | 'unknown'
  /** The bundle is a Git LFS pointer. */
  | 'not downloaded'
  /** The bundle is not a file dcrypt can read: its header is damaged, cut short or unsupported. */
  | 'bundle unreadable'
  /** The folder cannot be recorded: it holds a link, or a name a bundle cannot store. */
  | 'plaintext unreadable'
  /** Neither exists. */
  | 'missing';

export interface SectionReport {
  section: Section;
  state: SectionState;
  snapshot?: Snapshot;
  bundle?: BundleInfo;
  /** Why it could not be read, in the two states that say it could not. */
  problem?: string;
  /** Fingerprints in `recipients.txt` that the bundle is not encrypted to. */
  missingRecipients: string[];
  /** Fingerprints the bundle is encrypted to that are not in `recipients.txt`. */
  extraRecipients: string[];
}

const exists = (path: string, kind: 'isFile' | 'isDirectory'): boolean => {
  try {
    return statSync(path)[kind]();
  } catch {
    return false;
  }
};

const stateOf = (
  snapshot: Snapshot | undefined,
  bundle: BundleInfo | undefined,
  record: SectionRecord | undefined
): SectionState => {
  if (!bundle) return snapshot ? 'not encrypted' : 'missing';
  if (!snapshot) return 'not decrypted';
  if (!record) return 'unknown';
  const plaintextSame = snapshot.digest === record.digest;
  const bundleSame = bundle.sha256 === record.bundle;
  if (plaintextSame) return bundleSame ? 'in sync' : 'bundle changed';
  return bundleSame ? 'plaintext changed' : 'conflict';
};

/**
 * Compares a section's plaintext, its bundle and what this machine remembers of them. Needs no
 * key: the plaintext is hashed, the bundle is hashed, and its header names its recipients.
 *
 * `recipients` is the fingerprints in `recipients.txt`, when there is one to compare against.
 *
 * It does not throw for a section it cannot read: that is a state of that section, with the
 * reason in `problem`, so that one bad section never hides the state of the others.
 */
export const inspectSection = async (
  section: Section,
  record?: SectionRecord,
  recipients?: string[]
): Promise<SectionReport> => {
  const unread = { section, missingRecipients: [] as string[], extraRecipients: [] as string[] };
  let snapshot: Snapshot | undefined;
  try {
    if (exists(section.directory, 'isDirectory')) snapshot = await snapshotSection(section.directory);
  } catch (error) {
    return { ...unread, state: 'plaintext unreadable', problem: messageFor(error) };
  }
  const report = { ...unread, snapshot };
  if (!exists(section.bundle, 'isFile')) return { ...report, state: stateOf(snapshot, undefined, record) };

  let bundle: BundleInfo;
  try {
    bundle = await inspectBundle(section.bundle);
  } catch (error) {
    if (error instanceof LfsPointerError) return { ...report, state: 'not downloaded' };
    return { ...report, state: 'bundle unreadable', problem: messageFor(error) };
  }
  return {
    ...report,
    bundle,
    state: stateOf(snapshot, bundle, record),
    missingRecipients: (recipients ?? []).filter((id) => !bundle.recipients.includes(id)),
    extraRecipients: recipients ? bundle.recipients.filter((id) => !recipients.includes(id)) : [],
  };
};

/** True when the bundle is not encrypted to exactly the people in `recipients.txt`. */
export const recipientsDiffer = (report: SectionReport): boolean =>
  report.missingRecipients.length + report.extraRecipients.length > 0;

const ADVICE: Record<SectionState, string> = {
  'in sync': '',
  'plaintext changed': 'run `dcrypt encrypt-section` to encrypt the changes',
  'bundle changed': 'run `dcrypt decrypt-workspace` to update the plaintext',
  conflict: 'the plaintext and the bundle have both changed since they last agreed',
  'not decrypted': 'run `dcrypt decrypt-workspace`',
  'not encrypted': 'run `dcrypt encrypt-section`',
  unknown: 'this machine has no record of it; run `dcrypt decrypt-workspace` to compare',
  'not downloaded': 'the bundle is a Git LFS pointer; run `git lfs pull`',
  'bundle unreadable': 'restore the bundle from git, or replace it with `dcrypt encrypt-section --force`',
  'plaintext unreadable': '',
  missing: 'there is no such folder and no such bundle',
};

/** What to say when the bundle is not encrypted to exactly the people in `recipients.txt`. */
const recipientAdvice = ({ missingRecipients, extraRecipients }: SectionReport): string => {
  const differences: string[] = [];
  if (missingRecipients.length) {
    differences.push(`${count(missingRecipients.length, 'recipient')} in recipients.txt cannot open it yet`);
  }
  if (extraRecipients.length) {
    differences.push(
      `it is still encrypted to ${count(extraRecipients.length, 'key')} no longer in recipients.txt`
    );
  }
  return differences.length ? `${differences.join(', and ')}; encrypt it again` : '';
};

/** One line on what a report means and what to do about it. Empty when there is nothing to do. */
export const adviceFor = (report: SectionReport): string =>
  [report.problem, ADVICE[report.state], recipientAdvice(report)].filter(Boolean).join('; ');
