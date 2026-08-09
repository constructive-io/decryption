import type { ApiKeyRecord, PrincipalRecord } from './api';

/**
 * The organizations this account is already known to work in, gathered from
 * what it has scoped before: a principal's entities and an org key's org.
 *
 * The auth plane has no "my organizations" query — memberships live behind the
 * admin surface, which a signed-in user's token does not reach — so an id the
 * account has demonstrably used is the honest list to offer, and typing one in
 * stays possible for the first ever principal in an org.
 */
export const knownOrgIds = (
  principals: PrincipalRecord[],
  keys: ApiKeyRecord[]
): string[] => {
  const ids = new Set<string>();
  for (const principal of principals) {
    for (const entityId of principal.entityIds) ids.add(entityId);
  }
  for (const key of keys) {
    if (key.orgId) ids.add(key.orgId);
  }
  return [...ids].sort();
};

/**
 * What a principal may do, in words.
 *
 * A scope carrying no override row inherits its owner outright, which has to be
 * said rather than rendered as an empty list: "no restrictions recorded" and
 * "no access" look identical otherwise, and they are opposites.
 */
export const principalReach = (principal: PrincipalRecord): string => {
  const flags = [
    principal.isReadOnly ? 'read-only' : null,
    principal.bypassStepUp ? 'skips step-up' : null,
  ].filter((flag): flag is string => flag !== null);

  const scopes = principal.scopes.length
    ? principal.scopes
      .map(
        (scope) =>
          `scope ${scope.membershipType}: ${scope.isActive ? '' : 'disabled, '}mask ${
            scope.allowedMask ?? 'inherited'
          }`
      )
      .join(' · ')
    : 'inherits you everywhere it is scoped';

  return [...flags, scopes].join(' · ');
};
