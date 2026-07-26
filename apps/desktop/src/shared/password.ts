/** Character classes for generated passwords. */
export interface GeneratorOptions {
  length: number;
  lower?: boolean;
  upper?: boolean;
  digits?: boolean;
  symbols?: boolean;
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';

/** Uniform random int in [0, max) from a CSPRNG, without modulo bias. */
const randomInt = (max: number, random: (n: number) => Uint8Array): number => {
  const limit = Math.floor(256 / max) * max;
  for (;;) {
    const [byte] = random(1);
    if (byte < limit) return byte % max;
  }
};

export const generatePassword = (
  options: GeneratorOptions,
  random: (n: number) => Uint8Array
): string => {
  const { length, lower = true, upper = true, digits = true, symbols = true } = options;
  if (!Number.isInteger(length) || length < 4 || length > 256) {
    throw new Error('password length must be between 4 and 256');
  }
  const classes = [
    lower ? LOWER : '',
    upper ? UPPER : '',
    digits ? DIGITS : '',
    symbols ? SYMBOLS : '',
  ].filter(Boolean);
  if (!classes.length) {
    throw new Error('enable at least one character class');
  }

  const alphabet = classes.join('');
  const chars: string[] = [];
  // one character from every enabled class, so short passwords still mix
  for (const cls of classes) {
    chars.push(cls[randomInt(cls.length, random)]);
  }
  while (chars.length < length) {
    chars.push(alphabet[randomInt(alphabet.length, random)]);
  }
  // Fisher–Yates with CSPRNG indices
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, random);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, length).join('');
};

export const estimateEntropyBits = (options: GeneratorOptions): number => {
  const { lower = true, upper = true, digits = true, symbols = true } = options;
  const size =
    (lower ? LOWER.length : 0) +
    (upper ? UPPER.length : 0) +
    (digits ? DIGITS.length : 0) +
    (symbols ? SYMBOLS.length : 0);
  return size ? Math.floor(options.length * Math.log2(size)) : 0;
};
