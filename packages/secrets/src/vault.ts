import { base64 } from '@decryption/base';
import { openWithKey, sealWithKey } from '@decryption/core';
import {
  fingerprint,
  generateFileKey,
  Identity,
  recipientFromString,
  recipientToString,
  Stanza,
  unwrapFileKey,
  wrapFileKey,
} from '@decryption/keys';

/** File format version written by this package. */
export const VAULT_VERSION = 1;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A teammate (or machine) allowed to read the vault. */
export interface Recipient {
  /** Human label — a name, an email, `ci`, `break-glass`. */
  label: string;
  /** `dcrypt1…` public recipient string. */
  recipient: string;
}

/**
 * A team secrets file. One file key encrypts every value; each recipient gets a stanza wrapping
 * that file key. Values are stored individually so a git diff shows *which* secret changed.
 */
export interface Vault {
  dcrypt: number;
  name: string;
  recipients: Recipient[];
  keys: Stanza[];
  values: Record<string, string>;
}

export interface CreateVaultOptions {
  name: string;
  recipients: Recipient[];
}

/** Creates an empty vault readable by `recipients`. */
export const createVault = ({ name, recipients }: CreateVaultOptions): Vault => {
  if (recipients.length === 0) throw new VaultError('a vault needs at least one recipient');
  const fileKey = generateFileKey();
  try {
    return normalize({
      dcrypt: VAULT_VERSION,
      name,
      recipients: recipients.map(validateRecipient),
      keys: recipients.map((recipient) => wrapFileKey(fileKey, recipient.recipient)),
      values: {},
    });
  } finally {
    fileKey.fill(0);
  }
};

/**
 * Recovers the vault's file key. Callers must zero it when finished — prefer {@link getValue} and
 * friends unless you are doing many operations at once.
 */
export const unlock = (vault: Vault, identity: Identity): Uint8Array =>
  unwrapFileKey(vault.keys, identity);

/** Names of the secrets in the vault, sorted. Requires no key: names are not encrypted. */
export const listKeys = (vault: Vault): string[] => Object.keys(vault.values).sort();

/** Decrypts one value. */
export const getValue = (vault: Vault, identity: Identity, key: string): string => {
  const fileKey = unlock(vault, identity);
  try {
    return decodeValue(vault, fileKey, key);
  } finally {
    fileKey.fill(0);
  }
};

/** Decrypts every value into a plain object. */
export const getValues = (vault: Vault, identity: Identity): Record<string, string> => {
  const fileKey = unlock(vault, identity);
  try {
    return Object.fromEntries(
      listKeys(vault).map((key) => [key, decodeValue(vault, fileKey, key)])
    );
  } finally {
    fileKey.fill(0);
  }
};

/** Returns a new vault with `key` set to `value`. The input vault is not modified. */
export const setValue = (
  vault: Vault,
  identity: Identity,
  key: string,
  value: string
): Vault => setValues(vault, identity, { [key]: value });

/** {@link setValue} for several secrets at once. */
export const setValues = (
  vault: Vault,
  identity: Identity,
  values: Record<string, string>
): Vault => {
  const fileKey = unlock(vault, identity);
  try {
    const encrypted = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, encodeValue(fileKey, key, value)])
    );
    return normalize({ ...vault, values: { ...vault.values, ...encrypted } });
  } finally {
    fileKey.fill(0);
  }
};

/** Returns a new vault without `key`. Removing a secret needs no decryption key. */
export const deleteValue = (vault: Vault, key: string): Vault => {
  if (!(key in vault.values)) throw new VaultError(`no such secret: ${key}`);
  const values = { ...vault.values };
  delete values[key];
  return normalize({ ...vault, values });
};

/**
 * Adds a recipient. This rekeys the vault — a fresh file key is generated and every value is
 * re-encrypted — so the new recipient cannot decrypt copies of the file from before they joined.
 */
export const addRecipient = (vault: Vault, identity: Identity, recipient: Recipient): Vault => {
  validateRecipient(recipient);
  if (vault.recipients.some((existing) => sameRecipient(existing, recipient))) {
    throw new VaultError(`${recipient.recipient} is already a recipient`);
  }
  return rekey(vault, identity, [...vault.recipients, recipient]);
};

/**
 * Removes a recipient and rekeys. The removed teammate keeps whatever they already read — rotate
 * the underlying secrets too — but cannot read anything written after this point.
 */
export const removeRecipient = (
  vault: Vault,
  identity: Identity,
  labelOrRecipient: string
): Vault => {
  const remaining = vault.recipients.filter(
    (existing) =>
      existing.label !== labelOrRecipient && existing.recipient !== labelOrRecipient
  );
  if (remaining.length === vault.recipients.length) {
    throw new VaultError(`no such recipient: ${labelOrRecipient}`);
  }
  if (remaining.length === 0) throw new VaultError('cannot remove the last recipient');
  if (!remaining.some((r) => fingerprint(recipientFromString(r.recipient)) === fingerprint(identity.publicKey))) {
    throw new VaultError('refusing to remove yourself: you would lose access to the vault');
  }
  return rekey(vault, identity, remaining);
};

/** Re-encrypts the vault under a brand new file key, keeping the same recipients. */
export const rotateFileKey = (vault: Vault, identity: Identity): Vault =>
  rekey(vault, identity, vault.recipients);

/** True when `identity` is one of the vault's recipients. */
export const canRead = (vault: Vault, identity: Identity): boolean => {
  const mine = fingerprint(identity.publicKey);
  return vault.keys.some((stanza) => stanza.recipient === mine);
};

const rekey = (vault: Vault, identity: Identity, recipients: Recipient[]): Vault => {
  const plaintext = getValues(vault, identity);
  const fileKey = generateFileKey();
  try {
    return normalize({
      ...vault,
      recipients: recipients.map(validateRecipient),
      keys: recipients.map((recipient) => wrapFileKey(fileKey, recipient.recipient)),
      values: Object.fromEntries(
        Object.entries(plaintext).map(([key, value]) => [key, encodeValue(fileKey, key, value)])
      ),
    });
  } finally {
    fileKey.fill(0);
  }
};

/**
 * Sorts recipients, stanzas and secret names so serializing the same logical vault twice produces
 * the same file, byte for byte — the property that makes these files reviewable in git.
 */
export const normalize = (vault: Vault): Vault => ({
  dcrypt: vault.dcrypt,
  name: vault.name,
  recipients: [...vault.recipients].sort((a, b) => a.recipient.localeCompare(b.recipient)),
  keys: [...vault.keys].sort((a, b) => a.recipient.localeCompare(b.recipient)),
  values: Object.fromEntries(
    Object.entries(vault.values).sort(([a], [b]) => a.localeCompare(b))
  ),
});

/** Values are bound to their own name, so moving a ciphertext to another key fails to decrypt. */
const encodeValue = (fileKey: Uint8Array, key: string, value: string): string =>
  base64.encode(sealWithKey(fileKey, value, `dcrypt-secret:${key}`));

const decodeValue = (vault: Vault, fileKey: Uint8Array, key: string): string => {
  const encoded = vault.values[key];
  if (encoded === undefined) throw new VaultError(`no such secret: ${key}`);
  return new TextDecoder().decode(
    openWithKey(fileKey, base64.decode(encoded), `dcrypt-secret:${key}`)
  );
};

const validateRecipient = (recipient: Recipient): Recipient => {
  if (!recipient.label.trim()) throw new VaultError('recipients need a label');
  // throws if the recipient string is malformed
  recipientToString(recipientFromString(recipient.recipient));
  return recipient;
};

const sameRecipient = (a: Recipient, b: Recipient): boolean => a.recipient === b.recipient;
