/** A Constructive account held in the vault. */
export interface AccountRecord {
  /** Vault item id; the handle for every other call. */
  itemId: string;
  /** Auth GraphQL endpoint this account belongs to. */
  endpoint: string;
  email: string;
  userId: string;
  /** Vault item holding a one-time code that can answer an MFA step-up. */
  totpItemId: string | null;
  /** When the stored access token stops working, if the server said. */
  accessTokenExpiresAt: string | null;
  /** False once signed out, or once the token has expired. */
  signedIn: boolean;
}

/** An API key minted for an account. The secret itself stays in the vault. */
export interface ApiKeyRecord {
  itemId: string;
  /** Vault item id of the account that minted it. */
  accountItemId: string;
  endpoint: string;
  /** Server-side id, and the handle used to revoke. */
  keyId: string;
  name: string;
  expiresAt: string | null;
}

/** What a sign-in or sign-up returns before it is written to the vault. */
export interface AuthSession {
  userId: string;
  accessToken: string;
  accessTokenExpiresAt: string | null;
}

export interface CreatedApiKey {
  apiKey: string;
  keyId: string;
  expiresAt: string | null;
}

/** Quantities accepted by the server's interval input. */
export interface KeyLifetime {
  days?: number;
  hours?: number;
  minutes?: number;
  months?: number;
  years?: number;
}

export interface CreateApiKeyOptions {
  name: string;
  expiresIn?: KeyLifetime;
  accessLevel?: string;
}
