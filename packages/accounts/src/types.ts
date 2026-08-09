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
  /** The provisioned database this key is the data-plane token for, if any. */
  databaseId: string | null;
  /** The scoped sub-identity this key acts as, if it was minted for one. */
  principalId: string | null;
  /** The organization it is scoped to, for an org key. */
  orgId: string | null;
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
  /** Tag the key as this database's data-plane token, for a harness host. */
  databaseId?: string;
  /** Mint the key *as* this principal, so it carries the principal's scope. */
  principalId?: string;
  /** Mint an org key, billed and scoped to this organization. */
  orgId?: string;
}

/**
 * A per-scope narrowing of a principal. No row for a scope means the principal
 * simply inherits its owner there — an override can only take access away.
 */
export interface PrincipalScope {
  /** The scope level (membership type) this row restricts. */
  membershipType: number;
  /** Bitmask AND-ed with the owner's permissions during the SPRT cascade. */
  allowedMask: string | null;
  isActive: boolean;
  isReadOnly: boolean;
  useAdminOwner: boolean;
}

/**
 * A scoped sub-identity — what an API key or an agent actually acts as. It is
 * owned by a human account and can never exceed that human's permissions.
 */
export interface PrincipalRecord {
  principalId: string;
  name: string;
  ownerId: string | null;
  isReadOnly: boolean;
  bypassStepUp: boolean;
  useAdminOwner: boolean;
  /** Organizations (or other entities) this principal is scoped to. */
  entityIds: string[];
  scopes: PrincipalScope[];
}

export interface CreatePrincipalOptions {
  name: string;
  /**
   * The organization to scope it to. Omitted means a personal principal: one
   * that reaches wherever you do, which is what an unattended job of your own
   * wants — an org id would only narrow it.
   */
  orgId?: string;
  isReadOnly?: boolean;
  /** Let it skip MFA step-up — the point of a CI identity. */
  bypassStepUp?: boolean;
  /** Inherit the owner's admin rights within the scope. */
  useAdminOwner?: boolean;
}
