import { combineToString, splitToStrings } from '@decryption/shamir';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { CliError } from '../utils/errors';
import { emit, readInput, writeOutput } from '../utils/io';

export const shamirUsage = `
Shamir Command:

  dcrypt shamir <subcommand> [OPTIONS]

  Split a secret into shares, any threshold of which reconstruct it. Shares are
  authenticated: a corrupt or foreign share fails loudly instead of producing garbage.

Subcommands:
  split                   Split a secret into shares
  combine                 Reconstruct a secret from shares

Options:
  --shares <n>            Number of shares to produce   (default: 5)
  --threshold <n>         Shares required to recover    (default: 3)
  --in <file>             Read the secret, or newline-separated shares, from a file ("-" for stdin)
  --share <value>         A share; repeat the flag once per share (combine)
  --out <file>            Write output to a file
  --json                  Machine-readable output
  --help, -h              Show this help message

Examples:
  dcrypt shamir split --in mnemonic.txt --shares 5 --threshold 3
  dcrypt shamir combine --share dcrypt-share.v1.… --share dcrypt-share.v1.…
  cat shares.txt | dcrypt shamir combine --in -
`;

const split = (argv: ParsedArgs): void => {
  const { first, newArgv } = takeFirst(argv);
  const secret = readInput(newArgv, first).trim();
  const shares = Number(newArgv.shares ?? 5);
  const threshold = Number(newArgv.threshold ?? 3);
  const produced = splitToStrings(secret, { shares, threshold });
  emit(newArgv, { shares: produced, threshold }, () => produced.join('\n'));
};

const combine = (argv: ParsedArgs): void => {
  const flags = argv.share ?? argv.shares;
  const shares = flags
    ? (Array.isArray(flags) ? flags : [flags]).map(String)
    : readInput(argv)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  if (shares.length < 2) {
    throw new CliError('at least two shares are required; pass --share once per share');
  }
  writeOutput(argv, combineToString(shares));
};

export const shamirCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  await runSubcommand(argv, prompter, {
    name: 'shamir',
    usage: shamirUsage,
    handlers: { split, combine },
  });
};
