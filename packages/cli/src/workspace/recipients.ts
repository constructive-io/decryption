import { fingerprint, recipientFromString } from '@decryption/keys';
import { existsSync } from 'fs';

import { CliError, EXIT } from '../utils/errors';
import { readRecipientsFile, RecipientEntry } from '../utils/recipients';
import { hasIdentity, readStoredIdentity } from '../utils/stash';
import { Workspace } from './layout';

/** The fingerprint a bundle's header lists for this `dcrypt1…` recipient. */
export const fingerprintOf = (recipient: string): string => fingerprint(recipientFromString(recipient));

/** This machine's fingerprint, when it has an identity. Public: no passphrase is involved. */
export const ownFingerprint = (): string | undefined =>
  hasIdentity() ? fingerprintOf(readStoredIdentity().recipient) : undefined;

/** Everyone the workspace's sections are encrypted to. */
export const readWorkspaceRecipients = (workspace: Workspace): RecipientEntry[] => {
  if (!existsSync(workspace.recipientsFile)) {
    throw new CliError(
      `no recipients.txt in ${workspace.root}; create one with a "dcrypt1…" public key per line ("dcrypt keys show" prints yours)`,
      EXIT.notFound
    );
  }
  const entries = readRecipientsFile(workspace.recipientsFile);
  if (!entries.length) throw new CliError(`${workspace.recipientsFile} lists no recipients`);
  return entries;
};

/**
 * A recovery recipient is a key that lives on no working machine: kept offline, for the day
 * every laptop is gone. It is recognised by the word "recovery" in its label.
 */
export const isRecovery = (entry: RecipientEntry): boolean => /\brecovery\b/i.test(entry.label);

export const NO_RECOVERY_WARNING =
  'no recovery recipient: if every machine key is lost, nothing can decrypt these sections. ' +
  'Add a key that is kept offline to recipients.txt, with "recovery" in its label.';

/** What is worth saying about a set of recipients before encrypting to them. */
export const recipientWarnings = (entries: RecipientEntry[]): string[] => {
  const warnings: string[] = [];
  if (!entries.some(isRecovery)) warnings.push(NO_RECOVERY_WARNING);
  const mine = ownFingerprint();
  if (mine && !entries.some((entry) => fingerprintOf(entry.recipient) === mine)) {
    warnings.push(`this machine's identity (${mine}) is not in recipients.txt: it cannot decrypt what it encrypts.`);
  }
  return warnings;
};
