import { app, safeStorage, systemPreferences } from 'electron';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';

import type { BiometricStatus } from '../shared/api';
import { appDataPath } from './vault-service';

/**
 * The master password, sealed by the OS credential store — Keychain on macOS,
 * DPAPI on Windows, libsecret/kwallet on Linux — so unlocking can be a
 * fingerprint instead of typing it. It is the same secret either way: what
 * biometrics change is who is asked, not what protects the vault. The vault
 * file itself is untouched, and still opens with the password anywhere else.
 */
const secretFile = (): string => path.join(appDataPath(), 'config', 'unlock.bin');

/** macOS is the only platform Electron gives a biometric prompt for. */
const canPrompt = (): boolean =>
  process.platform === 'darwin' && systemPreferences.canPromptTouchID();

export const biometricStatus = (): BiometricStatus => ({
  available: safeStorage.isEncryptionAvailable(),
  biometric: canPrompt(),
  enrolled: existsSync(secretFile()),
  store:
    process.platform === 'darwin'
      ? 'Keychain'
      : process.platform === 'win32'
        ? 'Credential Manager'
        : 'the system keyring',
});

/**
 * Remember the password for this machine. Refuses when the OS store is not
 * usable rather than falling back to anything weaker — on Linux that means no
 * keyring is running, and writing the password in the clear would be worse
 * than making the user type it.
 */
export const enrol = async (passphrase: string): Promise<void> => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      `${app.getName()} cannot reach ${biometricStatus().store} to store the password safely`
    );
  }
  const file = secretFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, safeStorage.encryptString(passphrase), { mode: 0o600 });
};

export const forget = async (): Promise<void> => {
  await fs.rm(secretFile(), { force: true });
};

/**
 * The remembered password, after the OS has satisfied itself about who is
 * asking. Null when nothing is enrolled; a refused or cancelled prompt throws,
 * so the caller can say so rather than silently offering the password field.
 */
export const unlockSecret = async (reason: string): Promise<string | null> => {
  const file = secretFile();
  if (!existsSync(file)) return null;
  if (canPrompt()) await systemPreferences.promptTouchID(reason);
  return safeStorage.decryptString(await fs.readFile(file));
};
