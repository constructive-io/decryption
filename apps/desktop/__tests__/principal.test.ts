import { describe, expect, it } from 'vitest';

import type { ApiKeyRecord, PrincipalRecord } from '../src/shared/api';
import { knownOrgIds, principalReach } from '../src/shared/principal';

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

const key = (overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord => ({
  itemId: 'item-1',
  accountItemId: 'account-1',
  endpoint: 'http://auth.localhost:3000/graphql',
  keyId: 'key-1',
  name: 'ci',
  expiresAt: null,
  databaseId: null,
  principalId: null,
  orgId: null,
  ...overrides,
});

describe('knownOrgIds', () => {
  it('gathers the organizations already scoped, from principals and org keys alike', () => {
    expect(
      knownOrgIds(
        [principal({ entityIds: ['org-b'] })],
        [key({ orgId: 'org-a' }), key({ itemId: 'item-2' })]
      )
    ).toEqual(['org-a', 'org-b']);
  });

  it('offers each organization once, however many things are scoped to it', () => {
    expect(
      knownOrgIds(
        [principal({ entityIds: ['org-a'] }), principal({ entityIds: ['org-a'] })],
        [key({ orgId: 'org-a' })]
      )
    ).toEqual(['org-a']);
  });

  it('is empty for an account that has scoped nothing, so the id must be typed', () => {
    expect(knownOrgIds([principal({ entityIds: [] })], [key()])).toEqual([]);
  });
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
