import { Vault } from '@decryption/vault';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AccountManager,
  AuthClient,
  AuthClientFactory,
  VaultCredentials,
} from '../src';

jest.setTimeout(120000);

const MODULE_PATH = path.resolve(__dirname, '../../../pgpm-modules/dcrypt-vault');
const FAST = { t: 1, m: 8192, p: 1 };
const PASSPHRASE = 'a rather long master passphrase';
const ENDPOINT = 'http://auth.localhost:3000/graphql';

let nextKey = 0;

const factory: AuthClientFactory = (): AuthClient => ({
  signIn: async ({ email }) => ({
    userId: `user-${email}`,
    accessToken: `token-${email}`,
    accessTokenExpiresAt: null,
  }),
  signUp: async ({ email }) => ({
    userId: `user-${email}`,
    accessToken: `token-${email}`,
    accessTokenExpiresAt: null,
  }),
  signOut: async () => {},
  verifyPassword: async () => {},
  verifyTotp: async () => {},
  createApiKey: async (options) => {
    nextKey += 1;
    return {
      apiKey: `cnc_live_sk_${options.name}`,
      keyId: `key-${nextKey}`,
      expiresAt: null,
    };
  },
  revokeApiKey: async () => {},
  listPrincipals: async () => [],
  createPrincipal: async () => 'principal-1',
  deletePrincipal: async () => {},
});

let dir: string;
let vault: Vault;
let accounts: AccountManager;

const signIn = (email: string) =>
  accounts.signIn({ endpoint: ENDPOINT, email, password: 'hunter22' });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcrypt-credentials-'));
  vault = await Vault.open({
    file: path.join(dir, 'vault.dcrypt'),
    passphrase: PASSPHRASE,
    modulePath: MODULE_PATH,
    kdf: FAST,
  });
});

afterAll(async () => {
  await vault.discard();
  await fs.rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const kind of ['account', 'api_key'] as const) {
    for (const item of await vault.listItems({ kind })) {
      await vault.deleteItemForever(item.id);
    }
  }
  accounts = new AccountManager(vault, { createClient: factory });
});

describe('VaultCredentials', () => {
  it('serves the bearer of the one signed-in account', async () => {
    await signIn('dev@example.com');
    const credentials = new VaultCredentials(accounts);
    expect(await credentials.accountBearer()).toBe('token-dev@example.com');
  });

  it('serves nothing rather than guess when several accounts are signed in', async () => {
    await signIn('dev@example.com');
    await signIn('ops@example.com');

    expect(await new VaultCredentials(accounts).accountBearer()).toBeNull();
  });

  it('serves the named account even when several are signed in', async () => {
    const dev = await signIn('dev@example.com');
    await signIn('ops@example.com');

    const credentials = new VaultCredentials(accounts, { accountItemId: dev.itemId });
    expect(await credentials.accountBearer()).toBe('token-dev@example.com');
  });

  it('serves nothing once the account is signed out', async () => {
    const account = await signIn('dev@example.com');
    const credentials = new VaultCredentials(accounts, {
      accountItemId: account.itemId,
    });

    await accounts.signOut(account.itemId);
    expect(await credentials.accountBearer()).toBeNull();
  });

  it('hands over the key tagged for a database, and nothing else', async () => {
    const account = await signIn('dev@example.com');
    await accounts.createApiKey(account.itemId, {
      name: 'app-data',
      databaseId: 'db-1',
    });
    await accounts.createApiKey(account.itemId, { name: 'unrelated' });

    const credentials = new VaultCredentials(accounts);
    expect(await credentials.dataToken('db-1')).toEqual({
      token: 'cnc_live_sk_app-data',
      origin: 'vault',
    });
    expect(await credentials.dataToken('db-2')).toEqual({ token: null });
  });

  it('tags a key that already exists', async () => {
    const account = await signIn('dev@example.com');
    const key = await accounts.createApiKey(account.itemId, { name: 'ci' });
    expect(key.databaseId).toBeNull();

    await accounts.assignKeyToDatabase(key.itemId, 'db-9');

    const credentials = new VaultCredentials(accounts);
    expect((await credentials.dataToken('db-9')).token).toBe('cnc_live_sk_ci');
    expect((await accounts.listApiKeys())[0].databaseId).toBe('db-9');
  });

  it('serves a data token from a signed-out account, because a key is its own credential', async () => {
    const account = await signIn('dev@example.com');
    await accounts.createApiKey(account.itemId, { name: 'ci', databaseId: 'db-1' });
    await accounts.signOut(account.itemId);

    const credentials = new VaultCredentials(accounts);
    expect((await credentials.dataToken('db-1')).token).toBe('cnc_live_sk_ci');
    expect(await credentials.accountBearer()).toBeNull();
  });

  it('refuses when two keys claim the same database', async () => {
    const account = await signIn('dev@example.com');
    await accounts.createApiKey(account.itemId, { name: 'one', databaseId: 'db-1' });
    await accounts.createApiKey(account.itemId, { name: 'two', databaseId: 'db-1' });

    expect(await new VaultCredentials(accounts).dataToken('db-1')).toEqual({
      token: null,
    });
  });
});
