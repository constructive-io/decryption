import { normalize, Vault, VAULT_VERSION, VaultError } from './vault';

/**
 * Serializes a vault as deterministic, git-friendly JSON: sorted keys, one secret per line, and a
 * trailing newline. The same logical vault always produces the same bytes.
 */
export const serializeVault = (vault: Vault): string =>
  JSON.stringify(normalize(vault), null, 2) + '\n';

/** Parses and validates a vault file. */
export const parseVault = (text: string): Vault => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VaultError('vault file is not valid JSON');
  }
  if (!isRecord(parsed)) throw new VaultError('vault file must be a JSON object');

  const version = parsed.dcrypt;
  if (version !== VAULT_VERSION) {
    throw new VaultError(
      `unsupported vault version ${String(version)}; this build understands ${VAULT_VERSION}`
    );
  }
  if (typeof parsed.name !== 'string') throw new VaultError('vault is missing a name');
  if (!Array.isArray(parsed.recipients) || parsed.recipients.length === 0) {
    throw new VaultError('vault has no recipients');
  }
  if (!Array.isArray(parsed.keys) || parsed.keys.length === 0) {
    throw new VaultError('vault has no wrapped keys');
  }
  if (!isRecord(parsed.values)) throw new VaultError('vault values must be an object');

  for (const recipient of parsed.recipients) {
    if (!isRecord(recipient) || typeof recipient.recipient !== 'string') {
      throw new VaultError('malformed recipient entry');
    }
  }
  for (const stanza of parsed.keys) {
    if (
      !isRecord(stanza) ||
      typeof stanza.recipient !== 'string' ||
      typeof stanza.ephemeral !== 'string' ||
      typeof stanza.wrapped !== 'string'
    ) {
      throw new VaultError('malformed wrapped key entry');
    }
  }
  for (const [key, value] of Object.entries(parsed.values)) {
    if (typeof value !== 'string') throw new VaultError(`secret "${key}" is not a string`);
  }
  return normalize(parsed as unknown as Vault);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
