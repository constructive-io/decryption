import {
  defaultModulePath,
  FieldPurpose,
  ItemKind,
  Vault,
  VaultItem,
} from '@decryption/vault';
import { resolve } from 'appstash';
import { existsSync } from 'fs';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';
import { join } from 'path';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { CliError, EXIT } from '../utils/errors';
import { emit, readInput, writeOutput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { dirs } from '../utils/stash';
import { resolveKdf } from './encrypt';

export const vaultUsage = `
Vault Command:

  dcrypt vault <subcommand> [OPTIONS]

  The local encrypted vault, shared with the dcrypt desktop app. The whole
  database is one encrypted file; every value inside is additionally encrypted.

Subcommands:
  status                  Show whether a vault exists and where it lives
  item list               List items (titles and kinds, never values)
  item get <title>        Print an item's fields (values require --reveal)
  item add <title>        Add an item; value read from --in or prompted
  item rm <title>         Move an item to the trash
  totp <title>            Print the current one-time code for an item
  export                  Export items as JSON ("--format csv" for CSV)
  import                  Import items from a JSON export ("--from csv|bitwarden")

Options:
  --kind <kind>           login | note | card | identity | wallet | totp | ssh_key
  --field <name>          Field name for "item add" (default depends on kind)
  --reveal                Include secret values in "item get" output
  --format <fmt>          Export format: json (default) | csv
  --from <fmt>            Import format: json (default) | csv | bitwarden
  --in <file> / --out     Read/write files ("-" is stdin/stdout)
  --json                  Machine-readable output
  --passphrase-file <p>   Read the master password from a file
  --passphrase-stdin      Read the master password from stdin
  --help, -h              Show this help message

Examples:
  dcrypt vault item add github --kind login --field password
  dcrypt vault item get github --reveal
  dcrypt vault totp work-email
  dcrypt vault export --out backup.json
`;

const KINDS: ItemKind[] = ['login', 'note', 'card', 'identity', 'wallet', 'totp', 'ssh_key'];

export const vaultFile = (): string =>
  join(resolve(dirs(), 'data', 'db'), 'vault.dcrypt');

export const openVault = async (
  argv: ParsedArgs,
  prompter: Inquirerer
): Promise<Vault> => {
  const passphrase = await resolvePassphrase(argv, prompter, {
    message: 'Master password',
  });
  try {
    return await Vault.open({
      file: vaultFile(),
      passphrase,
      modulePath: defaultModulePath(),
      kdf: resolveKdf(argv.kdf),
    });
  } catch (error) {
    if (error instanceof Error && /passphrase/i.test(error.constructor.name)) {
      throw new CliError('wrong master password', EXIT.auth);
    }
    throw error;
  }
};

const findItem = async (vault: Vault, ref: string): Promise<VaultItem> => {
  const items = await vault.listItems();
  const item =
    items.find((candidate) => candidate.id === ref) ??
    items.find((candidate) => candidate.title === ref) ??
    items.find((candidate) => candidate.title.toLowerCase() === ref.toLowerCase());
  if (!item) throw new CliError(`no item named "${ref}"`, EXIT.notFound);
  return item;
};

const status = async (argv: ParsedArgs): Promise<void> => {
  const file = vaultFile();
  emit(argv, { exists: existsSync(file), file }, () =>
    existsSync(file) ? `vault: ${file}` : `no vault yet (would be created at ${file})`
  );
};

const itemList = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const vault = await openVault(argv, prompter);
  try {
    const items = await vault.listItems(
      typeof argv.kind === 'string' ? { kind: argv.kind as ItemKind } : {}
    );
    emit(
      argv,
      items.map((item) => ({ id: item.id, kind: item.kind, title: item.title })),
      () => items.map((item) => `${item.kind.padEnd(9)} ${item.title}`).join('\n') || '(empty)'
    );
  } finally {
    await vault.lock();
  }
};

const itemGet = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('an item title is required');
  const vault = await openVault(newArgv, prompter);
  try {
    const item = await findItem(vault, first);
    const fields = await vault.listFields(item.id);
    const reveal = Boolean(newArgv.reveal);
    const values: Record<string, string> = {};
    for (const field of fields) {
      values[field.name] =
        reveal || !field.concealed ? await vault.revealField(item.id, field.name) : '(concealed)';
    }
    emit(
      newArgv,
      { id: item.id, kind: item.kind, title: item.title, fields: values },
      () =>
        [`${item.title} (${item.kind})`, ...Object.entries(values).map(([k, v]) => `  ${k}: ${v}`)].join('\n')
    );
  } finally {
    await vault.lock();
  }
};

const DEFAULT_FIELD: Partial<Record<ItemKind, { name: string; purpose: FieldPurpose }>> = {
  login: { name: 'password', purpose: 'password' },
  totp: { name: 'seed', purpose: 'totp_seed' },
  wallet: { name: 'mnemonic', purpose: 'mnemonic' },
  ssh_key: { name: 'private_key', purpose: 'private_key' },
};

const itemAdd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('an item title is required');
  const kind = (typeof newArgv.kind === 'string' ? newArgv.kind : 'login') as ItemKind;
  if (!KINDS.includes(kind)) throw new CliError(`unknown kind "${kind}"`);

  const preset = DEFAULT_FIELD[kind] ?? { name: 'value', purpose: 'text' as FieldPurpose };
  const fieldName = typeof newArgv.field === 'string' ? newArgv.field : preset.name;
  const value = readInput(newArgv);

  const vault = await openVault(newArgv, prompter);
  try {
    const item = await vault.createItem(kind, first);
    await vault.setField(item.id, fieldName, preset.purpose, value.trim());
    emit(newArgv, { id: item.id, title: item.title }, () => `added "${item.title}" (${item.id})`);
  } finally {
    await vault.lock();
  }
};

const itemRm = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('an item title is required');
  const vault = await openVault(newArgv, prompter);
  try {
    const item = await findItem(vault, first);
    await vault.trashItem(item.id);
    emit(newArgv, { id: item.id }, () => `moved "${item.title}" to trash`);
  } finally {
    await vault.lock();
  }
};

const itemCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> =>
  runSubcommand(argv, prompter, {
    name: 'vault item',
    usage: vaultUsage,
    handlers: { list: itemList, get: itemGet, add: itemAdd, rm: itemRm },
  });

const totp = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  if (!first) throw new CliError('an item title is required');
  const vault = await openVault(newArgv, prompter);
  try {
    const item = await findItem(vault, first);
    const fields = await vault.listFields(item.id);
    if (!fields.some((field) => field.purpose === 'totp_seed')) {
      throw new CliError(`"${item.title}" has no one-time-code secret`);
    }
    const numeric = async (name: string, fallback: number): Promise<number> => {
      if (!fields.some((field) => field.name === name)) return fallback;
      const value = Number(await vault.revealField(item.id, name));
      return Number.isInteger(value) && value > 0 ? value : fallback;
    };
    const code = await vault.totpCode(item.id, {
      period: await numeric('period', 30),
      digits: await numeric('digits', 6),
    });
    emit(newArgv, { code }, () => code);
  } finally {
    await vault.lock();
  }
};

interface ExportedItem {
  kind: ItemKind;
  title: string;
  favorite: boolean;
  fields: Record<string, string>;
  urls: string[];
  tags: string[];
}

const exportItems = async (vault: Vault): Promise<ExportedItem[]> => {
  const items = await vault.listItems();
  const result: ExportedItem[] = [];
  for (const item of items) {
    const fields: Record<string, string> = {};
    for (const field of await vault.listFields(item.id)) {
      fields[field.name] = await vault.revealField(item.id, field.name);
    }
    result.push({
      kind: item.kind,
      title: item.title,
      favorite: item.favorite,
      fields,
      urls: await vault.listUrls(item.id),
      tags: (await vault.listTags(item.id)).map((tag) => tag.name),
    });
  }
  return result;
};

const csvEscape = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const exportCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const format = typeof argv.format === 'string' ? argv.format : 'json';
  const vault = await openVault(argv, prompter);
  try {
    const items = await exportItems(vault);
    let output: string;
    if (format === 'csv') {
      const rows = items.map((item) =>
        [
          item.title,
          item.kind,
          item.fields.username ?? '',
          item.fields.password ?? item.fields.value ?? '',
          item.urls[0] ?? '',
          item.tags.join(';'),
        ]
          .map(csvEscape)
          .join(',')
      );
      output = ['title,kind,username,password,url,tags', ...rows].join('\n') + '\n';
    } else if (format === 'json') {
      output = JSON.stringify({ version: 1, items }, null, 2) + '\n';
    } else {
      throw new CliError(`unknown export format "${format}"`);
    }
    writeOutput(argv, output);
    if (argv.out && argv.out !== '-') {
      process.stderr.write('warning: the export contains plaintext secrets — handle with care\n');
    }
  } finally {
    await vault.lock();
  }
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
};

interface ImportedItem {
  kind: ItemKind;
  title: string;
  fields: Record<string, string>;
  urls: string[];
  tags: string[];
}

const parseImport = (raw: string, from: string): ImportedItem[] => {
  if (from === 'json') {
    const parsed = JSON.parse(raw) as { items?: ExportedItem[] };
    if (!Array.isArray(parsed.items)) throw new CliError('not a dcrypt vault export');
    return parsed.items.map((item) => ({
      kind: KINDS.includes(item.kind) ? item.kind : 'note',
      title: item.title,
      fields: item.fields ?? {},
      urls: item.urls ?? [],
      tags: item.tags ?? [],
    }));
  }
  if (from === 'bitwarden') {
    const parsed = JSON.parse(raw) as {
      items?: { type: number; name: string; notes?: string; login?: { username?: string; password?: string; totp?: string; uris?: { uri: string }[] } }[];
    };
    if (!Array.isArray(parsed.items)) throw new CliError('not a bitwarden export');
    return parsed.items.map((entry) => {
      const fields: Record<string, string> = {};
      if (entry.login?.username) fields.username = entry.login.username;
      if (entry.login?.password) fields.password = entry.login.password;
      if (entry.login?.totp) fields.seed = entry.login.totp;
      if (entry.notes) fields.note = entry.notes;
      return {
        kind: entry.type === 1 ? ('login' as ItemKind) : ('note' as ItemKind),
        title: entry.name,
        fields,
        urls: entry.login?.uris?.map((u) => u.uri) ?? [],
        tags: [] as string[],
      };
    });
  }
  if (from === 'csv') {
    const [header, ...lines] = raw.trim().split(/\r?\n/);
    const columns = parseCsvLine(header).map((c) => c.trim().toLowerCase());
    return lines.filter(Boolean).map((line) => {
      const cells = parseCsvLine(line);
      const get = (...names: string[]): string => {
        for (const name of names) {
          const index = columns.indexOf(name);
          if (index >= 0 && cells[index]) return cells[index];
        }
        return '';
      };
      const fields: Record<string, string> = {};
      const username = get('username', 'login_username', 'user');
      const password = get('password', 'login_password');
      if (username) fields.username = username;
      if (password) fields.password = password;
      const url = get('url', 'login_uri', 'website');
      return {
        kind: 'login' as ItemKind,
        title: get('title', 'name', 'account') || url || 'imported',
        fields,
        urls: url ? [url] : [],
        tags: [] as string[],
      };
    });
  }
  throw new CliError(`unknown import format "${from}"`);
};

const FIELD_PURPOSE: Record<string, FieldPurpose> = {
  username: 'username',
  password: 'password',
  seed: 'totp_seed',
  mnemonic: 'mnemonic',
  private_key: 'private_key',
};

const importCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const from = typeof argv.from === 'string' ? argv.from : 'json';
  const raw = readInput(argv);
  const imported = parseImport(raw, from);
  const vault = await openVault(argv, prompter);
  try {
    for (const entry of imported) {
      const item = await vault.createItem(entry.kind, entry.title);
      for (const [name, value] of Object.entries(entry.fields)) {
        await vault.setField(item.id, name, FIELD_PURPOSE[name] ?? 'text', value, name !== 'username');
      }
      for (const url of entry.urls) await vault.addUrl(item.id, url);
      for (const tag of entry.tags) await vault.tagItem(item.id, tag);
    }
    emit(argv, { imported: imported.length }, () => `imported ${imported.length} item(s)`);
  } finally {
    await vault.lock();
  }
};

export const vaultCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> =>
  runSubcommand(argv, prompter, {
    name: 'vault',
    usage: vaultUsage,
    handlers: {
      status,
      item: itemCommand,
      totp,
      export: exportCommand,
      import: importCommand,
    },
  });
