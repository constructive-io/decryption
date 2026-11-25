import { Identity } from '@decryption/keys';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';
import { relative } from 'path';

import { takeFirst, wantsHelp } from '../utils/dispatch';
import { CliError, EXIT, exitCodeFor, messageFor } from '../utils/errors';
import { emit } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { loadIdentity, readStoredIdentity } from '../utils/stash';
import { discardTemp } from '../utils/temp';
import { count } from '../utils/text';
import { encryptSection, extractSection, installExtraction, recoverSection } from '../workspace/bundle';
import { discoverSections, findWorkspace, resolveSection, Section, Workspace } from '../workspace/layout';
import { fingerprintOf, readWorkspaceRecipients, recipientWarnings } from '../workspace/recipients';
import { readState, recordSection } from '../workspace/state';
import { adviceFor, inspectSection, recipientsDiffer, SectionReport } from '../workspace/status';

const WORKSPACE_OPTIONS = `  --workspace <dir>       The workspace root (default: the nearest folder upwards with a
                          recipients.txt, otherwise the current folder)
  --json                  Machine-readable output
  --help, -h              Show this help message`;

export const encryptSectionUsage = `
Encrypt Section Command:

  dcrypt encrypt-section <name> [OPTIONS]

  Encrypt the folder <name> into <name>.tar.dcrypt, for everyone in recipients.txt.
  One section at a time, and only when you ask.

  The bundle is a single encrypted file: the names, sizes and number of the files
  inside it are not visible, only its total size. No passphrase is needed, because
  encrypting uses only public keys. Nothing is rewritten when nothing changed, and
  the bundle is replaced only once the new one is complete.

Options:
  --force                 Replace a bundle that changed since this machine last read it
${WORKSPACE_OPTIONS}

Examples:
  dcrypt encrypt-section finance
  dcrypt encrypt-section clients/northwind
`;

export const decryptWorkspaceUsage = `
Decrypt Workspace Command:

  dcrypt decrypt-workspace [name…] [OPTIONS]

  Decrypt every section of the workspace (or only the ones named) with your
  identity. You are asked for its passphrase once, and not at all when every
  section is already up to date.

  Each bundle is decrypted into a new folder and checked, file by file, against
  the manifest inside it. Only then does it replace the plaintext. A wrong
  passphrase, a damaged or truncated bundle, or an interrupt changes nothing.
  Plaintext you have edited and not yet encrypted is never replaced without --force.

Options:
  --force                 Replace plaintext that has changes the bundle does not have
  --passphrase-file <p>   Read the identity passphrase from a file
  --passphrase-stdin      Read the identity passphrase from stdin
${WORKSPACE_OPTIONS}

Examples:
  dcrypt decrypt-workspace
  dcrypt decrypt-workspace finance
`;

export const statusUsage = `
Status Command:

  dcrypt status [OPTIONS]

  Show where each section stands: in sync, plaintext changed and not yet
  encrypted, bundle changed and not yet decrypted, and whether a recipient in
  recipients.txt is missing from a bundle. Needs no passphrase.

Options:
${WORKSPACE_OPTIONS}
`;

const warn = (message: string): void => void process.stderr.write(`warning: ${message}\n`);

/** Finishes whatever a killed run left half-done, and says so when plaintext was put back. */
const recover = (section: Section): void => {
  if (recoverSection(section)) warn(`restored ${section.name} after an interrupted run`);
};

const STALE_BUNDLE: Partial<Record<SectionReport['state'], string>> = {
  'bundle changed': 'its bundle has changed since this machine last decrypted it',
  conflict: 'its bundle has changed since this machine last decrypted it',
  unknown: 'this machine has never decrypted its bundle, so it may hold changes you do not have',
  'not downloaded': 'its bundle is a Git LFS pointer (run `git lfs pull` first)',
  'bundle unreadable': 'its bundle cannot be read (restore it from git first)',
};

export const encryptSectionCommand = async (argv: ParsedArgs): Promise<void> => {
  if (wantsHelp(argv, encryptSectionUsage)) return;
  const { first: name, newArgv } = takeFirst(argv);
  if (!name || newArgv._.length) {
    throw new CliError('name one section: dcrypt encrypt-section <name>');
  }
  const workspace = findWorkspace(newArgv);
  const section = resolveSection(workspace, name);
  const recipients = readWorkspaceRecipients(workspace);
  recover(section);

  const report = await inspectSection(
    section,
    readState(workspace)[section.name],
    recipients.map((entry) => fingerprintOf(entry.recipient))
  );
  const { snapshot } = report;
  if (report.state === 'plaintext unreadable') throw new CliError(adviceFor(report));
  if (!snapshot) throw new CliError(`there is no folder ${section.directory} to encrypt`, EXIT.notFound);
  if (!snapshot.files.length) throw new CliError(`${section.directory} has no files to encrypt`);

  const bundle = relative(workspace.root, section.bundle);
  const summary = { section: section.name, bundle, files: snapshot.files.length, recipients: recipients.length };
  if (report.state === 'in sync' && !recipientsDiffer(report)) {
    emit(newArgv, { ...summary, changed: false }, () => `${section.name}: unchanged, ${bundle} is up to date`);
    return;
  }
  const stale = STALE_BUNDLE[report.state];
  if (stale && !newArgv.force) {
    throw new CliError(
      `${section.name} was not encrypted: ${stale}. Run \`dcrypt decrypt-workspace\`, or pass --force to replace the bundle with what is on this machine.`
    );
  }

  const sha256 = await encryptSection(section, snapshot, recipients.map((entry) => entry.recipient));
  await recordSection(workspace, section.name, { digest: snapshot.digest, bundle: sha256 });
  recipientWarnings(recipients).forEach(warn);
  emit(
    newArgv,
    { ...summary, changed: true },
    () =>
      `${section.name}: encrypted ${count(summary.files, 'file')} to ${count(summary.recipients, 'recipient')} → ${bundle}`
  );
};

type Result = 'decrypted' | 'updated' | 'unchanged' | 'kept' | 'failed';

interface Outcome {
  section: string;
  result: Result;
  detail: string;
}

/** One outcome per section. The first failure decides the command's exit code. */
class Outcomes {
  private readonly bySection = new Map<string, Outcome>();
  exitCode = 0;

  record(section: Section, result: Result, detail = ''): void {
    this.bySection.set(section.name, { section: section.name, result, detail });
  }

  fail(section: Section, detail: string, code: number = EXIT.usage): void {
    this.exitCode ||= code;
    this.record(section, 'failed', detail);
  }

  inOrder(sections: Section[]): Outcome[] {
    return sections.map((section) => this.bySection.get(section.name) as Outcome);
  }
}

/** A section whose bundle has to be decrypted to go further. */
interface Pending {
  report: SectionReport;
  /** Decrypt only to learn whether the plaintext already is the bundle's content. */
  compareOnly: boolean;
}

const FORCE_HINT =
  'pass --force to take the bundle, or `dcrypt encrypt-section --force` to keep what is here';

/**
 * Settles, without a key, every section that can be settled that way. Returns what a section
 * still needs when it needs its bundle decrypted, and undefined when it is done.
 */
const settle = (report: SectionReport, force: boolean, outcomes: Outcomes): Pending | undefined => {
  const { section } = report;
  const replace: Pending = { report, compareOnly: false };
  switch (report.state) {
    case 'in sync':
      return void outcomes.record(section, 'unchanged', 'in sync');
    case 'not decrypted':
    case 'bundle changed':
      return replace;
    case 'plaintext changed':
      return force ? replace : void outcomes.record(section, 'kept', 'it has changes that are not encrypted yet');
    case 'unknown':
      return force ? replace : { report, compareOnly: true };
    case 'conflict':
      return force
        ? replace
        : void outcomes.fail(section, `the plaintext and the bundle have both changed; ${FORCE_HINT}`);
    case 'bundle unreadable':
      return void outcomes.fail(section, adviceFor(report), EXIT.corrupt);
    case 'plaintext unreadable':
      return void outcomes.fail(section, adviceFor(report));
    default:
      return void outcomes.fail(section, adviceFor(report), EXIT.notFound);
  }
};

/** Keeps the sections this machine's identity can open. Public information: no passphrase yet. */
const openableBy = (mine: string, pending: Pending[], outcomes: Outcomes): Pending[] =>
  pending.filter(({ report }) => {
    const isRecipient = Boolean(report.bundle?.recipients.includes(mine));
    if (!isRecipient) {
      outcomes.fail(
        report.section,
        `this machine's identity (${mine}) is not one of its recipients`,
        EXIT.permission
      );
    }
    return isRecipient;
  });

/** Decrypts one section. Never throws: a failure is that section's outcome, not the command's. */
const decryptSection = async (
  workspace: Workspace,
  { report: { section, snapshot }, compareOnly }: Pending,
  identity: Identity,
  outcomes: Outcomes
): Promise<void> => {
  try {
    const extraction = await extractSection(section, identity);
    const same = snapshot?.digest === extraction.digest;
    if (compareOnly && !same) {
      discardTemp(extraction.directory);
      outcomes.fail(
        section,
        `it differs from its bundle, and this machine has no record of which is newer; ${FORCE_HINT}`
      );
      return;
    }
    // Plaintext that already is what the bundle holds is left alone: there is nothing to swap.
    if (same) discardTemp(extraction.directory);
    else await installExtraction(section, extraction);
    await recordSection(workspace, section.name, { digest: extraction.digest, bundle: extraction.bundle });

    if (same) outcomes.record(section, 'unchanged', 'already matches its bundle');
    else outcomes.record(section, snapshot ? 'updated' : 'decrypted', count(extraction.manifest.files.length, 'file'));
  } catch (error) {
    outcomes.fail(section, messageFor(error), exitCodeFor(error));
  }
};

export const decryptWorkspaceCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  if (wantsHelp(argv, decryptWorkspaceUsage)) return;
  const workspace = findWorkspace(argv);
  const sections = argv._.length
    ? argv._.map((name) => resolveSection(workspace, String(name)))
    : discoverSections(workspace);
  if (!sections.length) {
    emit(argv, { workspace: workspace.root, sections: [] }, () => `no sections in ${workspace.root}`);
    return;
  }

  const state = readState(workspace);
  const outcomes = new Outcomes();
  const pending: Pending[] = [];
  for (const section of sections) {
    recover(section);
    const report = await inspectSection(section, state[section.name]);
    const next = settle(report, Boolean(argv.force), outcomes);
    if (next) pending.push(next);
  }

  const openable = pending.length
    ? openableBy(fingerprintOf(readStoredIdentity().recipient), pending, outcomes)
    : [];
  if (openable.length) {
    // The one prompt. A wrong passphrase fails here, before any bundle is opened.
    const identity = loadIdentity(await resolvePassphrase(argv, prompter, { message: 'Identity passphrase' }));
    try {
      for (const item of openable) await decryptSection(workspace, item, identity, outcomes);
    } finally {
      identity.privateKey.fill(0);
    }
  }

  const results = outcomes.inOrder(sections);
  const width = Math.max(...results.map((outcome) => outcome.section.length));
  emit(argv, { workspace: workspace.root, sections: results }, () =>
    results
      .map(({ section, result, detail }) => `${section.padEnd(width)}  ${result}${detail ? ` (${detail})` : ''}`)
      .join('\n')
  );
  const failures = results.filter((outcome) => outcome.result === 'failed').length;
  if (failures) {
    throw new CliError(
      `${count(failures, 'section')} could not be decrypted; ${failures === 1 ? 'its' : 'their'} plaintext was not changed`,
      outcomes.exitCode
    );
  }
};

export const statusCommand = async (argv: ParsedArgs): Promise<void> => {
  if (wantsHelp(argv, statusUsage)) return;
  const workspace = findWorkspace(argv);
  const state = readState(workspace);
  const recipients = readRecipientFingerprints(workspace);
  const reports: SectionReport[] = [];
  for (const section of discoverSections(workspace)) {
    reports.push(await inspectSection(section, state[section.name], recipients));
  }

  const sections = reports.map((report) => ({
    section: report.section.name,
    state: report.state,
    files: report.snapshot?.files.length,
    missingRecipients: report.missingRecipients,
    extraRecipients: report.extraRecipients,
    advice: adviceFor(report),
  }));
  const width = Math.max(0, ...sections.map(({ section }) => section.length));
  emit(argv, { workspace: workspace.root, sections }, () =>
    sections.length
      ? sections
        .map(({ section, state: current, advice }) =>
          `${section.padEnd(width)}  ${current}${advice ? ` — ${advice}` : ''}`
        )
        .join('\n')
      : `no sections in ${workspace.root}`
  );
};

/**
 * Fingerprints from recipients.txt, or undefined when there is none to compare against. One that
 * is there and cannot be used is worth a warning, and no reason to say nothing about the sections.
 */
const readRecipientFingerprints = (workspace: Workspace): string[] | undefined => {
  try {
    return readWorkspaceRecipients(workspace).map((entry) => fingerprintOf(entry.recipient));
  } catch (error) {
    if (exitCodeFor(error) !== EXIT.notFound) warn(messageFor(error));
    return undefined;
  }
};
