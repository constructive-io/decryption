import { describe, expect, it } from 'vitest';

import { formatOtpauthUri, parseOtpauthUri } from '../src/shared/otpauth';

describe('parseOtpauthUri', () => {
  it('parses a full totp uri', () => {
    const parsed = parseOtpauthUri(
      'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&period=30&digits=6'
    );
    expect(parsed).toEqual({
      label: 'alice@example.com',
      issuer: 'Example',
      secret: 'JBSWY3DPEHPK3PXP',
      period: 30,
      digits: 6,
      algorithm: 'SHA1',
    });
  });

  it('takes the issuer from the label when no param is present', () => {
    const parsed = parseOtpauthUri('otpauth://totp/GitHub:octocat?secret=JBSWY3DPEHPK3PXP');
    expect(parsed.issuer).toBe('GitHub');
    expect(parsed.label).toBe('octocat');
  });

  it('normalizes lowercase and spaced secrets', () => {
    const parsed = parseOtpauthUri('otpauth://totp/x?secret=jbswy3dpehpk3pxp');
    expect(parsed.secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('supports custom period, digits and algorithm', () => {
    const parsed = parseOtpauthUri(
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=60&digits=8&algorithm=SHA256'
    );
    expect(parsed.period).toBe(60);
    expect(parsed.digits).toBe(8);
    expect(parsed.algorithm).toBe('SHA256');
  });

  it('rejects hotp uris', () => {
    expect(() => parseOtpauthUri('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1')).toThrow(
      /only totp/
    );
  });

  it('rejects missing or invalid secrets', () => {
    expect(() => parseOtpauthUri('otpauth://totp/x')).toThrow(/secret/);
    expect(() => parseOtpauthUri('otpauth://totp/x?secret=notbase32!!')).toThrow(/secret/);
  });

  it('rejects non-otpauth uris', () => {
    expect(() => parseOtpauthUri('https://example.com')).toThrow(/otpauth/);
    expect(() => parseOtpauthUri('nonsense')).toThrow(/otpauth/);
  });
});

describe('formatOtpauthUri', () => {
  it('round-trips through parse', () => {
    const uri = formatOtpauthUri({
      label: 'alice@example.com',
      issuer: 'Example',
      secret: 'JBSWY3DPEHPK3PXP',
      period: 60,
      digits: 8,
      algorithm: 'SHA512',
    });
    const parsed = parseOtpauthUri(uri);
    expect(parsed.label).toBe('alice@example.com');
    expect(parsed.issuer).toBe('Example');
    expect(parsed.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(parsed.period).toBe(60);
    expect(parsed.digits).toBe(8);
    expect(parsed.algorithm).toBe('SHA512');
  });
});
