import { describe, expect, it } from 'vitest';

import { lookupBrandIcon } from '../src/main/brand-icons';

describe('lookupBrandIcon', () => {
  it('matches plain and decorated service names', () => {
    expect(lookupBrandIcon('GitHub')?.slug).toBe('github');
    expect(lookupBrandIcon('github.com')?.slug).toBe('github');
    expect(lookupBrandIcon('GitHub (alice@example.com)')?.slug).toBe('github');
    expect(lookupBrandIcon('Coinbase')?.slug).toBe('coinbase');
  });

  it('returns brand colour and a drawable path', () => {
    const icon = lookupBrandIcon('GitHub');
    expect(icon?.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(icon?.path.length).toBeGreaterThan(0);
  });

  it('returns null for services it does not know', () => {
    expect(lookupBrandIcon('Totally Made Up Bank')).toBeNull();
  });
});
