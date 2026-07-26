import { Identity } from '@decryption/keys';

import { getValues, Vault, VaultError } from './vault';

export type ExportFormat = 'dotenv' | 'json' | 'yaml' | 'shell';

/** Renders the decrypted secrets in one of the shapes people actually consume. */
export const exportValues = (
  vault: Vault,
  identity: Identity,
  format: ExportFormat = 'dotenv'
): string => {
  const values = getValues(vault, identity);
  switch (format) {
    case 'dotenv':
      return render(values, (key, value) => `${key}=${quoteDotenv(value)}`);
    case 'shell':
      return render(values, (key, value) => `export ${key}=${quoteShell(value)}`);
    case 'yaml':
      return render(values, (key, value) => `${key}: ${quoteYaml(value)}`);
    case 'json':
      return JSON.stringify(values, null, 2) + '\n';
    default:
      throw new VaultError(`unknown export format: ${String(format)}`);
  }
};

/**
 * Parses a `.env` file into secrets, so an existing project can be imported in one step.
 * Comments, blank lines and a leading `export` are tolerated.
 */
export const parseDotenv = (text: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = unquote(match[2]);
  }
  return values;
};

const render = (
  values: Record<string, string>,
  line: (key: string, value: string) => string
): string =>
  Object.entries(values)
    .map(([key, value]) => line(key, value))
    .join('\n') + '\n';

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 1)
  ) {
    const inner = trimmed.slice(1, -1);
    return trimmed[0] === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner;
  }
  return trimmed;
};

const quoteDotenv = (value: string): string =>
  /^[A-Za-z0-9_./:@-]*$/.test(value)
    ? value
    : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

const quoteShell = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const quoteYaml = (value: string): string => JSON.stringify(value);
