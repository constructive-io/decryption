import { base64 } from '@decryption/base';
import { sha256 } from '@decryption/hashes/sha2';
import { bytesToHex, concatBytes, randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import { evaluate, interpolateAtZero } from './gf256';

/** ASCII `DSHR`, the first four bytes of every share. */
export const MAGIC = utf8ToBytes('DSHR');

/** Share format version implemented by this package. */
export const VERSION = 1;

/** Prefix of the armored (text) share form. */
export const SHARE_PREFIX = 'dcrypt-share.v1.';

const GROUP_LENGTH = 8;
const DIGEST_LENGTH = 8;
const HEADER_LENGTH = MAGIC.length + 1 + 1 + 1 + GROUP_LENGTH + DIGEST_LENGTH;

export const MAX_SHARES = 255;

export class ShamirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A share is malformed, or does not belong to the group being combined. */
export class InvalidShareError extends ShamirError {}

/** Enough shares were supplied, but the reconstructed secret failed its integrity check. */
export class ReconstructionError extends ShamirError {}

export interface SplitOptions {
  /** Total number of shares to produce (2–255). */
  shares: number;
  /** How many shares are required to reconstruct (2–`shares`). */
  threshold: number;
}

/** Parsed metadata of a share — everything except the share body. */
export interface ShareInfo {
  version: number;
  threshold: number;
  /** 1-based x-coordinate of this share. */
  index: number;
  /** Random per-split identifier; shares only combine with others from the same group. */
  group: Uint8Array;
}

/**
 * Splits `secret` into `shares` pieces, any `threshold` of which reconstruct it. Fewer than
 * `threshold` shares reveal nothing about the secret beyond its length.
 *
 * Every share carries a random group id and a keyed digest of the secret, so combining shares
 * from different splits, or a corrupted share, fails loudly instead of returning garbage — the
 * bug that made the old `secrets.js` flow dangerous.
 */
export const split = (secret: Uint8Array | string, options: SplitOptions): Uint8Array[] => {
  const bytes = typeof secret === 'string' ? utf8ToBytes(secret) : secret;
  const { shares, threshold } = options;
  if (!Number.isInteger(shares) || shares < 2 || shares > MAX_SHARES) {
    throw new ShamirError(`shares must be an integer between 2 and ${MAX_SHARES}`);
  }
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > shares) {
    throw new ShamirError('threshold must be an integer between 2 and the number of shares');
  }
  if (bytes.length === 0) throw new ShamirError('cannot split an empty secret');

  const group = randomBytes(GROUP_LENGTH);
  const digest = fingerprint(group, bytes);

  const bodies = Array.from({ length: shares }, () => new Uint8Array(bytes.length));
  const coefficients = new Uint8Array(threshold);
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    coefficients.set(randomBytes(threshold - 1), 1);
    coefficients[0] = bytes[byteIndex];
    for (let shareIndex = 0; shareIndex < shares; shareIndex++) {
      bodies[shareIndex][byteIndex] = evaluate(coefficients, shareIndex + 1);
    }
  }
  coefficients.fill(0);

  return bodies.map((body, i) =>
    concatBytes(
      MAGIC,
      new Uint8Array([VERSION, threshold, i + 1]),
      group,
      digest,
      body
    )
  );
};

/** Reads the non-secret metadata of a share. */
export const parseShare = (share: Uint8Array): ShareInfo => {
  if (share.length <= HEADER_LENGTH) throw new InvalidShareError('share is truncated');
  for (let i = 0; i < MAGIC.length; i++) {
    if (share[i] !== MAGIC[i]) throw new InvalidShareError('not a dcrypt share');
  }
  const version = share[4];
  if (version !== VERSION) throw new InvalidShareError(`unsupported share version ${version}`);
  const threshold = share[5];
  const index = share[6];
  if (threshold < 2) throw new InvalidShareError('share declares an impossible threshold');
  if (index < 1) throw new InvalidShareError('share index must be 1-based');
  return {
    version,
    threshold,
    index,
    group: share.slice(7, 7 + GROUP_LENGTH),
  };
};

/**
 * Reconstructs a secret from shares. Throws {@link InvalidShareError} when the shares are
 * inconsistent (duplicates, mixed groups, too few) and {@link ReconstructionError} when the
 * reconstructed bytes fail the integrity check.
 */
export const combine = (shares: (Uint8Array | string)[]): Uint8Array => {
  const parsed = shares.map((share) => {
    const bytes = typeof share === 'string' ? dearmorShare(share) : share;
    return { info: parseShare(bytes), bytes };
  });
  if (parsed.length === 0) throw new InvalidShareError('no shares supplied');

  const [first] = parsed;
  const group = first.info.group;
  const bodyLength = first.bytes.length - HEADER_LENGTH;

  for (const { info, bytes } of parsed) {
    if (bytesToHex(info.group) !== bytesToHex(group)) {
      throw new InvalidShareError('shares belong to different splits');
    }
    if (bytes.length - HEADER_LENGTH !== bodyLength) {
      throw new InvalidShareError('shares have inconsistent lengths');
    }
  }
  const indices = new Set(parsed.map((p) => p.info.index));
  if (indices.size !== parsed.length) throw new InvalidShareError('duplicate share supplied');
  if (parsed.length < first.info.threshold) {
    throw new InvalidShareError(
      `need at least ${first.info.threshold} shares, got ${parsed.length}`
    );
  }

  const xs = Uint8Array.from(parsed.map((p) => p.info.index));
  const ys = new Uint8Array(parsed.length);
  const secret = new Uint8Array(bodyLength);
  for (let byteIndex = 0; byteIndex < bodyLength; byteIndex++) {
    for (let i = 0; i < parsed.length; i++) ys[i] = parsed[i].bytes[HEADER_LENGTH + byteIndex];
    secret[byteIndex] = interpolateAtZero(xs, ys);
  }

  const expected = first.bytes.slice(7 + GROUP_LENGTH, HEADER_LENGTH);
  if (bytesToHex(fingerprint(group, secret)) !== bytesToHex(expected)) {
    throw new ReconstructionError(
      'reconstructed secret failed its integrity check: one or more shares are corrupt'
    );
  }
  return secret;
};

/** True when the shares reconstruct to a secret matching the fingerprint recorded at split time. */
export const verify = (shares: (Uint8Array | string)[]): boolean => {
  try {
    combine(shares);
    return true;
  } catch {
    return false;
  }
};

/** Encodes a share as single-line text, safe to paste into a password manager. */
export const armorShare = (share: Uint8Array): string => SHARE_PREFIX + base64.encode(share);

/** Inverse of {@link armorShare}. */
export const dearmorShare = (text: string): Uint8Array => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) {
    throw new InvalidShareError(`armored share must start with "${SHARE_PREFIX}"`);
  }
  try {
    return base64.decode(trimmed.slice(SHARE_PREFIX.length));
  } catch {
    throw new InvalidShareError('armored share is not valid base64');
  }
};

/** {@link split}, returning armored text shares. */
export const splitToStrings = (secret: Uint8Array | string, options: SplitOptions): string[] =>
  split(secret, options).map(armorShare);

/** {@link combine}, returning the secret as a UTF-8 string. */
export const combineToString = (shares: (Uint8Array | string)[]): string =>
  new TextDecoder().decode(combine(shares));

/**
 * Truncated SHA-256 over the random group id and the secret. Because the group id is random and
 * never derived from the secret, the fingerprint is useless to anyone who does not already hold
 * a share.
 */
const fingerprint = (group: Uint8Array, secret: Uint8Array): Uint8Array =>
  sha256(concatBytes(group, secret)).slice(0, DIGEST_LENGTH);
