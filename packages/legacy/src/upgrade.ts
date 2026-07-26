import { armor, encrypt, EncryptOptions } from '@decryption/core';

import { decrypt, decryptWithEncryptedSalt } from './cosmology';

/**
 * Reads a legacy `@cosmology/core` blob and re-encrypts it as a modern, authenticated
 * `@decryption/core` envelope. This is the one-way door out of the CryptoJS scheme.
 */
export const upgradeEnvelope = (
  legacyCiphertext: string,
  legacySalt: string,
  passphrase: string,
  options?: EncryptOptions
): Uint8Array => encrypt(decrypt(legacySalt, legacyCiphertext), passphrase, options);

/** {@link upgradeEnvelope} for the two-layer (salt + encrypted salt) variant. */
export const upgradeTwoLayerEnvelope = (
  legacyCiphertext: string,
  legacySalt: string,
  legacyEncryptedSalt: string,
  passphrase: string,
  options?: EncryptOptions
): Uint8Array =>
  encrypt(
    decryptWithEncryptedSalt(legacySalt, legacyEncryptedSalt, legacyCiphertext),
    passphrase,
    options
  );

/** {@link upgradeEnvelope}, returning the armored text form. */
export const upgradeEnvelopeToString = (
  legacyCiphertext: string,
  legacySalt: string,
  passphrase: string,
  options?: EncryptOptions
): string => armor(upgradeEnvelope(legacyCiphertext, legacySalt, passphrase, options));
