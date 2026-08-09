import { auth } from '@constructive-io/sdk';

import { normalizeEndpoint } from './endpoint';
import { AuthSession, CreateApiKeyOptions, CreatedApiKey } from './types';

/** Raised when the auth server refuses a call, with the server's own wording. */
export class AuthError extends Error {
  constructor(
    readonly operation: string,
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * What the server wants re-proved before it will run a sensitive mutation.
 * Mirrors the `STEP_UP_REQUIRED_*` exceptions raised by `require_step_up()`.
 */
export type StepUpKind = 'password' | 'mfa' | 'fresh_auth';

/**
 * The session is authenticated but not *recently* verified. Recoverable: prove
 * the factor, then run the very same request again.
 */
export class StepUpRequiredError extends AuthError {
  constructor(
    operation: string,
    readonly kind: StepUpKind,
    message: string
  ) {
    super(operation, message);
    this.name = 'StepUpRequiredError';
  }
}

/** A freshly proved factor, supplied to retry an operation that needed one. */
export interface StepUpProof {
  password?: string;
  totpCode?: string;
}

export interface SignInInput {
  email: string;
  password: string;
  rememberMe?: boolean;
}

/**
 * The slice of the Constructive auth API this package uses. Narrow on purpose:
 * it keeps the vault side testable without a server, and it is the seam where
 * a different transport (a proxy, a recorded fixture) can be dropped in.
 */
export interface AuthClient {
  signIn(input: SignInInput): Promise<AuthSession>;
  signUp(input: SignInInput): Promise<AuthSession>;
  signOut(): Promise<void>;
  createApiKey(options: CreateApiKeyOptions): Promise<CreatedApiKey>;
  revokeApiKey(keyId: string): Promise<void>;
  /** Re-prove the password, refreshing the session's step-up window. */
  verifyPassword(password: string): Promise<void>;
  /** Re-prove MFA with a one-time code. */
  verifyTotp(code: string): Promise<void>;
}

export interface AuthClientOptions {
  /** Auth GraphQL endpoint, e.g. `http://auth.localhost:3000/graphql`. */
  endpoint: string;
  /** Bearer token for calls that need an authenticated caller. */
  token?: string;
}

export type AuthClientFactory = (options: AuthClientOptions) => AuthClient;

const SESSION_SELECT = {
  select: {
    result: {
      select: { userId: true, accessToken: true, accessTokenExpiresAt: true },
    },
  },
} as const;

type SessionPayload = {
  userId?: string | null;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
};

const readSession = (
  operation: string,
  payload: SessionPayload | null | undefined
): AuthSession => {
  if (!payload?.userId || !payload.accessToken) {
    throw new AuthError(operation, 'the server returned no session');
  }
  return {
    userId: payload.userId,
    accessToken: payload.accessToken,
    accessTokenExpiresAt: payload.accessTokenExpiresAt ?? null,
  };
};

/**
 * A 404 means the URL is not a GraphQL route at all, which is by far the most
 * common way to get this wrong — say so instead of passing on `HTTP 404`.
 */
const explain = (message: string, endpoint: string): string => {
  if (!/\b404\b/.test(message)) return message;
  const suffix = endpoint.endsWith('/graphql')
    ? 'check the host and that the auth plane is running'
    : `try ${endpoint.replace(/\/$/, '')}/graphql`;
  return `no GraphQL endpoint at ${endpoint} — ${suffix}`;
};

const STEP_UP = /STEP_UP_REQUIRED(?:_(PASSWORD|MFA|FRESH_AUTH))?/;

/**
 * Which factor a message is asking for, or null. Exported because a step-up
 * error arrives at a UI as plain text once it has crossed a process boundary,
 * and the server's own code is the only trustworthy thing to key off.
 *
 * The bare `STEP_UP_REQUIRED` raised by the generated guard means the session
 * has no recent password verification, so it asks for a password.
 */
export const stepUpKind = (message: string): StepUpKind | null => {
  const found = STEP_UP.exec(message);
  if (!found) return null;
  return (found[1]?.toLowerCase() as StepUpKind) ?? 'password';
};

const rethrow = (operation: string, endpoint: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  const kind = stepUpKind(message);
  if (kind) throw new StepUpRequiredError(operation, kind, message);
  throw new AuthError(operation, explain(message, endpoint));
};

/** The real client: `@constructive-io/sdk`'s generated auth ORM. */
export const sdkAuthClient: AuthClientFactory = (options) => {
  const endpoint = normalizeEndpoint(options.endpoint);
  const token = options.token;
  const client = auth.createClient({
    endpoint,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  return {
    async signIn(input) {
      try {
        const data = await client.mutation
          .signIn(
            {
              input: {
                email: input.email,
                password: input.password,
                rememberMe: input.rememberMe ?? true,
              },
            },
            SESSION_SELECT
          )
          .unwrap();
        return readSession('signIn', data.signIn?.result);
      } catch (error) {
        if (error instanceof AuthError) throw error;
        return rethrow('signIn', endpoint, error);
      }
    },

    async signUp(input) {
      try {
        const data = await client.mutation
          .signUp(
            { input: { email: input.email, password: input.password } },
            SESSION_SELECT
          )
          .unwrap();
        return readSession('signUp', data.signUp?.result);
      } catch (error) {
        if (error instanceof AuthError) throw error;
        return rethrow('signUp', endpoint, error);
      }
    },

    async signOut() {
      try {
        await client.mutation
          .signOut({ input: {} }, { select: { clientMutationId: true } })
          .unwrap();
      } catch (error) {
        rethrow('signOut', endpoint, error);
      }
    },

    async createApiKey(options) {
      try {
        const data = await client.mutation
          .createApiKey(
            {
              input: {
                keyName: options.name,
                expiresIn: options.expiresIn,
                accessLevel: options.accessLevel,
              },
            },
            {
              select: {
                result: {
                  select: { apiKey: true, keyId: true, expiresAt: true },
                },
              },
            }
          )
          .unwrap();
        const result = data.createApiKey?.result;
        if (!result?.apiKey || !result.keyId) {
          throw new AuthError('createApiKey', 'the server returned no key');
        }
        return {
          apiKey: result.apiKey,
          keyId: result.keyId,
          expiresAt: result.expiresAt ?? null,
        };
      } catch (error) {
        if (error instanceof AuthError) throw error;
        return rethrow('createApiKey', endpoint, error);
      }
    },

    async verifyPassword(password) {
      try {
        const data = await client.mutation
          .verifyPassword({ input: { password } }, { select: { result: true } })
          .unwrap();
        if (data.verifyPassword?.result !== true) {
          throw new AuthError('verifyPassword', 'the password was not accepted');
        }
      } catch (error) {
        if (error instanceof AuthError) throw error;
        rethrow('verifyPassword', endpoint, error);
      }
    },

    async verifyTotp(code) {
      try {
        const data = await client.mutation
          .verifyTotp({ input: { totpValue: code } }, { select: { result: true } })
          .unwrap();
        if (data.verifyTotp?.result !== true) {
          throw new AuthError('verifyTotp', 'the code was not accepted');
        }
      } catch (error) {
        if (error instanceof AuthError) throw error;
        rethrow('verifyTotp', endpoint, error);
      }
    },

    async revokeApiKey(keyId) {
      try {
        const data = await client.mutation
          .revokeApiKey({ input: { keyId } }, { select: { result: true } })
          .unwrap();
        if (data.revokeApiKey?.result !== true) {
          throw new AuthError('revokeApiKey', `the server did not revoke ${keyId}`);
        }
      } catch (error) {
        if (error instanceof AuthError) throw error;
        rethrow('revokeApiKey', endpoint, error);
      }
    },
  };
};
