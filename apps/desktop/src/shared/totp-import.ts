import { formatOtpauthUri, parseOtpauthUri } from './otpauth';

/**
 * One entry of an authenticator JSON export:
 * `[{ "name": "...", "secret": "...", "uri": "otpauth://totp/..." }, ...]`.
 * The URI is authoritative when present (it carries digits/period/algorithm);
 * name and secret alone are enough for a default 6-digit/30s entry.
 */
export interface TotpJsonEntry {
  name?: string;
  secret?: string;
  uri?: string;
}

/** Parses a JSON export into otpauth URIs, one per entry. Throws on malformed files. */
export const parseTotpJsonExport = (json: string): { name: string; uri: string }[] => {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('not a valid JSON file');
  }
  if (!Array.isArray(data)) {
    throw new Error('expected a JSON array of { name, secret, uri } entries');
  }
  return data.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`entry ${index + 1} is not an object`);
    }
    const entry = raw as TotpJsonEntry;
    if (typeof entry.uri === 'string' && entry.uri.length) {
      const params = parseOtpauthUri(entry.uri);
      const name = typeof entry.name === 'string' && entry.name.length ? entry.name : params.label;
      return { name, uri: entry.uri };
    }
    if (typeof entry.secret === 'string' && entry.secret.length) {
      const name = typeof entry.name === 'string' && entry.name.length ? entry.name : `Entry ${index + 1}`;
      const uri = formatOtpauthUri({
        label: name,
        secret: entry.secret.toUpperCase().replace(/\s+/g, ''),
        period: 30,
        digits: 6,
        algorithm: 'SHA1',
      });
      return { name, uri };
    }
    throw new Error(`entry ${index + 1} ("${entry.name ?? 'unnamed'}") has no uri or secret`);
  });
};
