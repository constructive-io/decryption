/** Raised when an endpoint cannot be read as a URL at all. */
export class EndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndpointError';
  }
}

/** Hosts that are never reachable over TLS in a dev setup. */
const isLocal = (host: string): boolean =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host === '::1' ||
  /^127\./.test(host);

/**
 * Turn what a human types into the GraphQL URL the SDK needs: a bare host gets
 * `/graphql`, and a scheme is assumed (http for localhost, https otherwise).
 * Everything else is left alone, so an endpoint that is already a full URL —
 * including one on a non-standard path — round-trips unchanged.
 */
export const normalizeEndpoint = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) throw new EndpointError('an auth endpoint is required');

  const hostOnly = !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const scheme = isLocal(trimmed.split(/[:/]/)[0]) ? 'http://' : 'https://';

  let url: URL;
  try {
    url = new URL(hostOnly ? scheme + trimmed : trimmed);
  } catch {
    throw new EndpointError(`not a URL: ${input}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EndpointError(`unsupported scheme ${url.protocol} in ${input}`);
  }
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/graphql';
  url.hash = '';
  return url.toString();
};
