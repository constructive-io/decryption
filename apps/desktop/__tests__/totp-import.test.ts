import { describe, expect, it } from 'vitest';

import { parseTotpJsonExport } from '../src/shared/totp-import';

describe('parseTotpJsonExport', () => {
  it('parses entries with uris, keeping custom digits/period', () => {
    const parsed = parseTotpJsonExport(
      JSON.stringify([
        {
          name: 'Coinbase',
          secret: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/Coinbase?secret=JBSWY3DPEHPK3PXP&digits=7&period=10',
        },
        {
          name: 'GitHub',
          secret: 'KRSXG5A=',
          uri: 'otpauth://totp/GitHub:alice?secret=KRSXG5A&issuer=GitHub',
        },
      ])
    );
    expect(parsed).toEqual([
      {
        name: 'Coinbase',
        uri: 'otpauth://totp/Coinbase?secret=JBSWY3DPEHPK3PXP&digits=7&period=10',
      },
      { name: 'GitHub', uri: 'otpauth://totp/GitHub:alice?secret=KRSXG5A&issuer=GitHub' },
    ]);
  });

  it('builds a default uri when only name and secret are present', () => {
    const [entry] = parseTotpJsonExport(
      JSON.stringify([{ name: 'Plain', secret: 'jbswy3dpehpk3pxp' }])
    );
    expect(entry.name).toBe('Plain');
    expect(entry.uri).toBe('otpauth://totp/Plain?secret=JBSWY3DPEHPK3PXP');
  });

  it('rejects non-arrays, bad json and entries without a secret', () => {
    expect(() => parseTotpJsonExport('{}')).toThrow('expected a JSON array');
    expect(() => parseTotpJsonExport('nope')).toThrow('not a valid JSON file');
    expect(() => parseTotpJsonExport(JSON.stringify([{ name: 'x' }]))).toThrow(
      'has no uri or secret'
    );
    expect(() =>
      parseTotpJsonExport(JSON.stringify([{ uri: 'otpauth://hotp/x?secret=JBSWY3DP' }]))
    ).toThrow('only totp is supported');
  });
});
