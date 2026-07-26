import { readFileSync, writeFileSync } from 'fs';
import { ParsedArgs } from 'minimist';

import { CliError, EXIT } from './errors';

/** Reads `--in <file>`, `-` (stdin), or the given inline value, in that order. */
export const readInput = (argv: ParsedArgs, inline?: string): string => {
  if (typeof argv.in === 'string' && argv.in.length) {
    if (argv.in === '-') return readStdin();
    try {
      return readFileSync(argv.in, 'utf8');
    } catch {
      throw new CliError(`cannot read ${argv.in}`, EXIT.notFound);
    }
  }
  if (inline === '-' || argv.stdin) return readStdin();
  if (inline !== undefined && inline !== '') return inline;
  if (!process.stdin.isTTY) return readStdin();
  throw new CliError('no input: pass a value, --in <file>, or pipe on stdin');
};

/** Writes to `--out <file>` when given, otherwise stdout. */
export const writeOutput = (argv: ParsedArgs, content: string): void => {
  const text = content.endsWith('\n') ? content : `${content}\n`;
  if (typeof argv.out === 'string' && argv.out.length) {
    writeFileSync(argv.out, text, { mode: 0o600 });
    return;
  }
  process.stdout.write(text);
};

/** Emits `--json` output, or the human-readable rendering. */
export const emit = (argv: ParsedArgs, data: unknown, human: () => string): void => {
  if (argv.json) {
    writeOutput(argv, JSON.stringify(data, null, 2));
    return;
  }
  writeOutput(argv, human());
};

/** True when the command should avoid printing secrets to a terminal. */
export const isTty = (): boolean => Boolean(process.stdout.isTTY);

export const readStdin = (): string => {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    throw new CliError('failed to read stdin');
  }
};
