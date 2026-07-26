import { armor, encrypt } from '@decryption/core';
import {
  assertValidMnemonic,
  createMnemonic,
  deriveAccount,
  isValidMnemonic,
  NETWORKS,
  WORD_COUNTS,
  WordCount,
} from '@decryption/wallet';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst, wantsHelp } from '../utils/dispatch';
import { CliError } from '../utils/errors';
import { emit, readInput, writeOutput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { resolveKdf } from './encrypt';

export const walletUsage = `
Wallet Command:

  dcrypt wallet <subcommand> [OPTIONS]

  Create BIP39 wallets and derive addresses. Entirely offline: this command never
  contacts a network, signs a transaction, or queries a balance.

Subcommands:
  create                  Generate a mnemonic and show its addresses
  address                 Derive an address from an existing mnemonic
  validate                Check a mnemonic's wordlist and checksum

Options:
  --words <n>             12, 15, 18, 21 or 24            (default: 24)
  --network <id>          Network id, repeatable          (default: cosmoshub)
  --account <n>           BIP44 account index             (default: 0)
  --index <n>             BIP44 address index             (default: 0)
  --path <path>           Explicit derivation path, overrides --account/--index
  --in <file>             Read the mnemonic from a file ("-" for stdin)
  --encrypt               Encrypt the new mnemonic and print the envelope instead
  --kdf <profile>         interactive | moderate | sensitive  (default: moderate)
  --out <file>            Write output to a file
  --json                  Machine-readable output
  --help, -h              Show this help message

Networks:
  ${Object.keys(NETWORKS).join(', ')}

Examples:
  dcrypt wallet create --words 12 --network osmosis --network ethereum
  dcrypt wallet create --encrypt --out wallet.dcrypt
  dcrypt wallet address --in mnemonic.txt --network cosmoshub --index 3
  echo "$MNEMONIC" | dcrypt wallet validate --in -
`;

const networksOf = (argv: ParsedArgs): string[] => {
  const value = argv.network ?? argv.networks ?? 'cosmoshub';
  return (Array.isArray(value) ? value : [value]).map(String);
};

const derivationOptions = (argv: ParsedArgs) => ({
  account: argv.account === undefined ? 0 : Number(argv.account),
  index: argv.index === undefined ? 0 : Number(argv.index),
  path: typeof argv.path === 'string' ? argv.path : undefined,
});

const create = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const words = Number(argv.words ?? 24) as WordCount;
  if (!(words in WORD_COUNTS)) {
    throw new CliError(`--words must be one of ${Object.keys(WORD_COUNTS).join(', ')}`);
  }
  const mnemonic = createMnemonic(words);
  const accounts = networksOf(argv).map((network) =>
    deriveAccount(mnemonic, network, derivationOptions(argv))
  );

  if (argv.encrypt) {
    const passphrase = await resolvePassphrase(argv, prompter, {
      confirm: true,
      message: 'Passphrase to encrypt the new mnemonic',
    });
    const envelope = armor(encrypt(mnemonic, passphrase, { kdf: resolveKdf(argv.kdf) }));
    emit(argv, { accounts, mnemonic: envelope }, () =>
      [...accounts.map((account) => `${account.network}\t${account.address}`), '', envelope].join('\n')
    );
    return;
  }

  emit(argv, { mnemonic, accounts }, () =>
    [
      mnemonic,
      '',
      ...accounts.map((account) => `${account.network}\t${account.path}\t${account.address}`),
    ].join('\n')
  );
};

const address = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const mnemonic = await readMnemonic(argv, prompter);
  const accounts = networksOf(argv).map((network) =>
    deriveAccount(mnemonic, network, derivationOptions(argv))
  );
  emit(argv, { accounts }, () =>
    accounts.map((account) => `${account.network}\t${account.path}\t${account.address}`).join('\n')
  );
};

const validate = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const mnemonic = await readMnemonic(argv, prompter);
  if (argv.json) {
    let reason: string | null = null;
    try {
      assertValidMnemonic(mnemonic);
    } catch (error) {
      reason = (error as Error).message;
    }
    writeOutput(argv, JSON.stringify({ valid: reason === null, reason }, null, 2));
    if (reason) throw new CliError(reason);
    return;
  }
  assertValidMnemonic(mnemonic);
  writeOutput(argv, `valid (${mnemonic.split(' ').length} words)`);
};

const readMnemonic = async (argv: ParsedArgs, prompter: Inquirerer): Promise<string> => {
  const { first, newArgv } = takeFirst(argv);
  if (first || newArgv.in || !process.stdin.isTTY) return readInput(newArgv, first).trim();
  const { mnemonic } = await prompter.prompt<{ mnemonic: string }>({} as { mnemonic: string }, [
    { type: 'password', name: 'mnemonic', message: 'Mnemonic', required: true },
  ]);
  return String(mnemonic).trim();
};

export const walletCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  if (wantsHelp(argv, walletUsage) && !argv._.length) return;
  await runSubcommand(argv, prompter, {
    name: 'wallet',
    usage: walletUsage,
    handlers: { create, address, validate },
  });
};

export const isMnemonicValid = isValidMnemonic;
