import {
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@decryption/bip39';
import { wordlist as english } from '@decryption/bip39/wordlists/english';

/** Word counts permitted by BIP39, mapped to their entropy size in bits. */
export const WORD_COUNTS = { 12: 128, 15: 160, 18: 192, 21: 224, 24: 256 } as const;

export type WordCount = keyof typeof WORD_COUNTS;

export class MnemonicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface MnemonicOptions {
  /** BIP39 wordlist. Defaults to English. */
  wordlist?: string[];
}

const resolveWordlist = (options: MnemonicOptions = {}): string[] => options.wordlist ?? english;

/** Generates a fresh BIP39 mnemonic. Entropy comes from the platform CSPRNG. */
export const createMnemonic = (words: WordCount = 24, options?: MnemonicOptions): string => {
  const strength = WORD_COUNTS[words];
  if (!strength) {
    throw new MnemonicError(
      `word count must be one of ${Object.keys(WORD_COUNTS).join(', ')}, got ${words}`
    );
  }
  return generateMnemonic(resolveWordlist(options), strength);
};

/** True when every word is in the wordlist and the BIP39 checksum holds. */
export const isValidMnemonic = (mnemonic: string, options?: MnemonicOptions): boolean =>
  validateMnemonic(normalizeMnemonic(mnemonic), resolveWordlist(options));

/**
 * Throws a {@link MnemonicError} naming the actual problem — an unknown word, the wrong number of
 * words, or a failed checksum — instead of a bare boolean.
 */
export const assertValidMnemonic = (mnemonic: string, options?: MnemonicOptions): void => {
  const wordlist = resolveWordlist(options);
  const words = normalizeMnemonic(mnemonic).split(' ');
  if (!(words.length in WORD_COUNTS)) {
    throw new MnemonicError(
      `expected ${Object.keys(WORD_COUNTS).join('/')} words, got ${words.length}`
    );
  }
  const unknown = words.filter((word) => !wordlist.includes(word));
  if (unknown.length) {
    throw new MnemonicError(`not in the wordlist: ${[...new Set(unknown)].join(', ')}`);
  }
  if (!validateMnemonic(words.join(' '), wordlist)) {
    throw new MnemonicError('mnemonic checksum is invalid: check the word order and spelling');
  }
};

/** Collapses whitespace and lowercases, the normalization every BIP39 tool expects. */
export const normalizeMnemonic = (mnemonic: string): string =>
  mnemonic.trim().toLowerCase().split(/\s+/).join(' ');

/** BIP39 seed derivation (PBKDF2-HMAC-SHA512, 2048 iterations). */
export const mnemonicToSeed = (mnemonic: string, passphrase = ''): Uint8Array => {
  assertValidMnemonic(mnemonic);
  return mnemonicToSeedSync(normalizeMnemonic(mnemonic), passphrase);
};

/** Raw entropy behind a mnemonic — useful for converting between word counts and formats. */
export const mnemonicToBytes = (mnemonic: string, options?: MnemonicOptions): Uint8Array => {
  assertValidMnemonic(mnemonic, options);
  return mnemonicToEntropy(normalizeMnemonic(mnemonic), resolveWordlist(options));
};

/** Inverse of {@link mnemonicToBytes}. */
export const bytesToMnemonic = (entropy: Uint8Array, options?: MnemonicOptions): string =>
  entropyToMnemonic(entropy, resolveWordlist(options));
