import { base64 } from '@decryption/base';

import { decrypt, DecryptOptions, encrypt, EncryptOptions } from './envelope';
import { CorruptEnvelopeError } from './errors';

/** Prefix of the text (armored) representation, e.g. `dcrypt.v1.<base64>`. */
export const ARMOR_PREFIX = 'dcrypt.v1.';

/** Wraps envelope bytes in the single-line text form that is safe to paste anywhere. */
export const armor = (envelope: Uint8Array): string => ARMOR_PREFIX + base64.encode(envelope);

/** Inverse of {@link armor}. */
export const dearmor = (text: string): Uint8Array => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(ARMOR_PREFIX)) {
    throw new CorruptEnvelopeError(`armored envelope must start with "${ARMOR_PREFIX}"`);
  }
  try {
    return base64.decode(trimmed.slice(ARMOR_PREFIX.length));
  } catch {
    throw new CorruptEnvelopeError('armored envelope is not valid base64');
  }
};

/** Convenience wrapper: encrypt a string and return the armored text form. */
export const encryptToString = (
  plaintext: string,
  passphrase: string,
  options?: EncryptOptions
): string => armor(encrypt(plaintext, passphrase, options));

/** Convenience wrapper: decrypt armored text back into a string. */
export const decryptFromString = (
  armored: string,
  passphrase: string,
  options?: DecryptOptions
): string => new TextDecoder().decode(decrypt(dearmor(armored), passphrase, options));
