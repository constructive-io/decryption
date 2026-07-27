import { readFileSync } from 'fs';
import { Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { fromEnv } from './env';
import { CliError, EXIT } from './errors';
import { readStdin } from './io';

export interface PassphraseOptions {
  /** Ask twice and compare — used when creating something new. */
  confirm?: boolean;
  message?: string;
}

/**
 * Resolves a passphrase without ever accepting one on the command line.
 *
 * Order: `--passphrase-file <path>`, `DCRYPT_PASSPHRASE`, `--passphrase-stdin`, then an
 * interactive masked prompt. Passing `--passphrase` is rejected outright: argv is visible
 * to every process on the machine.
 */
export const resolvePassphrase = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  options: PassphraseOptions = {}
): Promise<string> => {
  if (argv.passphrase !== undefined || argv.password !== undefined) {
    throw new CliError(
      'refusing to read a passphrase from argv (it is visible in `ps`); use --passphrase-file <path> or --passphrase-stdin'
    );
  }

  const file = argv['passphrase-file'] ?? argv.passphraseFile;
  if (typeof file === 'string' && file.length) {
    try {
      return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new CliError(`cannot read passphrase file ${file}`, EXIT.notFound);
    }
  }

  const fromEnvironment = fromEnv('passphrase');
  if (fromEnvironment !== undefined) {
    return fromEnvironment.replace(/\r?\n$/, '');
  }

  if (argv['passphrase-stdin'] || argv.passphraseStdin) {
    return readStdin().replace(/\r?\n$/, '');
  }

  const message = options.message ?? 'Passphrase';
  const { passphrase } = await prompter.prompt<{ passphrase: string }>({} as { passphrase: string }, [
    { type: 'password', name: 'passphrase', message, required: true },
  ]);
  if (!passphrase) throw new CliError('a passphrase is required');

  if (options.confirm) {
    const { confirmation } = await prompter.prompt<{ confirmation: string }>({} as { confirmation: string }, [
      { type: 'password', name: 'confirmation', message: 'Confirm passphrase', required: true },
    ]);
    if (confirmation !== passphrase) throw new CliError('passphrases do not match');
  }
  return passphrase;
};
