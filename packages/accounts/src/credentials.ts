import { AccountManager } from './manager';
import type { AccountRecord } from './types';

/**
 * Result of a data-plane token request, structurally the harness's own
 * `DataTokenResult`. The shape is duplicated rather than imported so this
 * package does not depend on the harness to serve it — the harness is
 * auth-agnostic by design and asks only for these two methods.
 */
export interface DataTokenResult {
  token: string | null;
  /** Where the token came from; always the vault when dcrypt answers. */
  origin?: string;
}

/** The credential contract a harness host supplies (`HarnessCredentials`). */
export interface CredentialProvider {
  accountBearer(): Promise<string | null>;
  dataToken(databaseId: string): Promise<DataTokenResult>;
}

export interface VaultCredentialsOptions {
  /** Serve this account. Otherwise the one signed-in account is used. */
  accountItemId?: string;
}

/**
 * Serves a harness its credentials out of the unlocked vault, so the harness,
 * the CLI and any MCP host stop each keeping their own copy of a token on
 * disk. Locking dcrypt cuts every one of them off at once, and there is a
 * single place to revoke.
 *
 * Nothing is cached: every call re-reads the vault, because a token that was
 * valid when the provider was constructed says nothing about now.
 */
export class VaultCredentials implements CredentialProvider {
  constructor(
    private readonly accounts: AccountManager,
    private readonly options: VaultCredentialsOptions = {}
  ) {}

  /** The control-plane bearer, or null when signed out, expired or ambiguous. */
  async accountBearer(): Promise<string | null> {
    const account = await this.account();
    return account ? this.accounts.accessToken(account.itemId) : null;
  }

  /**
   * The data-plane token for one provisioned database: the API key tagged with
   * that database id. An untagged key is never handed over — a key minted for
   * something else is not this database's token, and guessing would hand a
   * caller more authority than it asked for.
   *
   * An API key is its own credential, so this does not require a live session;
   * a signed-out account can still serve the key it minted.
   */
  async dataToken(databaseId: string): Promise<DataTokenResult> {
    const keys = await this.accounts.listApiKeys(this.options.accountItemId);
    const matches = keys.filter((key) => key.databaseId === databaseId);
    if (matches.length !== 1) return { token: null };
    return {
      token: await this.accounts.revealApiKey(matches[0].itemId),
      origin: 'vault',
    };
  }

  /**
   * Which account to serve. With no explicit choice, exactly one account must
   * be signed in: picking for the caller when several are would silently act
   * as the wrong user, which is worse than refusing.
   */
  private async account(): Promise<AccountRecord | null> {
    if (this.options.accountItemId) {
      return this.accounts.getAccount(this.options.accountItemId);
    }
    const signedIn = (await this.accounts.listAccounts()).filter(
      (account) => account.signedIn
    );
    return signedIn.length === 1 ? signedIn[0] : null;
  }
}
