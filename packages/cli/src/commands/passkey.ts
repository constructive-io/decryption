import { Vault } from '@decryption/vault';
import { PasskeyRecord, PasskeyStore } from '@decryption/webauthn';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { CliError, EXIT } from '../utils/errors';
import { emit, readStdin } from '../utils/io';
import { openVault } from './vault';

export const passkeyUsage = `
Passkey Command:

  dcrypt passkey <subcommand> [OPTIONS]

  Passkeys held in the vault. dcrypt is the authenticator: it makes the key,
  keeps the private half encrypted, and signs the challenges a site sends. A
  passkey signs only for the site it was made for, so it cannot be phished.

Subcommands:
  list [site]             List stored passkeys, optionally for one site
  register <site>         Create a passkey for a site and print the registration
  assert <site>           Sign a sign-in challenge with the site's passkey
  forget <site>           Delete a passkey from the vault

Options:
  --challenge <b64url>    The challenge the site issued (or --challenge-stdin)
  --challenge-stdin       Read the challenge from stdin
  --origin <url>          Origin to sign, defaults to https://<site>
  --user <name>           Account name to register (default: the site's account)
  --credential <id>       Which passkey, when a site has more than one
  --json                  Machine-readable output — what a relying party expects
  --passphrase-file <p>   Read the master password from a file
  --help, -h              Show this help message

The response is printed as the JSON a WebAuthn relying party expects, so it can
be piped straight into one:

  dcrypt passkey register auth.example.com --user dev@example.com \\
    --challenge "$(cnc webauthn begin-registration)" --json | cnc webauthn finish
`;

const withPasskeys = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  run: (passkeys: PasskeyStore, vault: Vault) => Promise<void>
): Promise<void> => {
  const vault = await openVault(argv, prompter);
  try {
    await run(new PasskeyStore(vault), vault);
  } finally {
    await vault.lock();
  }
};

/**
 * The challenge is a public nonce, so unlike a password it is fine in argv —
 * but it is required: signing a challenge the caller invented proves nothing.
 */
const resolveChallenge = (argv: ParsedArgs): string => {
  if (argv['challenge-stdin'] || argv.challengeStdin) {
    return readStdin().trim();
  }
  const challenge = argv.challenge;
  if (typeof challenge !== 'string' || !challenge.length) {
    throw new CliError('a --challenge from the site is required');
  }
  return challenge;
};

const resolveOrigin = (argv: ParsedArgs, rpId: string): string =>
  typeof argv.origin === 'string' && argv.origin.length ? argv.origin : `https://${rpId}`;

const describe = (record: PasskeyRecord): string =>
  `${record.userName.padEnd(28)} ${record.rpId.padEnd(28)} used ${record.signCount}×`;

const find = async (
  passkeys: PasskeyStore,
  site: string,
  credentialId?: string
): Promise<PasskeyRecord> => {
  const matches = await passkeys.list(site);
  if (!matches.length) {
    throw new CliError(`no passkey for "${site}" in the vault`, EXIT.notFound);
  }
  if (!credentialId) {
    if (matches.length > 1) {
      throw new CliError(
        `${matches.length} passkeys for "${site}" — name one with --credential <id>`
      );
    }
    return matches[0];
  }
  const match = matches.find((record) => record.credentialId === credentialId);
  if (!match) throw new CliError(`no passkey ${credentialId} for "${site}"`, EXIT.notFound);
  return match;
};

const list = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  await withPasskeys(newArgv, prompter, async (passkeys) => {
    const all = await passkeys.list(first);
    emit(newArgv, all, () => all.map(describe).join('\n') || '(no passkeys)');
  });
};

const register = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('a site is required, e.g. auth.example.com');
  const challenge = resolveChallenge(newArgv);
  const userName = typeof newArgv.user === 'string' ? newArgv.user : first;

  await withPasskeys(newArgv, prompter, async (passkeys) => {
    const { record, response } = await passkeys.register({
      rpId: first,
      origin: resolveOrigin(newArgv, first),
      challenge,
      userName,
    });
    emit(
      newArgv,
      response,
      () => `registered ${record.userName} at ${record.rpId} (${record.credentialId})`
    );
  });
};

const assert = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('a site is required, e.g. auth.example.com');
  const challenge = resolveChallenge(newArgv);
  const credential =
    typeof newArgv.credential === 'string' ? newArgv.credential : undefined;

  await withPasskeys(newArgv, prompter, async (passkeys) => {
    const record = await find(passkeys, first, credential);
    const response = await passkeys.assert(record.itemId, {
      origin: resolveOrigin(newArgv, first),
      challenge,
    });
    emit(newArgv, response, () => `signed ${first}'s challenge as ${record.userName}`);
  });
};

const forget = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('a site is required');
  const credential =
    typeof newArgv.credential === 'string' ? newArgv.credential : undefined;

  await withPasskeys(newArgv, prompter, async (passkeys) => {
    const record = await find(passkeys, first, credential);
    await passkeys.forget(record.itemId);
    emit(newArgv, { credentialId: record.credentialId }, () =>
      `forgot ${record.userName}'s passkey for ${record.rpId}`
    );
  });
};

export const passkeyCommand = async (
  argv: ParsedArgs,
  prompter: Inquirerer
): Promise<void> =>
  runSubcommand(argv, prompter, {
    name: 'passkey',
    usage: passkeyUsage,
    handlers: { list, register, assert, forget },
  });
