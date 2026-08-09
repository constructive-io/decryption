import {
  AccountManager,
  AccountRecord,
  ApiKeyRecord,
  KeyLifetime,
  PrincipalRecord,
  StepUpProof,
  StepUpRequiredError,
  VaultCredentials,
} from '@decryption/accounts';
import { Vault } from '@decryption/vault';
import { readFileSync } from 'fs';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { fromEnv } from '../utils/env';
import { CliError, EXIT } from '../utils/errors';
import { emit, readStdin } from '../utils/io';
import { openVault } from './vault';

export const accountUsage = `
Account Command:

  dcrypt account <subcommand> [OPTIONS]

  Constructive accounts and their API keys, held in the local vault. This is the
  one part of dcrypt that talks to a server: the endpoint you name, nothing else.

Subcommands:
  list                    List the accounts in the vault
  signup <email>          Create an account on --endpoint, then store the session
  signin <email>          Sign in and store the session
  signout <email>         Sign out and drop the stored token
  forget <email>          Remove the account and its keys from the vault
  link-code <email> <code>  Answer this account's MFA step-ups with a vault code
  unlink-code <email>     Stop answering its step-ups from the vault
  key list [email]        List stored API keys
  key create <name>       Mint an API key for --account
  key reveal <name>       Print an API key secret
  key revoke <name>       Revoke server-side, then delete the local copy
  key assign <name> <db>  Serve this key as that database's data-plane token
  token [email]           Print the bearer a harness would be given
  principal list [email]  Scoped sub-identities, with their scopes and masks
  principal create <name> Create one scoped to --org
  principal delete <id>   Remove one server-side

Options:
  --endpoint <url>        Auth endpoint (or DCRYPT_AUTH_ENDPOINT)
  --account <email>       Which account a key command applies to
  --expires-days <n>      Lifetime for a new key (default: no expiry)
  --access-level <level>  Access level for a new key
  --database <id>         Tag a new key as that database's data-plane token
  --principal <id>        Mint the key as this principal, not as you
  --org <id>              Organization for a principal, or for an org key
  --read-only             The principal may only read
  --bypass-step-up        The principal may skip MFA step-up (for CI)
  --password-file <path>  Read the account password from a file
  --password-stdin        Read the account password from stdin
  --json                  Machine-readable output
  --passphrase-file <p>   Read the master password from a file
  --help, -h              Show this help message

Examples:
  dcrypt account signin dev@example.com --endpoint http://auth.localhost:3000/graphql
  dcrypt account key create ci --account dev@example.com --expires-days 30
  dcrypt account link-code dev@example.com "Constructive dev"
  dcrypt account key reveal ci
  dcrypt account token dev@example.com
  dcrypt account principal create ci-deploy --org <org-id> --read-only
  dcrypt account key create ci --principal <principal-id> --org <org-id>
`;

/**
 * The account password, never from argv — it would be visible in `ps` to every
 * process on the machine, exactly like the master passphrase.
 */
const resolveAccountPassword = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  confirm: boolean
): Promise<string> => {
  if (argv.password !== undefined) {
    throw new CliError(
      'refusing to read a password from argv (it is visible in `ps`); use --password-file <path> or --password-stdin'
    );
  }

  const file = argv['password-file'] ?? argv.passwordFile;
  if (typeof file === 'string' && file.length) {
    try {
      return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new CliError(`cannot read password file ${file}`, EXIT.notFound);
    }
  }

  const fromEnvironment = fromEnv('accountPassword');
  if (fromEnvironment !== undefined) return fromEnvironment.replace(/\r?\n$/, '');

  if (argv['password-stdin'] || argv.passwordStdin) {
    return readStdin().replace(/\r?\n$/, '');
  }

  const { accountPassword } = await prompter.prompt<{ accountPassword: string }>(
    {} as { accountPassword: string },
    [
      {
        type: 'password',
        name: 'accountPassword',
        message: 'Account password',
        required: true,
      },
    ]
  );
  if (!accountPassword) throw new CliError('an account password is required');

  if (confirm) {
    const { confirmation } = await prompter.prompt<{ confirmation: string }>(
      {} as { confirmation: string },
      [
        {
          type: 'password',
          name: 'confirmation',
          message: 'Confirm account password',
          required: true,
        },
      ]
    );
    if (confirmation !== accountPassword) {
      throw new CliError('the passwords do not match');
    }
  }

  return accountPassword;
};

const resolveEndpoint = (argv: ParsedArgs): string => {
  const endpoint =
    typeof argv.endpoint === 'string' ? argv.endpoint : fromEnv('authEndpoint');
  if (!endpoint) {
    throw new CliError('an --endpoint is required (or set DCRYPT_AUTH_ENDPOINT)');
  }
  return endpoint;
};

const withVault = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  run: (accounts: AccountManager, vault: Vault) => Promise<void>
): Promise<void> => {
  const vault = await openVault(argv, prompter);
  try {
    await run(new AccountManager(vault), vault);
  } finally {
    await vault.lock();
  }
};

const findAccount = async (
  accounts: AccountManager,
  ref: string
): Promise<AccountRecord> => {
  const all = await accounts.listAccounts();
  const match =
    all.find((account) => account.itemId === ref) ??
    all.find((account) => account.email === ref) ??
    all.find((account) => account.email.toLowerCase() === ref.toLowerCase());
  if (!match) throw new CliError(`no account "${ref}" in the vault`, EXIT.notFound);
  return match;
};

/**
 * The account a command applies to: the one named, or the only one there is.
 * Never a guess when the vault holds several.
 */
const resolveAccount = async (
  accounts: AccountManager,
  ref: string | undefined
): Promise<AccountRecord> => {
  if (ref) return findAccount(accounts, ref);
  const all = await accounts.listAccounts();
  if (all.length === 0) {
    throw new CliError('no account in the vault — sign in first', EXIT.notFound);
  }
  if (all.length > 1) {
    throw new CliError('name an account: the vault holds more than one');
  }
  return all[0];
};

const findKey = async (
  accounts: AccountManager,
  ref: string
): Promise<ApiKeyRecord> => {
  const all = await accounts.listApiKeys();
  const match =
    all.find((key) => key.itemId === ref) ??
    all.find((key) => key.keyId === ref) ??
    all.find((key) => key.name === ref);
  if (!match) throw new CliError(`no API key "${ref}" in the vault`, EXIT.notFound);
  return match;
};

const describe = (account: AccountRecord): string =>
  `${account.signedIn ? 'signed in ' : 'signed out'} ${account.email.padEnd(28)} ${account.endpoint}`;

const list = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> =>
  withVault(argv, prompter, async (accounts) => {
    const all = await accounts.listAccounts();
    emit(argv, all, () => all.map(describe).join('\n') || '(no accounts)');
  });

const authenticate = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  mode: 'signIn' | 'signUp'
): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('an email address is required');
  const endpoint = resolveEndpoint(newArgv);
  const password = await resolveAccountPassword(
    newArgv,
    prompter,
    mode === 'signUp'
  );

  await withVault(newArgv, prompter, async (accounts) => {
    const account = await accounts[mode]({ endpoint, email: first, password });
    emit(
      newArgv,
      account,
      () => `${mode === 'signUp' ? 'created' : 'signed in as'} ${account.email} (${account.userId})`
    );
  });
};

const signup = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> =>
  authenticate(argv, prompter, 'signUp');

const signin = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> =>
  authenticate(argv, prompter, 'signIn');

const signout = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('an account is required');
  await withVault(newArgv, prompter, async (accounts) => {
    const account = await findAccount(accounts, first);
    await accounts.signOut(account.itemId);
    emit(newArgv, { itemId: account.itemId }, () => `signed out ${account.email}`);
  });
};

const forget = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('an account is required');
  await withVault(newArgv, prompter, async (accounts) => {
    const account = await findAccount(accounts, first);
    await accounts.forget(account.itemId);
    emit(
      newArgv,
      { itemId: account.itemId },
      () => `removed ${account.email} and its keys from the vault`
    );
  });
};

/**
 * Point an account at a one-time code already in the vault, so the server's
 * MFA step-up is answered without a human reaching for a phone.
 */
const linkCode = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const { first: codeRef, newArgv: rest } = takeFirst(newArgv);
  if (!first) throw new CliError('an account is required');
  if (!codeRef) throw new CliError('a one-time code item is required');

  await withVault(rest, prompter, async (accounts, vault) => {
    const account = await findAccount(accounts, first);
    const codes = await vault.listItems({ kind: 'totp' });
    const code =
      codes.find((item) => item.id === codeRef) ??
      codes.find((item) => item.title === codeRef) ??
      codes.find((item) => item.title.toLowerCase() === codeRef.toLowerCase());
    if (!code) {
      throw new CliError(`no one-time code "${codeRef}" in the vault`, EXIT.notFound);
    }

    await accounts.linkTotp(account.itemId, code.id);
    emit(
      rest,
      { itemId: account.itemId, totpItemId: code.id },
      () => `"${code.title}" will answer MFA for ${account.email}`
    );
  });
};

const unlinkCode = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('an account is required');
  await withVault(newArgv, prompter, async (accounts) => {
    const account = await findAccount(accounts, first);
    await accounts.unlinkTotp(account.itemId);
    emit(
      newArgv,
      { itemId: account.itemId },
      () => `${account.email} will ask for a code again`
    );
  });
};

const keyList = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  await withVault(newArgv, prompter, async (accounts) => {
    const accountItemId = first
      ? (await findAccount(accounts, first)).itemId
      : undefined;
    const keys = await accounts.listApiKeys(accountItemId);
    emit(
      newArgv,
      keys,
      () =>
        keys
          .map((key) => `${key.name.padEnd(24)} ${key.keyId} ${key.expiresAt ?? 'no expiry'}`)
          .join('\n') || '(no API keys)'
    );
  });
};

/**
 * Run something the server may refuse until a factor is re-proved: ask for the
 * factor it named, then run the identical call once more. Not a blanket retry —
 * only a `StepUpRequiredError` reaches here, and only one extra attempt is made.
 */
const withStepUp = async <T>(
  prompter: Inquirerer,
  run: (proof?: StepUpProof) => Promise<T>
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof StepUpRequiredError)) throw error;
    const mfa = error.kind === 'mfa';
    const { proof } = await prompter.prompt<{ proof: string }>({} as { proof: string }, [
      {
        type: mfa ? 'text' : 'password',
        name: 'proof',
        message: mfa
          ? 'The server wants a fresh one-time code'
          : 'The server wants your account password again',
        required: true,
      },
    ]);
    if (!proof) throw error;
    return run(mfa ? { totpCode: proof } : { password: proof });
  }
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length ? value : undefined;

const lifetime = (argv: ParsedArgs): KeyLifetime | undefined => {
  const raw = argv['expires-days'] ?? argv.expiresDays;
  if (raw === undefined) return undefined;
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0) {
    throw new CliError('--expires-days must be a positive whole number of days');
  }
  return { days };
};

const keyCreate = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('a key name is required');
  const accessLevel = newArgv['access-level'] ?? newArgv.accessLevel;
  await withVault(newArgv, prompter, async (accounts) => {
    const all = await accounts.listAccounts();
    const ref = typeof newArgv.account === 'string' ? newArgv.account : undefined;
    if (!ref && all.length === 0) {
      throw new CliError('no account in the vault — sign in first');
    }
    if (!ref && all.length > 1) {
      throw new CliError('--account is required when the vault holds more than one account');
    }
    const account = ref ? await findAccount(accounts, ref) : all[0];

    const request = {
      name: first,
      expiresIn: lifetime(newArgv),
      accessLevel: typeof accessLevel === 'string' ? accessLevel : undefined,
      databaseId: text(newArgv.database),
      principalId: text(newArgv.principal),
      orgId: text(newArgv.org),
    };
    const key = await withStepUp(prompter, (proof) =>
      accounts.createApiKey(account.itemId, request, proof)
    );
    emit(
      newArgv,
      key,
      () =>
        `created "${key.name}" (${key.keyId}) — stored in the vault; read it with "dcrypt account key reveal ${key.name}"`
    );
  });
};

const keyReveal = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('a key name is required');
  await withVault(newArgv, prompter, async (accounts) => {
    const key = await findKey(accounts, first);
    const secret = await accounts.revealApiKey(key.itemId);
    emit(newArgv, { apiKey: secret }, () => secret);
  });
};

const keyRevoke = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('a key name is required');
  await withVault(newArgv, prompter, async (accounts) => {
    const key = await findKey(accounts, first);
    await withStepUp(prompter, (proof) => accounts.revokeApiKey(key.itemId, proof));
    emit(newArgv, { keyId: key.keyId }, () => `revoked "${key.name}" (${key.keyId})`);
  });
};

/**
 * Say that an existing key is a database's data-plane token, which is what a
 * harness host asks for by database id.
 */
const keyAssign = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const { first: databaseId, newArgv: rest } = takeFirst(newArgv);
  if (!first) throw new CliError('a key name is required');
  if (!databaseId) throw new CliError('a database id is required');
  await withVault(rest, prompter, async (accounts) => {
    const key = await findKey(accounts, first);
    await accounts.assignKeyToDatabase(key.itemId, databaseId);
    emit(
      rest,
      { itemId: key.itemId, databaseId },
      () => `"${key.name}" is now the data-plane token for ${databaseId}`
    );
  });
};

/**
 * The bearer a harness host would be handed. Printing a live token is the
 * point of the command, so it goes to stdout alone and nowhere else — but the
 * vault stays the only place it is stored.
 */
const token = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const databaseRef = newArgv.database;
  await withVault(newArgv, prompter, async (accounts) => {
    const accountItemId = first
      ? (await findAccount(accounts, first)).itemId
      : undefined;
    const credentials = new VaultCredentials(accounts, { accountItemId });

    if (typeof databaseRef === 'string' && databaseRef.length) {
      const result = await credentials.dataToken(databaseRef);
      if (!result.token) {
        throw new CliError(
          `no key in the vault is the data-plane token for ${databaseRef} — tag one with "dcrypt account key assign <name> ${databaseRef}"`,
          EXIT.notFound
        );
      }
      emit(newArgv, result, () => result.token as string);
      return;
    }

    const bearer = await credentials.accountBearer();
    if (!bearer) {
      throw new CliError(
        first
          ? `${first} is signed out — sign in again first`
          : 'name an account: a bearer is only served when exactly one account is signed in',
        EXIT.notFound
      );
    }
    emit(newArgv, { accountBearer: bearer }, () => bearer);
  });
};

/**
 * A principal's reach: the entities it touches, and the per-scope overrides
 * that narrow it. No override row means it simply inherits its owner there,
 * which is worth saying out loud rather than rendering an empty list.
 */
const describePrincipal = (principal: PrincipalRecord): string => {
  const flags = [
    principal.isReadOnly ? 'read-only' : null,
    principal.bypassStepUp ? 'skips step-up' : null,
    principal.useAdminOwner ? "inherits owner's admin" : null,
  ].filter(Boolean);
  const scopes = principal.scopes.length
    ? principal.scopes
      .map(
        (scope) =>
          `    scope ${scope.membershipType}: ${
            scope.isActive ? 'active' : 'disabled'
          }${scope.isReadOnly ? ', read-only' : ''}, mask ${
            scope.allowedMask ?? 'inherited'
          }`
      )
      .join('\n')
    : '    (no overrides — inherits the owner everywhere it is scoped)';
  return [
    `${principal.name.padEnd(24)} ${principal.principalId}`,
    `    ${flags.join(', ') || 'no flags'}`,
    `    entities: ${principal.entityIds.join(', ') || '(none)'}`,
    scopes,
  ].join('\n');
};

const principalList = async (
  argv: ParsedArgs,
  prompter: Inquirerer
): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  await withVault(newArgv, prompter, async (accounts) => {
    const account = await resolveAccount(accounts, first);
    const principals = await accounts.listPrincipals(account.itemId);
    emit(
      newArgv,
      principals,
      () => principals.map(describePrincipal).join('\n\n') || '(no principals)'
    );
  });
};

const principalCreate = async (
  argv: ParsedArgs,
  prompter: Inquirerer
): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('a principal name is required');
  const orgId = text(newArgv.org);
  if (!orgId) throw new CliError('--org <id> is required');

  await withVault(newArgv, prompter, async (accounts) => {
    const account = await resolveAccount(accounts, text(newArgv.account));
    const principalId = await withStepUp(prompter, (proof) =>
      accounts.createPrincipal(
        account.itemId,
        {
          name: first,
          orgId,
          isReadOnly: Boolean(newArgv['read-only'] ?? newArgv.readOnly),
          bypassStepUp: Boolean(newArgv['bypass-step-up'] ?? newArgv.bypassStepUp),
        },
        proof
      )
    );
    emit(
      newArgv,
      { principalId },
      () => `created "${first}" (${principalId}) — mint keys as it with --principal ${principalId}`
    );
  });
};

const principalDelete = async (
  argv: ParsedArgs,
  prompter: Inquirerer
): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('a principal id is required');
  await withVault(newArgv, prompter, async (accounts) => {
    const account = await resolveAccount(accounts, text(newArgv.account));
    await withStepUp(prompter, (proof) =>
      accounts.deletePrincipal(account.itemId, first, proof)
    );
    emit(newArgv, { principalId: first }, () => `removed ${first}`);
  });
};

const principalCommand = async (
  argv: ParsedArgs,
  prompter: Inquirerer
): Promise<void> =>
  runSubcommand(argv, prompter, {
    name: 'account principal',
    usage: accountUsage,
    handlers: {
      list: principalList,
      create: principalCreate,
      delete: principalDelete,
    },
  });

const keyCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> =>
  runSubcommand(argv, prompter, {
    name: 'account key',
    usage: accountUsage,
    handlers: {
      list: keyList,
      create: keyCreate,
      reveal: keyReveal,
      revoke: keyRevoke,
      assign: keyAssign,
    },
  });

export const accountCommand = async (
  argv: ParsedArgs,
  prompter: Inquirerer
): Promise<void> =>
  runSubcommand(argv, prompter, {
    name: 'account',
    usage: accountUsage,
    handlers: {
      list,
      signup,
      signin,
      signout,
      forget,
      'link-code': linkCode,
      'unlink-code': unlinkCode,
      key: keyCommand,
      principal: principalCommand,
      token,
    },
  });
