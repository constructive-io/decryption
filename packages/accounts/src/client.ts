import { auth } from '@constructive-io/sdk';

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

const rethrow = (operation: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  throw new AuthError(operation, message);
};

/** The real client: `@constructive-io/sdk`'s generated auth ORM. */
export const sdkAuthClient: AuthClientFactory = ({ endpoint, token }) => {
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
        return rethrow('signIn', error);
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
        return rethrow('signUp', error);
      }
    },

    async signOut() {
      try {
        await client.mutation
          .signOut({ input: {} }, { select: { clientMutationId: true } })
          .unwrap();
      } catch (error) {
        rethrow('signOut', error);
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
        return rethrow('createApiKey', error);
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
        rethrow('revokeApiKey', error);
      }
    },
  };
};
