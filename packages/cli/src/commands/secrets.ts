import { Identity } from '@decryption/keys';
import {
  addRecipient,
  createVault,
  deleteValue,
  ExportFormat,
  exportValues,
  getValue,
  getValues,
  listKeys,
  parseDotenv,
  parseVault,
  removeRecipient,
  rotateFileKey,
  serializeVault,
  setValues,
  Vault,
} from '@decryption/secrets';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { runSubcommand, takeFirst } from '../utils/dispatch';
import { CliError, EXIT } from '../utils/errors';
import { emit, readInput, writeOutput } from '../utils/io';
import { resolvePassphrase } from '../utils/passphrase';
import { loadIdentity, readStoredIdentity, vaultPath } from '../utils/stash';

export const secretsUsage = `
Secrets Command:

  dcrypt secrets <subcommand> [OPTIONS]

  Team secrets in a file you can commit: every value is encrypted individually, and
  access is granted by adding recipients rather than by sharing a passphrase.

Subcommands:
  init                    Create a vault with you as its first recipient
  set <NAME>              Store a secret
  get <NAME>              Print one secret
  list                    List secret names (no values, no passphrase needed)
  rm <NAME>               Remove a secret
  import                  Load secrets from a .env file
  export                  Print all secrets as dotenv/json/yaml/shell
  run -- <cmd…>           Run a command with the secrets in its environment
  recipients              List recipients
  add-recipient           Grant access to a teammate (rekeys the vault)
  rm-recipient            Revoke access (rekeys the vault)
  rekey                   Re-encrypt under a fresh file key

Options:
  --vault <name>          Vault stored in ~/.dcrypt/data/vaults  (default: default)
  --file <path>           Vault file path, overrides --vault
  --format <fmt>          dotenv | json | yaml | shell           (default: dotenv)
  --label <name>          Recipient label, for add-recipient
  --recipient <dcrypt1…>  Recipient string, for add-recipient
  --in <file>             Read a value or .env file ("-" for stdin)
  --out <file>            Write output to a file
  --json                  Machine-readable output
  --passphrase-file <p>   Read the passphrase from a file
  --passphrase-stdin      Read the passphrase from stdin
  --help, -h              Show this help message

Examples:
  dcrypt secrets init --vault production
  dcrypt secrets set DATABASE_URL --in url.txt --vault production
  dcrypt secrets export --vault production --format dotenv --out .env
  dcrypt secrets run --vault production -- npm start
  dcrypt secrets add-recipient --label ada --recipient dcrypt1…
`;

const fileOf = (argv: ParsedArgs): string => {
  const file = argv.file;
  if (typeof file === 'string' && file.length) return file;
  return vaultPath(String(argv.vault ?? 'default'));
};

const loadVault = (argv: ParsedArgs): Vault => {
  const path = fileOf(argv);
  if (!existsSync(path)) {
    throw new CliError(`no vault at ${path} — run \`dcrypt secrets init\` first`, EXIT.notFound);
  }
  return parseVault(readFileSync(path, 'utf8'));
};

const storeVault = (argv: ParsedArgs, vault: Vault): void => {
  writeFileSync(fileOf(argv), serializeVault(vault), { mode: 0o600 });
};

const unlockIdentity = async (argv: ParsedArgs, prompter: Inquirerer): Promise<Identity> =>
  loadIdentity(await resolvePassphrase(argv, prompter, { message: 'Identity passphrase' }));

const nameOf = (argv: ParsedArgs): { name: string; newArgv: ParsedArgs } => {
  const { first, newArgv } = takeFirst(argv);
  const name = first ?? (typeof argv.name === 'string' ? argv.name : undefined);
  if (!name) throw new CliError('a secret name is required');
  return { name, newArgv };
};

const init = (argv: ParsedArgs): void => {
  const path = fileOf(argv);
  if (existsSync(path) && !argv.force) {
    throw new CliError(`${path} already exists; pass --force to replace it`);
  }
  const stored = readStoredIdentity();
  const vault = createVault({
    name: String(argv.vault ?? 'default'),
    recipients: [{ label: String(argv.label ?? 'me'), recipient: stored.recipient }],
  });
  storeVault(argv, vault);
  emit(argv, { path, recipient: stored.recipient }, () => `created ${path}`);
};

const set = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { name, newArgv } = nameOf(argv);
  const { first: inline, newArgv: rest } = takeFirst(newArgv);
  const value = readInput(rest, inline).replace(/\r?\n$/, '');
  const identity = await unlockIdentity(rest, prompter);
  storeVault(rest, setValues(loadVault(rest), identity, { [name]: value }));
  identity.privateKey.fill(0);
  emit(rest, { name, saved: true }, () => `set ${name}`);
};

const get = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { name, newArgv } = nameOf(argv);
  const identity = await unlockIdentity(newArgv, prompter);
  try {
    writeOutput(newArgv, getValue(loadVault(newArgv), identity, name));
  } finally {
    identity.privateKey.fill(0);
  }
};

const list = (argv: ParsedArgs): void => {
  const names = listKeys(loadVault(argv));
  emit(argv, { secrets: names }, () => names.join('\n'));
};

const rm = (argv: ParsedArgs): void => {
  const { name, newArgv } = nameOf(argv);
  storeVault(newArgv, deleteValue(loadVault(newArgv), name));
  emit(newArgv, { name, deleted: true }, () => `removed ${name}`);
};

const importCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const values = parseDotenv(readInput(argv));
  if (Object.keys(values).length === 0) throw new CliError('no assignments found in the input');
  const identity = await unlockIdentity(argv, prompter);
  storeVault(argv, setValues(loadVault(argv), identity, values));
  identity.privateKey.fill(0);
  emit(argv, { imported: Object.keys(values) }, () => `imported ${Object.keys(values).length} secrets`);
};

const exportCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const format = String(argv.format ?? 'dotenv') as ExportFormat;
  const identity = await unlockIdentity(argv, prompter);
  try {
    writeOutput(argv, exportValues(loadVault(argv), identity, format));
  } finally {
    identity.privateKey.fill(0);
  }
};

const run = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const command = argv['--'] as string[] | undefined;
  if (!command || command.length === 0) {
    throw new CliError('nothing to run: put the command after `--`');
  }
  const identity = await unlockIdentity(argv, prompter);
  let values: Record<string, string>;
  try {
    values = getValues(loadVault(argv), identity);
  } finally {
    identity.privateKey.fill(0);
  }
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    stdio: 'inherit',
    env: { ...process.env, ...values },
  });
  if (result.error) throw new CliError(`failed to run ${bin}: ${result.error.message}`);
  if (result.status !== 0) throw new CliError(`${bin} exited with ${result.status}`, result.status ?? 1);
};

const recipients = (argv: ParsedArgs): void => {
  const vault = loadVault(argv);
  emit(argv, { recipients: vault.recipients }, () =>
    vault.recipients.map((r) => `${r.label}\t${r.recipient}`).join('\n')
  );
};

const addRecipientCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const answers = await prompter.prompt(argv, [
    { type: 'text', name: 'label', message: 'Label for this teammate', required: true },
    { type: 'text', name: 'recipient', message: 'Their dcrypt1… recipient string', required: true },
  ]);
  const identity = await unlockIdentity(argv, prompter);
  storeVault(
    argv,
    addRecipient(loadVault(argv), identity, {
      label: String(answers.label),
      recipient: String(answers.recipient),
    })
  );
  identity.privateKey.fill(0);
  emit(argv, { added: answers.label, rekeyed: true }, () => `added ${answers.label} and rekeyed`);
};

const removeRecipientCmd = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  const target = first ?? (typeof argv.label === 'string' ? argv.label : undefined);
  if (!target) throw new CliError('pass the label or recipient string to remove');
  const identity = await unlockIdentity(newArgv, prompter);
  storeVault(newArgv, removeRecipient(loadVault(newArgv), identity, target));
  identity.privateKey.fill(0);
  emit(newArgv, { removed: target, rekeyed: true }, () => `removed ${target} and rekeyed`);
};

const rekey = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  const identity = await unlockIdentity(argv, prompter);
  storeVault(argv, rotateFileKey(loadVault(argv), identity));
  identity.privateKey.fill(0);
  emit(argv, { rekeyed: true }, () => 'rekeyed');
};

export const secretsCommand = async (argv: ParsedArgs, prompter: Inquirerer): Promise<void> => {
  await runSubcommand(argv, prompter, {
    name: 'secrets',
    usage: secretsUsage,
    handlers: {
      init,
      set,
      get,
      list,
      rm,
      import: importCmd,
      export: exportCmd,
      run,
      recipients,
      'add-recipient': addRecipientCmd,
      'rm-recipient': removeRecipientCmd,
      rekey,
    },
  });
};
