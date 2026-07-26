import { Identity, identityFromPrivateKey } from '@decryption/keys';
import { combine, split, SplitOptions } from '@decryption/shamir';

/**
 * Break-glass recovery: split a recovery identity's private key into Shamir shares so that `t` of
 * `n` custodians can restore access if the usual holders are unavailable.
 *
 * Add the recovery identity to the vault as an ordinary recipient (label it `break-glass`) and
 * hand one share to each custodian. Shamir is deliberately *not* used for day-to-day membership —
 * adding or removing a teammate should be a recipient change, not a new ceremony.
 */
export const splitRecoveryIdentity = (identity: Identity, options: SplitOptions): Uint8Array[] =>
  split(identity.privateKey, options);

/** Reassembles a recovery identity from its shares. */
export const recoverIdentity = (shares: (Uint8Array | string)[]): Identity => {
  const privateKey = combine(shares);
  return identityFromPrivateKey(privateKey);
};
