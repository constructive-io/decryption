import {
  AccountManager,
  AccountRecord,
  ApiKeyRecord,
  KeyLifetime,
  StepUpProof,
  StepUpRequiredError,
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
  key list [email]        List stored API keys
  key create <name>       Mint an API key for --account
  key reveal <name>       Print an API key secret
  key revoke <name>       Revoke server-side, then delete the local copy

Options:
  --endpoint <url>        Auth endpoint (or DCRYPT_AUTH_ENDPOINT)
  --account <email>       Which account a key command applies to
  --expires-days <n>      Lifetime for a new key (default: no expiry)
  --access-level <level>  Access level for a new key
  --password-file <path>  Read the account password from a file
  --password-stdin        Read the account password from stdin
  --json                  Machine-readable output
  --passphrase-file <p>   Read the master password from a file
  --help, -h              Show this help message

Examples:
  dcrypt account signin dev@example.com --endpoint http://auth.localhost:3000/graphql
  dcrypt account key create ci --account dev@example.com --expires-days 30
  dcrypt account key reveal ci
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

const keyCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> =>
  runSubcommand(argv, prompter, {
    name: 'account key',
    usage: accountUsage,
    handlers: {
      list: keyList,
      create: keyCreate,
      reveal: keyReveal,
      revoke: keyRevoke,
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
      key: keyCommand,
    },
  });
