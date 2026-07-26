import { generateIdentity, identityFromSeed, recipientToString } from '@decryption/keys';
import { mnemonicToSeed } from '@decryption/wallet';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand } from '../utils/dispatch';
import { CliError } from '../utils/errors';
import { emit, readInput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { hasIdentity, identityPath, loadIdentity, readStoredIdentity, saveIdentity } from '../utils/stash';
import { resolveKdf } from './encrypt';

export const keysUsage = `
Keys Command:

  dcrypt keys <subcommand> [OPTIONS]

  Manage the X25519 identity used to share team secrets. The private key is stored
  encrypted under a passphrase in ~/.dcrypt/config/identity.json and is never printed.

Subcommands:
  generate                Create an identity (use --from-mnemonic to derive it from BIP39 words)
  show                    Print your public recipient string
  verify                  Check that your passphrase unlocks the stored identity

Options:
  --from-mnemonic         Derive the identity from a mnemonic instead of random bytes
  --identity-index <n>    Which identity to derive from the mnemonic  (default: 0)
  --in <file>             Read the mnemonic from a file ("-" for stdin)
  --force                 Overwrite an existing identity
  --kdf <profile>         interactive | moderate | sensitive   (default: moderate)
  --json                  Machine-readable output
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --help, -h              Show this help message

Examples:
  dcrypt keys generate
  dcrypt keys generate --from-mnemonic --in mnemonic.txt
  dcrypt keys show
`;

const generate = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  if (hasIdentity() && !argv.force) {
    throw new CliError(
      `an identity already exists at ${identityPath()}; pass --force to replace it (anything encrypted to the old one becomes unreadable)`
    );
  }
  const identity = argv['from-mnemonic'] || argv.fromMnemonic
    ? identityFromSeed(
      mnemonicToSeed(readInput(argv).trim()),
      Number(argv['identity-index'] ?? argv.identityIndex ?? 0)
    )
    : generateIdentity();

  const passphrase = await resolvePassphrase(argv, prompter, {
    confirm: true,
    message: 'Passphrase to protect the identity',
  });
  const stored = saveIdentity(identity, passphrase, resolveKdf(argv.kdf));
  identity.privateKey.fill(0);

  emit(argv, { recipient: stored.recipient, path: identityPath() }, () =>
    [`identity written to ${identityPath()}`, `recipient: ${stored.recipient}`].join('\n')
  );
};

const show = (argv: ParsedArgs): void => {
  const stored = readStoredIdentity();
  emit(argv, { recipient: stored.recipient }, () => stored.recipient);
};

const verify = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const passphrase = await resolvePassphrase(argv, prompter);
  const identity = loadIdentity(passphrase);
  const recipient = recipientToString(identity.publicKey);
  identity.privateKey.fill(0);
  emit(argv, { ok: true, recipient }, () => `ok — ${recipient}`);
};

export const keysCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  await runSubcommand(argv, prompter, {
    name: 'keys',
    usage: keysUsage,
    handlers: { generate, show, verify },
  });
};
