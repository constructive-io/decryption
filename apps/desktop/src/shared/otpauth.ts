/**
 * Parsing/formatting for `otpauth://totp/...` URIs (RFC 6238 key URIs), the
 * interchange format used by every authenticator app's export.
 */
export interface OtpauthParams {
  label: string;
  issuer?: string;
  secret: string;
  period: number;
  digits: number;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
}

const BASE32_RE = /^[A-Z2-7]+=*$/;

export const parseOtpauthUri = (uri: string): OtpauthParams => {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error('not a valid otpauth:// URI');
  }
  if (url.protocol !== 'otpauth:') {
    throw new Error('not a valid otpauth:// URI');
  }
  if (url.host !== 'totp') {
    throw new Error(`unsupported otpauth type "${url.host}" — only totp is supported`);
  }

  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const secret = (url.searchParams.get('secret') ?? '').toUpperCase().replace(/\s+/g, '');
  if (!secret || !BASE32_RE.test(secret)) {
    throw new Error('otpauth URI is missing a valid base32 secret');
  }

  const issuerParam = url.searchParams.get('issuer') ?? undefined;
  const [labelIssuer, account] = label.includes(':')
    ? [label.slice(0, label.indexOf(':')), label.slice(label.indexOf(':') + 1)]
    : [undefined, label];

  const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) {
    throw new Error(`unsupported algorithm "${algorithm}"`);
  }

  const period = Number(url.searchParams.get('period') ?? 30);
  const digits = Number(url.searchParams.get('digits') ?? 6);
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error('otpauth period must be a positive integer');
  }
  if (![6, 7, 8].includes(digits)) {
    throw new Error('otpauth digits must be 6, 7 or 8');
  }

  return {
    label: account.trim(),
    issuer: issuerParam ?? labelIssuer,
    secret,
    period,
    digits,
    algorithm: algorithm as OtpauthParams['algorithm'],
  };
};

export const formatOtpauthUri = (params: OtpauthParams): string => {
  const label = params.issuer ? `${params.issuer}:${params.label}` : params.label;
  const url = new URL(`otpauth://totp/${encodeURIComponent(label)}`);
  url.searchParams.set('secret', params.secret);
  if (params.issuer) url.searchParams.set('issuer', params.issuer);
  if (params.period !== 30) url.searchParams.set('period', String(params.period));
  if (params.digits !== 6) url.searchParams.set('digits', String(params.digits));
  if (params.algorithm !== 'SHA1') url.searchParams.set('algorithm', params.algorithm);
  return url.toString();
};
