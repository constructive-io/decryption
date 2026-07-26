import { extractFirst, Inquirerer } from 'inquirerer';
import { ParsedArgs } from 'minimist';

import { CliError } from './errors';

export type Handler = (argv: ParsedArgs, prompter: Inquirerer) => Promise<void> | void;

/**
 * `extractFirst` with the argv type preserved — upstream narrows the rest of argv to
 * `{ _: string[] }`, which loses every flag.
 */
export const takeFirst = (argv: ParsedArgs): { first?: string; newArgv: ParsedArgs } =>
  extractFirst(argv) as { first?: string; newArgv: ParsedArgs };

export interface SubcommandOptions {
  /** Name of the parent command, used in error messages. */
  name: string;
  usage: string;
  handlers: Record<string, Handler>;
}

/**
 * Dispatches `dcrypt <group> <subcommand>`: extracts the positional subcommand, prints per-command
 * help on `--help`, and prompts for the subcommand when running interactively without one.
 */
export const runSubcommand = async (
  argv: ParsedArgs,
  prompter: Inquirerer,
  { name, usage, handlers }: SubcommandOptions
): Promise<void> => {
  const { first, newArgv } = takeFirst(argv);
  let subcommand = first;

  if (!subcommand && (argv.help || argv.h)) {
    process.stdout.write(usage);
    return;
  }
  if (subcommand === 'help') {
    process.stdout.write(usage);
    return;
  }
  if (!subcommand) {
    const answer = await prompter.prompt(newArgv, [
      {
        type: 'autocomplete',
        name: 'subcommand',
        message: `${name} — what do you want to do?`,
        options: Object.keys(handlers),
      },
    ]);
    subcommand = answer.subcommand as string;
  }

  const handler = handlers[subcommand];
  if (!handler) {
    process.stdout.write(usage);
    throw new CliError(`unknown ${name} subcommand: ${subcommand}`);
  }
  if (newArgv.help || newArgv.h) {
    process.stdout.write(usage);
    return;
  }
  await handler(newArgv, prompter);
};

/** Prints `usage` and returns true when the user asked for help. */
export const wantsHelp = (argv: ParsedArgs, usage: string): boolean => {
  if (argv.help || argv.h) {
    process.stdout.write(usage);
    return true;
  }
  return false;
};
