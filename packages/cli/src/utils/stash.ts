import { decryptFromString, encryptToString, KdfParams, KdfProfile } from '@decryption/core';
import { Identity, identityFromString, identityToString, recipientToString } from '@decryption/keys';
import { appstash, resolve } from 'appstash';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import { keychainAccount } from './env';
import { CliError, EXIT } from './errors';

/**
 * On-disk layout, shared byte-for-byte with the Electron app:
 *
 * ```text
 * ~/.dcrypt/
 *   config/identity.json   the user's X25519 identity, encrypted under a passphrase
 *   data/keychain.json     named secrets, each encrypted under a passphrase
 *                          (KEYCHAIN_ACCOUNT selects keychain-<account>.json instead)
 *   data/vaults/<name>.json team secrets files
 * ```
 *
 * Nothing here is ever written in plaintext.
 */
export const APP_NAME = 'dcrypt';

export const dirs = () => appstash(APP_NAME, { ensure: true });

export const identityPath = (): string => resolve(dirs(), 'config', 'identity.json');
export const keychainPath = (): string => {
  const account = keychainAccount();
  const file = account === 'dcrypt' ? 'keychain.json' : `keychain-${account}.json`;
  return resolve(dirs(), 'data', file);
};
export const vaultPath = (name: string): string =>
  join(resolve(dirs(), 'data', 'vaults'), `${name}.json`);

export interface StoredIdentity {
  version: 1;
  /** Public recipient string — safe to store in the clear, and to share. */
  recipient: string;
  /** Armored envelope holding the private key. */
  encrypted: string;
}

export interface Keychain {
  version: 1;
  entries: Record<string, string>;
}

export const hasIdentity = (): boolean => existsSync(identityPath());

export const saveIdentity = (
  identity: Identity,
  passphrase: string,
  kdf: KdfProfile | KdfParams = 'moderate'
): StoredIdentity => {
  const stored: StoredIdentity = {
    version: 1,
    recipient: recipientToString(identity.publicKey),
    encrypted: encryptToString(identityToString(identity), passphrase, { kdf }),
  };
  writeJson(identityPath(), stored);
  return stored;
};

export const readStoredIdentity = (): StoredIdentity => {
  if (!hasIdentity()) {
    throw new CliError('no identity yet — run `dcrypt keys generate`', EXIT.notFound);
  }
  return readJson<StoredIdentity>(identityPath());
};

export const loadIdentity = (passphrase: string): Identity =>
  identityFromString(decryptFromString(readStoredIdentity().encrypted, passphrase));

export const readKeychain = (): Keychain =>
  existsSync(keychainPath()) ? readJson<Keychain>(keychainPath()) : { version: 1, entries: {} };

export const writeKeychain = (keychain: Keychain): void => writeJson(keychainPath(), keychain);

export const readJson = <T>(path: string): T => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    throw new CliError(`cannot read ${path}`, EXIT.corrupt);
  }
};

/** Writes JSON with owner-only permissions and a trailing newline. */
export const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
};
