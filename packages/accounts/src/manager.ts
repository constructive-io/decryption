import { Vault, VaultItem } from '@decryption/vault';

import {
  AuthClient,
  AuthClientFactory,
  AuthError,
  sdkAuthClient,
  SignInInput,
  StepUpProof,
  StepUpRequiredError,
} from './client';
import { normalizeEndpoint } from './endpoint';
import {
  AccountRecord,
  ApiKeyRecord,
  AuthSession,
  CreateApiKeyOptions,
} from './types';

const ACCOUNT_FIELDS = {
  endpoint: 'endpoint',
  email: 'email',
  userId: 'user_id',
  accessToken: 'access_token',
  expiresAt: 'access_token_expires_at',
} as const;

const KEY_FIELDS = {
  endpoint: 'endpoint',
  accountId: 'account_id',
  keyId: 'key_id',
  apiKey: 'api_key',
  expiresAt: 'expires_at',
} as const;

export interface AccountManagerOptions {
  /** Swap the transport — tests pass a fake, hosts pass the SDK client. */
  createClient?: AuthClientFactory;
  /** Clock, injectable so expiry logic is testable. */
  now?: () => Date;
}

export interface SignInOptions extends SignInInput {
  endpoint: string;
}

/** True when `iso` is a timestamp already in the past. */
export const hasExpired = (iso: string | null, now: Date): boolean =>
  iso !== null && Date.parse(iso) <= now.getTime();

const hostOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
};

/**
 * Constructive accounts and API keys, stored as vault items.
 *
 * Nothing is kept outside the vault: the access token and every API key secret
 * are concealed fields in the same encrypted file as the rest of the vault, so
 * they are covered by the master passphrase, by lock, and by backup/restore.
 */
export class AccountManager {
  private readonly createClient: AuthClientFactory;
  private readonly now: () => Date;

  constructor(
    private readonly vault: Vault,
    options: AccountManagerOptions = {}
  ) {
    this.createClient = options.createClient ?? sdkAuthClient;
    this.now = options.now ?? (() => new Date());
  }

  // ─── accounts ─────────────────────────────────────────────────────────────

  /** Sign in against `endpoint` and store (or refresh) the account. */
  async signIn(options: SignInOptions): Promise<AccountRecord> {
    const endpoint = normalizeEndpoint(options.endpoint);
    const session = await this.createClient({ endpoint }).signIn(options);
    return this.adopt(endpoint, options.email, session);
  }

  /** Create an account on `endpoint`, then store the session it returns. */
  async signUp(options: SignInOptions): Promise<AccountRecord> {
    const endpoint = normalizeEndpoint(options.endpoint);
    const session = await this.createClient({ endpoint }).signUp(options);
    return this.adopt(endpoint, options.email, session);
  }

  async listAccounts(): Promise<AccountRecord[]> {
    const items = await this.vault.listItems({ kind: 'account' });
    return Promise.all(items.map((item) => this.readAccount(item)));
  }

  async getAccount(itemId: string): Promise<AccountRecord> {
    return this.readAccount(await this.requireItem(itemId, 'account'));
  }

  /**
   * The stored bearer token, or null when signed out or expired. This is the
   * value a harness host would ask for; expiry is checked here so a caller
   * cannot accidentally present a dead token.
   */
  async accessToken(itemId: string): Promise<string | null> {
    const fields = await this.readFields(itemId);
    const token = fields[ACCOUNT_FIELDS.accessToken];
    if (!token) return null;
    if (hasExpired(fields[ACCOUNT_FIELDS.expiresAt] ?? null, this.now())) {
      return null;
    }
    return token;
  }

  /** Sign out server-side and drop the token, keeping the account item. */
  async signOut(itemId: string): Promise<void> {
    const fields = await this.readFields(itemId);
    const token = fields[ACCOUNT_FIELDS.accessToken];
    const endpoint = fields[ACCOUNT_FIELDS.endpoint];
    if (token) {
      await this.createClient({ endpoint, token }).signOut();
    }
    await this.vault.deleteField(itemId, ACCOUNT_FIELDS.accessToken);
    await this.vault.deleteField(itemId, ACCOUNT_FIELDS.expiresAt);
  }

  /** Remove the account and every API key stored under it, locally. */
  async forget(itemId: string): Promise<void> {
    for (const key of await this.listApiKeys(itemId)) {
      await this.vault.deleteItemForever(key.itemId);
    }
    await this.vault.deleteItemForever(itemId);
  }

  // ─── api keys ─────────────────────────────────────────────────────────────

  /**
   * Mint an API key for an account. The server shows the secret exactly once,
   * so it goes straight into the vault and is never returned to the caller —
   * read it back with `revealApiKey` when it is actually needed.
   */
  async createApiKey(
    accountItemId: string,
    options: CreateApiKeyOptions,
    proof?: StepUpProof
  ): Promise<ApiKeyRecord> {
    const account = await this.readFields(accountItemId);
    const token = await this.requireToken(accountItemId);
    const endpoint = account[ACCOUNT_FIELDS.endpoint];
    const created = await this.withStepUp(endpoint, token, proof, (client) =>
      client.createApiKey(options)
    );

    const item = await this.vault.createItem('api_key', options.name);
    await this.vault.setField(item.id, KEY_FIELDS.endpoint, 'url', endpoint, false);
    await this.vault.setField(
      item.id,
      KEY_FIELDS.accountId,
      'text',
      accountItemId,
      false
    );
    await this.vault.setField(item.id, KEY_FIELDS.keyId, 'text', created.keyId, false);
    await this.vault.setField(item.id, KEY_FIELDS.apiKey, 'token', created.apiKey);
    if (created.expiresAt) {
      await this.vault.setField(
        item.id,
        KEY_FIELDS.expiresAt,
        'text',
        created.expiresAt,
        false
      );
    }

    return {
      itemId: item.id,
      accountItemId,
      endpoint,
      keyId: created.keyId,
      name: options.name,
      expiresAt: created.expiresAt,
    };
  }

  /** Every stored key, or only those minted by one account. */
  async listApiKeys(accountItemId?: string): Promise<ApiKeyRecord[]> {
    const items = await this.vault.listItems({ kind: 'api_key' });
    const keys = await Promise.all(items.map((item) => this.readApiKey(item)));
    return accountItemId
      ? keys.filter((key) => key.accountItemId === accountItemId)
      : keys;
  }

  async revealApiKey(itemId: string): Promise<string> {
    return this.vault.revealField(itemId, KEY_FIELDS.apiKey);
  }

  /** Revoke server-side, then delete the local copy. */
  async revokeApiKey(itemId: string, proof?: StepUpProof): Promise<void> {
    const fields = await this.readFields(itemId);
    const accountItemId = fields[KEY_FIELDS.accountId];
    const token = await this.requireToken(accountItemId);
    await this.withStepUp(
      fields[KEY_FIELDS.endpoint],
      token,
      proof,
      (client) => client.revokeApiKey(fields[KEY_FIELDS.keyId])
    );
    await this.vault.deleteItemForever(itemId);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /**
   * Run a sensitive operation, and if the server asks for a freshly proved
   * factor, prove it and run *the same* operation once more. The request is
   * held rather than rebuilt, so nothing about it can change between the two
   * attempts. Without a proof the `StepUpRequiredError` propagates, which is
   * what lets a caller collect one and try again.
   */
  private async withStepUp<T>(
    endpoint: string,
    token: string,
    proof: StepUpProof | undefined,
    run: (client: AuthClient) => Promise<T>
  ): Promise<T> {
    const client = this.createClient({ endpoint, token });
    try {
      return await run(client);
    } catch (error) {
      if (!(error instanceof StepUpRequiredError)) throw error;
      if (error.kind === 'mfa') {
        if (!proof?.totpCode) throw error;
        await client.verifyTotp(proof.totpCode);
      } else if (proof?.password) {
        await client.verifyPassword(proof.password);
      } else if (proof?.totpCode) {
        await client.verifyTotp(proof.totpCode);
      } else {
        throw error;
      }
      return run(client);
    }
  }

  private async adopt(
    endpoint: string,
    email: string,
    session: AuthSession
  ): Promise<AccountRecord> {
    const existing = await this.findAccount(endpoint, email);
    const itemId =
      existing?.id ??
      (await this.vault.createItem('account', `${email} @ ${hostOf(endpoint)}`)).id;

    await this.vault.setField(itemId, ACCOUNT_FIELDS.endpoint, 'url', endpoint, false);
    await this.vault.setField(itemId, ACCOUNT_FIELDS.email, 'username', email, false);
    await this.vault.setField(
      itemId,
      ACCOUNT_FIELDS.userId,
      'text',
      session.userId,
      false
    );
    await this.vault.setField(
      itemId,
      ACCOUNT_FIELDS.accessToken,
      'token',
      session.accessToken
    );
    if (session.accessTokenExpiresAt) {
      await this.vault.setField(
        itemId,
        ACCOUNT_FIELDS.expiresAt,
        'text',
        session.accessTokenExpiresAt,
        false
      );
    }

    return {
      itemId,
      endpoint,
      email,
      userId: session.userId,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      signedIn: !hasExpired(session.accessTokenExpiresAt, this.now()),
    };
  }

  private async findAccount(
    endpoint: string,
    email: string
  ): Promise<VaultItem | null> {
    for (const item of await this.vault.listItems({ kind: 'account' })) {
      const fields = await this.readFields(item.id);
      if (
        fields[ACCOUNT_FIELDS.endpoint] === endpoint &&
        fields[ACCOUNT_FIELDS.email] === email
      ) {
        return item;
      }
    }
    return null;
  }

  private async requireItem(itemId: string, kind: string): Promise<VaultItem> {
    const item = await this.vault.getItem(itemId);
    if (!item || item.kind !== kind) {
      throw new Error(`no ${kind} item ${itemId} in this vault`);
    }
    return item;
  }

  private async requireToken(accountItemId: string): Promise<string> {
    const token = await this.accessToken(accountItemId);
    if (!token) {
      throw new AuthError(
        'accessToken',
        `account ${accountItemId} is signed out — sign in again first`
      );
    }
    return token;
  }

  private async readAccount(item: VaultItem): Promise<AccountRecord> {
    const fields = await this.readFields(item.id);
    const expiresAt = fields[ACCOUNT_FIELDS.expiresAt] ?? null;
    return {
      itemId: item.id,
      endpoint: fields[ACCOUNT_FIELDS.endpoint] ?? '',
      email: fields[ACCOUNT_FIELDS.email] ?? item.title,
      userId: fields[ACCOUNT_FIELDS.userId] ?? '',
      accessTokenExpiresAt: expiresAt,
      signedIn:
        Boolean(fields[ACCOUNT_FIELDS.accessToken]) &&
        !hasExpired(expiresAt, this.now()),
    };
  }

  private async readApiKey(item: VaultItem): Promise<ApiKeyRecord> {
    const fields = await this.readFields(item.id);
    return {
      itemId: item.id,
      accountItemId: fields[KEY_FIELDS.accountId] ?? '',
      endpoint: fields[KEY_FIELDS.endpoint] ?? '',
      keyId: fields[KEY_FIELDS.keyId] ?? '',
      name: item.title,
      expiresAt: fields[KEY_FIELDS.expiresAt] ?? null,
    };
  }

  /** Every field of an item, decrypted, keyed by name. */
  private async readFields(itemId: string): Promise<Record<string, string>> {
    const metas = await this.vault.listFields(itemId);
    const entries = await Promise.all(
      metas.map(
        async (meta) =>
          [meta.name, await this.vault.revealField(itemId, meta.name)] as const
      )
    );
    return Object.fromEntries(entries);
  }
}
