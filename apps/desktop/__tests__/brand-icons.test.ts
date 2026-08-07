import { describe, expect, it } from 'vitest';

import { lookupBrandIcon } from '../src/main/brand-icons';

describe('lookupBrandIcon', () => {
  it('matches plain and decorated service names', () => {
    expect(lookupBrandIcon('GitHub')?.slug).toBe('github');
    expect(lookupBrandIcon('github.com')?.slug).toBe('github');
    expect(lookupBrandIcon('GitHub (alice@example.com)')?.slug).toBe('github');
    expect(lookupBrandIcon('Coinbase')?.slug).toBe('coinbase');
  });

  it('prefers svgl full-colour logos', () => {
    const icon = lookupBrandIcon('GitHub');
    expect(icon?.kind).toBe('logo');
    if (icon?.kind !== 'logo') throw new Error('expected a logo');
    expect(icon.light).toMatch(/^<svg/);
    expect(icon.dark).toMatch(/^<svg/);
  });

  it('falls back to a simple-icons glyph when svgl has no logo', () => {
    const icon = lookupBrandIcon('Namecheap');
    expect(icon?.kind).toBe('glyph');
    if (icon?.kind !== 'glyph') throw new Error('expected a glyph');
    expect(icon.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(icon.path.length).toBeGreaterThan(0);
  });

  it('returns null for services it does not know', () => {
    expect(lookupBrandIcon('Totally Made Up Bank')).toBeNull();
  });
});
