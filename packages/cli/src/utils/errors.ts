import {
  CorruptEnvelopeError,
  InvalidParametersError,
  UnsupportedEnvelopeError,
  WrongPassphraseError,
} from '@decryption/core';

/**
 * Exit codes, so scripts can tell failure modes apart without parsing messages.
 *
 * | Code | Meaning |
 * |------|---------|
 * | 1 | Usage error — bad arguments, unknown command |
 * | 2 | Wrong passphrase, or authentication failed |
 * | 3 | Corrupt or unsupported input |
 * | 4 | Not found — no such secret, vault, or keychain entry |
 * | 5 | Permission — this identity is not a recipient |
 */
export const EXIT = {
  usage: 1,
  auth: 2,
  corrupt: 3,
  notFound: 4,
  permission: 5,
} as const;

export class CliError extends Error {
  readonly code: number;

  constructor(message: string, code: number = EXIT.usage) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

/** Maps library errors onto exit codes; unknown errors keep exit code 1. */
export const exitCodeFor = (error: unknown): number => {
  if (error instanceof CliError) return error.code;
  if (error instanceof WrongPassphraseError) return EXIT.auth;
  if (error instanceof CorruptEnvelopeError || error instanceof UnsupportedEnvelopeError) {
    return EXIT.corrupt;
  }
  if (error instanceof InvalidParametersError) return EXIT.usage;
  return EXIT.usage;
};

export const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
