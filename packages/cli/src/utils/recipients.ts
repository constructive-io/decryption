import { recipientFromString, recipientToString } from '@decryption/keys';
import { readFileSync } from 'fs';
import { ParsedArgs } from 'minimist';

import { CliError, EXIT, messageFor } from './errors';

/** One line of a recipients file. */
export interface RecipientEntry {
  /** Canonical `dcrypt1…` string. */
  recipient: string;
  /** Everything after the key on its line; free text, may be empty. */
  label: string;
  /** 1-based line number, for messages. */
  line: number;
}

/**
 * Parses a recipients file: one `dcrypt1…` public key per line, optionally followed by a label.
 * Blank lines and lines starting with `#` are ignored. Keys are public, so the file is safe to
 * commit.
 *
 * ```text
 * # who can open this
 * dcrypt1qxy…  ada (laptop)
 * dcrypt1qab…  recovery — printed, in the safe
 * ```
 */
export const parseRecipients = (text: string, origin = 'recipients'): RecipientEntry[] => {
  const entries: RecipientEntry[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [key, ...rest] = line.split(/\s+/);
    let recipient: string;
    try {
      recipient = recipientToString(recipientFromString(key));
    } catch (error) {
      throw new CliError(`${origin}:${index + 1}: ${messageFor(error)}`);
    }
    if (seen.has(recipient)) return;
    seen.add(recipient);
    entries.push({ recipient, label: rest.join(' '), line: index + 1 });
  });
  return entries;
};

export const readRecipientsFile = (path: string): RecipientEntry[] => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new CliError(`cannot read recipients file ${path}`, EXIT.notFound);
  }
  return parseRecipients(text, path);
};

const values = (value: unknown, flag: string): string[] => {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    if (typeof item !== 'string' || !item.length) throw new CliError(`${flag} needs a value`);
    return item;
  });
};

/**
 * Recipients named on the command line: every `--recipient <dcrypt1…>` and every line of every
 * `--recipients-file <path>`, de-duplicated, in the order given.
 */
export const collectRecipients = (argv: ParsedArgs): string[] => {
  const direct = values(argv.recipient, '--recipient').map((value) => {
    try {
      return recipientToString(recipientFromString(value));
    } catch (error) {
      throw new CliError(`--recipient ${value}: ${messageFor(error)}`);
    }
  });
  const fromFiles = values(argv['recipients-file'] ?? argv.recipientsFile, '--recipients-file')
    .flatMap((path) => readRecipientsFile(path))
    .map((entry) => entry.recipient);
  return [...new Set([...direct, ...fromFiles])];
};
