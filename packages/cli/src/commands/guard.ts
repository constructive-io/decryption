import { ParsedArgs } from 'minimist';

import { takeFirst, wantsHelp } from '../utils/dispatch';
import { CliError } from '../utils/errors';
import { emit } from '../utils/io';
import { count } from '../utils/text';
import { isRepository } from '../workspace/git';
import { GuardScope, installHook, runGuard } from '../workspace/guard';
import { findWorkspace } from '../workspace/layout';
import { isSnippetName, SNIPPETS } from '../workspace/snippets';

export const guardUsage = `
Guard Command:

  dcrypt guard [--staged | --all] [OPTIONS]
  dcrypt guard install [--force]
  dcrypt guard snippet [name]

  Refuse to let plaintext into git. The guard looks at what a commit would record
  and stops on:

    - a file inside the plaintext folder of an encrypted section;
    - a *.dcrypt file whose content is not encrypted;
    - a file .gitignore covers, added by force.

  "guard install" writes it as this repository's pre-commit hook. "guard snippet"
  prints a file to paste: ${Object.keys(SNIPPETS).join(', ')}.

Options:
  --staged                Check what is staged for the next commit (default)
  --all                   Check every tracked file (for CI)
  --force                 With install: replace a pre-commit hook dcrypt did not write
  --workspace <dir>       The workspace root (default: the nearest folder upwards with a
                          recipients.txt, otherwise the current folder)
  --json                  Machine-readable output
  --help, -h              Show this help message

Examples:
  dcrypt guard install
  dcrypt guard snippet gitignore > .gitignore
  dcrypt guard --all
`;

const check = async (argv: ParsedArgs): Promise<void> => {
  if (argv.staged && argv.all) throw new CliError('--staged and --all are alternatives');
  const workspace = findWorkspace(argv);
  if (!isRepository(workspace.root)) throw new CliError(`${workspace.root} is not in a git repository`);

  const scope: GuardScope = argv.all ? 'all' : 'staged';
  const result = await runGuard(workspace, scope);
  const { violations } = result;
  const subject = count(result.checked, scope === 'all' ? 'tracked file' : 'staged file');
  emit(argv, { ok: violations.length === 0, ...result }, () =>
    violations.length
      ? violations.map(({ path, message }) => `${path}: ${message}`).join('\n')
      : `dcrypt guard: ${subject} checked, nothing to stop`
  );
  if (violations.length) {
    throw new CliError(
      `${violations.length} of ${subject} must not be committed (to unstage: git restore --staged <path>)`
    );
  }
};

const install = (argv: ParsedArgs): void => {
  const path = installHook(findWorkspace(argv), Boolean(argv.force));
  emit(argv, { installed: path }, () => `pre-commit guard installed at ${path}`);
};

const snippet = (argv: ParsedArgs): void => {
  const { first: name } = takeFirst(argv);
  if (!name) {
    const width = Math.max(...Object.keys(SNIPPETS).map((key) => key.length));
    const lines = Object.entries(SNIPPETS).map(([key, { file }]) => `${key.padEnd(width)}  ${file}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }
  if (!isSnippetName(name)) {
    throw new CliError(`unknown snippet "${name}"; there are: ${Object.keys(SNIPPETS).join(', ')}`);
  }
  process.stdout.write(SNIPPETS[name].text);
};

export const guardCommand = async (argv: ParsedArgs): Promise<void> => {
  if (wantsHelp(argv, guardUsage)) return;
  const { first: subcommand, newArgv } = takeFirst(argv);
  switch (subcommand) {
    case undefined:
      return check(newArgv);
    case 'install':
      return install(newArgv);
    case 'snippet':
      return snippet(newArgv);
    default:
      throw new CliError(`unknown guard subcommand: ${subcommand}`);
  }
};
