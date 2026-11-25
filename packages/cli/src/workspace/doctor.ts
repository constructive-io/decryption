import { existsSync } from 'fs';

import { messageFor } from '../utils/errors';
import { readRecipientsFile, RecipientEntry } from '../utils/recipients';
import { count } from '../utils/text';
import { attributeOf, ignoredPaths, isRepository } from './git';
import { isHookInstalled, runGuard } from './guard';
import { BUNDLE_SUFFIX, discoverSections, Section, STATE_DIRECTORY, Workspace } from './layout';
import { fingerprintOf, isRecovery, NO_RECOVERY_WARNING, ownFingerprint } from './recipients';
import { readState } from './state';
import { adviceFor, inspectSection } from './status';

/**
 * `dcrypt doctor`: everything that should be true of a machine and a workspace before either is
 * trusted with a section. It reads; it changes nothing, and it never asks for a passphrase.
 */
const MINIMUM_NODE_MAJOR = 20;

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface Check {
  name: string;
  level: CheckLevel;
  message: string;
}

const check = (name: string, level: CheckLevel, message: string): Check => ({ name, level, message });

const nodeCheck = (): Check => {
  const version = process.versions.node;
  return Number(version.split('.')[0]) >= MINIMUM_NODE_MAJOR
    ? check('node', 'ok', `Node.js ${version}`)
    : check('node', 'fail', `Node.js ${version} is too old; ${MINIMUM_NODE_MAJOR} or newer is needed`);
};

const identityCheck = (mine: string | undefined): Check =>
  mine
    ? check('identity', 'ok', `this machine's identity is ${mine}`)
    : check('identity', 'fail', 'no identity on this machine; run `dcrypt keys generate`');

const readRecipients = (workspace: Workspace): RecipientEntry[] | Check => {
  if (!existsSync(workspace.recipientsFile)) {
    return check('recipients', 'fail', `no recipients.txt in ${workspace.root}`);
  }
  try {
    return readRecipientsFile(workspace.recipientsFile);
  } catch (error) {
    return check('recipients', 'fail', messageFor(error));
  }
};

const recipientChecks = (entries: RecipientEntry[], mine: string | undefined): Check[] => {
  if (!entries.length) return [check('recipients', 'fail', 'recipients.txt lists no recipients')];
  const checks = [check('recipients', 'ok', `recipients.txt lists ${count(entries.length, 'recipient')}`)];
  checks.push(
    entries.some(isRecovery)
      ? check('recovery', 'ok', 'there is a recovery recipient')
      : check('recovery', 'warn', NO_RECOVERY_WARNING)
  );
  if (entries.length === 1) {
    checks.push(check('recipients', 'warn', 'there is only one recipient: one lost key loses everything'));
  }
  if (mine && !entries.some((entry) => fingerprintOf(entry.recipient) === mine)) {
    checks.push(
      check('recipients', 'warn', `this machine's identity (${mine}) is not in recipients.txt`)
    );
  }
  return checks;
};

const sectionChecks = async (
  workspace: Workspace,
  sections: Section[],
  recipients: string[] | undefined
): Promise<Check[]> => {
  if (!sections.length) return [check('sections', 'ok', 'no sections are encrypted yet')];
  const state = readState(workspace);
  const checks: Check[] = [];
  for (const section of sections) {
    const report = await inspectSection(section, state[section.name], recipients);
    const advice = adviceFor(report);
    const level = report.problem ? 'fail' : advice ? 'warn' : 'ok';
    checks.push(check(`section ${section.name}`, level, advice ? `${report.state}: ${advice}` : report.state));
  }
  return checks;
};

const isIgnored = (workspace: Workspace, path: string): boolean =>
  ignoredPaths(workspace.root, [path]).length > 0;

const repositoryChecks = async (workspace: Workspace, sections: Section[]): Promise<Check[]> => {
  if (!isRepository(workspace.root)) {
    return [check('git', 'warn', 'not a git repository: nothing here checks what gets committed')];
  }
  const checks = [
    isHookInstalled(workspace)
      ? check('guard', 'ok', 'the pre-commit guard is installed')
      : check('guard', 'warn', 'no pre-commit guard; run `dcrypt guard install`'),
  ];

  const exposed = sections.filter((section) => !isIgnored(workspace, `${section.name}/file`));
  checks.push(
    exposed.length
      ? check(
        'gitignore',
        'fail',
        `git does not ignore the plaintext of: ${exposed.map((section) => section.name).join(', ')} (see \`dcrypt guard snippet gitignore\`)`
      )
      : check('gitignore', 'ok', 'git ignores the plaintext of every section')
  );
  if (!isIgnored(workspace, `${STATE_DIRECTORY}/state.json`)) {
    checks.push(check('gitignore', 'warn', `git does not ignore ${STATE_DIRECTORY}/`));
  }

  const outsideLfs = sections.filter(
    (section) => attributeOf(workspace.root, 'filter', section.name + BUNDLE_SUFFIX) !== 'lfs'
  );
  if (outsideLfs.length) {
    checks.push(
      check('lfs', 'warn', 'bundles are not stored with Git LFS (see `dcrypt guard snippet gitattributes`)')
    );
  }

  const { violations } = await runGuard(workspace, 'all');
  checks.push(
    violations.length
      ? check('tracked files', 'fail', `${count(violations.length, 'tracked file')} should not be in the repository; run \`dcrypt guard --all\``)
      : check('tracked files', 'ok', 'nothing tracked is plaintext')
  );
  return checks;
};

export const runDoctor = async (workspace: Workspace): Promise<Check[]> => {
  const mine = ownFingerprint();
  const recipients = readRecipients(workspace);
  const entries = Array.isArray(recipients) ? recipients : undefined;
  const sections = discoverSections(workspace);
  return [
    nodeCheck(),
    identityCheck(mine),
    ...(entries ? recipientChecks(entries, mine) : [recipients as Check]),
    ...(await sectionChecks(workspace, sections, entries?.map((entry) => fingerprintOf(entry.recipient)))),
    ...(await repositoryChecks(workspace, sections)),
  ];
};
