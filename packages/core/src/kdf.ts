import { argon2id } from '@decryption/hashes/argon2';
import { randomBytes, utf8ToBytes } from '@decryption/hashes/utils';

import { InvalidParametersError } from './errors';

/** Length in bytes of the salt mixed into every passphrase derivation. */
export const SALT_LENGTH = 16;

/** Length in bytes of the symmetric key produced by the KDF. */
export const KEY_LENGTH = 32;

/** Argon2id cost parameters recorded verbatim in the envelope header. */
export interface KdfParams {
  /** Time cost — number of passes. */
  t: number;
  /** Memory cost in KiB. */
  m: number;
  /** Parallelism — number of lanes. */
  p: number;
}

/**
 * Named cost profiles. Names — not raw numbers — are what callers should pick, so
 * parameters can be raised over time without changing call sites.
 *
 * - `interactive`: ~64 MiB, suitable for a CLI prompt or UI unlock (sub-second on a laptop).
 * - `moderate`: ~256 MiB, the default for files at rest.
 * - `sensitive`: ~1 GiB, for long-lived recovery material such as Shamir shares.
 */
export const KDF_PROFILES = {
  interactive: { t: 2, m: 65536, p: 1 },
  moderate: { t: 3, m: 262144, p: 1 },
  sensitive: { t: 4, m: 1048576, p: 1 },
} as const satisfies Record<string, KdfParams>;

export type KdfProfile = keyof typeof KDF_PROFILES;

export const DEFAULT_KDF_PROFILE: KdfProfile = 'moderate';

/**
 * Lower bounds accepted when *reading* an envelope. Anything weaker is rejected rather than
 * silently trusted, so a tampered header cannot downgrade the work factor to nothing.
 */
const MIN_PARAMS: KdfParams = { t: 1, m: 8192, p: 1 };

export const resolveKdfParams = (profile: KdfProfile | KdfParams): KdfParams => {
  const params = typeof profile === 'string' ? KDF_PROFILES[profile] : profile;
  if (!params) throw new InvalidParametersError(`unknown kdf profile: ${String(profile)}`);
  assertKdfParams(params);
  return { t: params.t, m: params.m, p: params.p };
};

export const assertKdfParams = ({ t, m, p }: KdfParams): void => {
  const positiveInt = (n: number) => Number.isSafeInteger(n) && n > 0;
  if (!positiveInt(t) || !positiveInt(m) || !positiveInt(p)) {
    throw new InvalidParametersError('kdf parameters must be positive integers');
  }
  if (t < MIN_PARAMS.t || m < MIN_PARAMS.m || p < MIN_PARAMS.p) {
    throw new InvalidParametersError(
      `kdf parameters below the accepted minimum (t>=${MIN_PARAMS.t}, m>=${MIN_PARAMS.m} KiB, p>=${MIN_PARAMS.p})`
    );
  }
};

export const generateSalt = (): Uint8Array => randomBytes(SALT_LENGTH);

/** Derives a 32-byte symmetric key from a passphrase using Argon2id. */
export const deriveKey = (
  passphrase: string | Uint8Array,
  salt: Uint8Array,
  params: KdfParams
): Uint8Array => {
  if (salt.length !== SALT_LENGTH) {
    throw new InvalidParametersError(`salt must be ${SALT_LENGTH} bytes, got ${salt.length}`);
  }
  assertKdfParams(params);
  const secret = typeof passphrase === 'string' ? utf8ToBytes(passphrase) : passphrase;
  if (secret.length === 0) throw new InvalidParametersError('passphrase must not be empty');
  return argon2id(secret, salt, { ...params, dkLen: KEY_LENGTH });
};
