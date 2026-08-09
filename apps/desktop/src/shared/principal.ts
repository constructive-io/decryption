import type { PrincipalRecord } from './api';

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
