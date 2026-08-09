import { describe, expect, it } from 'vitest';

import type { PrincipalRecord } from '../src/shared/api';
import { principalReach } from '../src/shared/principal';

const principal = (overrides: Partial<PrincipalRecord> = {}): PrincipalRecord => ({
  principalId: 'principal-1',
  name: 'ci-deploy',
  ownerId: 'user-1',
  isReadOnly: false,
  bypassStepUp: false,
  useAdminOwner: true,
  entityIds: ['org-1'],
  scopes: [],
  ...overrides,
});

describe('principalReach', () => {
  it('says it inherits, rather than showing nothing, when no scope is overridden', () => {
    expect(principalReach(principal())).toBe('inherits you everywhere it is scoped');
  });

  it('names the restrictions it does carry', () => {
    const text = principalReach(principal({ isReadOnly: true, bypassStepUp: true }));
    expect(text).toContain('read-only');
    expect(text).toContain('skips step-up');
  });

  it('shows a scope mask, and says when the scope is switched off', () => {
    const text = principalReach(
      principal({
        scopes: [
          {
            membershipType: 2,
            allowedMask: '0011',
            isActive: false,
            isReadOnly: true,
            useAdminOwner: false,
          },
        ],
      })
    );
    expect(text).toContain('scope 2');
    expect(text).toContain('disabled');
    expect(text).toContain('mask 0011');
  });

  it('calls an absent mask inherited, because it is not an empty one', () => {
    const text = principalReach(
      principal({
        scopes: [
          {
            membershipType: 1,
            allowedMask: null,
            isActive: true,
            isReadOnly: false,
            useAdminOwner: true,
          },
        ],
      })
    );
    expect(text).toContain('mask inherited');
  });
});
