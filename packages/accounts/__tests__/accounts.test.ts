import { Vault } from '@decryption/vault';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AccountManager,
  AuthClient,
  AuthClientFactory,
  AuthError,
  CreateApiKeyOptions,
  hasExpired,
} from '../src';

jest.setTimeout(120000);

const MODULE_PATH = path.resolve(__dirname, '../../../pgpm-modules/dcrypt-vault');
const FAST = { t: 1, m: 8192, p: 1 };
const PASSPHRASE = 'a rather long master passphrase';
const ENDPOINT = 'http://auth.localhost:3000/graphql';

/** Records what the manager asked the server to do, and with which bearer. */
class FakeServer {
  readonly calls: Array<{ operation: string; token?: string }> = [];
  private nextKey = 0;
  expiresAt: string | null = null;

  factory: AuthClientFactory = ({ token }): AuthClient => ({
    signIn: async ({ email, password }) => {
      this.calls.push({ operation: 'signIn', token });
      if (password !== 'hunter22') {
        throw new AuthError('signIn', 'invalid email or password');
      }
      return {
        userId: `user-${email}`,
        accessToken: `token-${email}`,
        accessTokenExpiresAt: this.expiresAt,
      };
    },
    signUp: async ({ email }) => {
      this.calls.push({ operation: 'signUp', token });
      return {
        userId: `user-${email}`,
        accessToken: `token-${email}`,
        accessTokenExpiresAt: this.expiresAt,
      };
    },
    signOut: async () => {
      this.calls.push({ operation: 'signOut', token });
    },
    createApiKey: async (options: CreateApiKeyOptions) => {
      this.calls.push({ operation: 'createApiKey', token });
      this.nextKey += 1;
      return {
        apiKey: `cnc_live_sk_${options.name}`,
        keyId: `key-${this.nextKey}`,
        expiresAt: null,
      };
    },
    revokeApiKey: async (keyId: string) => {
      this.calls.push({ operation: `revokeApiKey:${keyId}`, token });
    },
  });
}

let dir: string;
let vault: Vault;
let server: FakeServer;
let accounts: AccountManager;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dcrypt-accounts-'));
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
  for (const item of await vault.listItems({ kind: 'account' })) {
    await vault.deleteItemForever(item.id);
  }
  for (const item of await vault.listItems({ kind: 'api_key' })) {
    await vault.deleteItemForever(item.id);
  }
  server = new FakeServer();
  accounts = new AccountManager(vault, { createClient: server.factory });
});

describe('AccountManager', () => {
  it('signs in and keeps the token concealed in the vault', async () => {
    const account = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });

    expect(account.userId).toBe('user-dev@example.com');
    expect(account.signedIn).toBe(true);
    expect(await accounts.accessToken(account.itemId)).toBe('token-dev@example.com');

    const fields = await vault.listFields(account.itemId);
    const token = fields.find((field) => field.name === 'access_token');
    expect(token?.purpose).toBe('token');
    expect(token?.concealed).toBe(true);
    expect(fields.find((field) => field.name === 'email')?.concealed).toBe(false);
  });

  it('surfaces the server error rather than storing a half account', async () => {
    await expect(
      accounts.signIn({
        endpoint: ENDPOINT,
        email: 'dev@example.com',
        password: 'wrong',
      })
    ).rejects.toThrow('invalid email or password');
    expect(await accounts.listAccounts()).toHaveLength(0);
  });

  it('refreshes the same item when signing in again', async () => {
    const first = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });
    const second = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });

    expect(second.itemId).toBe(first.itemId);
    expect(await accounts.listAccounts()).toHaveLength(1);
  });

  it('keeps accounts with the same email on different endpoints apart', async () => {
    await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });
    await accounts.signIn({
      endpoint: 'https://auth.example.com/graphql',
      email: 'dev@example.com',
      password: 'hunter22',
    });

    expect(await accounts.listAccounts()).toHaveLength(2);
  });

  it('reports an expired token as signed out and refuses to use it', async () => {
    server.expiresAt = '2020-01-01T00:00:00.000Z';
    const account = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });

    expect(account.signedIn).toBe(false);
    expect(await accounts.accessToken(account.itemId)).toBeNull();
    await expect(
      accounts.createApiKey(account.itemId, { name: 'ci' })
    ).rejects.toThrow('signed out');
  });

  it('signs out server-side and forgets the token', async () => {
    const account = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });
    await accounts.signOut(account.itemId);

    expect(server.calls).toContainEqual({
      operation: 'signOut',
      token: 'token-dev@example.com',
    });
    expect(await accounts.accessToken(account.itemId)).toBeNull();
    expect((await accounts.getAccount(account.itemId)).signedIn).toBe(false);
  });

  it('mints an API key with the account bearer and stores only the vault copy', async () => {
    const account = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });
    const key = await accounts.createApiKey(account.itemId, {
      name: 'ci',
      expiresIn: { days: 30 },
    });

    expect(server.calls).toContainEqual({
      operation: 'createApiKey',
      token: 'token-dev@example.com',
    });
    expect(Object.keys(key)).not.toContain('apiKey');
    expect(await accounts.revealApiKey(key.itemId)).toBe('cnc_live_sk_ci');
    expect(await accounts.listApiKeys(account.itemId)).toHaveLength(1);
  });

  it('revokes server-side before deleting the local key', async () => {
    const account = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });
    const key = await accounts.createApiKey(account.itemId, { name: 'ci' });
    await accounts.revokeApiKey(key.itemId);

    expect(server.calls).toContainEqual({
      operation: `revokeApiKey:${key.keyId}`,
      token: 'token-dev@example.com',
    });
    expect(await accounts.listApiKeys()).toHaveLength(0);
  });

  it('forgetting an account takes its keys with it', async () => {
    const account = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });
    await accounts.createApiKey(account.itemId, { name: 'ci' });
    await accounts.forget(account.itemId);

    expect(await accounts.listAccounts()).toHaveLength(0);
    expect(await accounts.listApiKeys()).toHaveLength(0);
  });

  it('survives a lock and reopen', async () => {
    const account = await accounts.signIn({
      endpoint: ENDPOINT,
      email: 'dev@example.com',
      password: 'hunter22',
    });
    await vault.save();

    const reopened = await Vault.open({
      file: path.join(dir, 'vault.dcrypt'),
      passphrase: PASSPHRASE,
      modulePath: MODULE_PATH,
      kdf: FAST,
    });
    const again = new AccountManager(reopened, { createClient: server.factory });
    expect(await again.accessToken(account.itemId)).toBe('token-dev@example.com');
    await reopened.discard();
  });
});

describe('hasExpired', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('treats a missing expiry as still valid', () => {
    expect(hasExpired(null, now)).toBe(false);
  });

  it('treats the exact expiry instant as expired', () => {
    expect(hasExpired('2026-01-01T00:00:00.000Z', now)).toBe(true);
  });

  it('accepts a future expiry', () => {
    expect(hasExpired('2026-01-02T00:00:00.000Z', now)).toBe(false);
  });
});
