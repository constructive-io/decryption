/**
 * Environment variable input, kept compatible with the cosmology CLI.
 *
 * Every name that CLI read still works — `MNEMONIC`, `SALT`, `ENCRYPTED_SALT`,
 * `KEYCHAIN_ACCOUNT` — alongside `DCRYPT_`-prefixed aliases for use in
 * environments where the bare names would collide.
 *
 * Resolution order everywhere is: explicit flag, then environment, then stdin,
 * then an interactive prompt. Flags always win so a script can override an
 * inherited variable, and argv still never carries a secret.
 */
export const ENV_VARS = {
  mnemonic: ['MNEMONIC', 'DCRYPT_MNEMONIC'],
  salt: ['SALT', 'DCRYPT_SALT'],
  encryptedSalt: ['ENCRYPTED_SALT', 'DCRYPT_ENCRYPTED_SALT'],
  keychainAccount: ['KEYCHAIN_ACCOUNT', 'DCRYPT_KEYCHAIN_ACCOUNT'],
  passphrase: ['DCRYPT_PASSPHRASE'],
} as const;

export type EnvInput = keyof typeof ENV_VARS;

/** First non-empty value among the names for `input`, or undefined. */
export const fromEnv = (
  input: EnvInput,
  env: NodeJS.ProcessEnv = process.env
): string | undefined => {
  for (const name of ENV_VARS[input]) {
    const value = env[name];
    if (typeof value === 'string' && value.length) return value;
  }
  return undefined;
};

/** The keychain namespace, matching the cosmology CLI's `KEYCHAIN_ACCOUNT`. */
export const keychainAccount = (env: NodeJS.ProcessEnv = process.env): string =>
  fromEnv('keychainAccount', env) ?? 'dcrypt';

export const envUsage = `
Environment:
  MNEMONIC                A BIP39 mnemonic, for wallet commands
  SALT                    The salt, for salt and cosmology commands
  ENCRYPTED_SALT          The encrypted salt, for the two-layer scheme
  KEYCHAIN_ACCOUNT        Keychain namespace                  (default: dcrypt)
  DCRYPT_PASSPHRASE       The passphrase, for unattended runs

  Each also accepts a DCRYPT_-prefixed alias (DCRYPT_MNEMONIC, DCRYPT_SALT, ...).
  Flags take precedence over the environment, which takes precedence over stdin.
`;
